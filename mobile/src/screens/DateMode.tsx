import { useEffect, useRef, useState } from "react";
import { nextQuestionIndex, rememberQuestion } from "@shared/questionRotation";
import { clock } from "@shared/practiceTiming";
import { AFTERMATH_DECK_ID, STRESS_REDUCING_DECK_ID } from "@shared/structuredSessions";
import type { Deck, PartnerId } from "@shared/types";
import { type DateState, currentSpeaker, dateReducer, isLastCard, remainingMs, startDate, type DateAction } from "../core/dateFlow";
import { type QuestionRef, type Reflection, deckById, other } from "../core/model";
import { openDecks, questionText } from "../core/questions";
import { END_QUESTIONS } from "../content/prompts";
import { askNotifications, dndStatus, keepAwake, notificationsAllowed, openDndSettings, setDnd, shareImage, vibrate } from "../native/device";
import { renderSummary } from "../native/summaryImage";
import { sendSignal } from "../native/pair";
import { useFaceDown, useNow } from "../hooks";
import { useStore } from "../store";
import { Handoff, PrivateNote, Screen, say, youThem } from "../ui";
import { BreakScreen, HapticPractice } from "./Break";
import type { Go } from "../App";

type Stage =
  | { name: "pick" }
  | { name: "setup"; deck: Deck }
  | { name: "practice"; deck: Deck; first: PartnerId; count: number }
  | { name: "run" }
  | { name: "end-handoff"; who: PartnerId }
  | { name: "end-answer"; who: PartnerId }
  | { name: "summary" };

const CARD_COUNTS = [2, 3, 4];

/** Light first: the open deck at the deepest unlocked layer used least so far. */
function suggestedDeck(open: Deck[], used: string[]) {
  const deepest = Math.max(...open.map((d) => d.depthLevel ?? 1));
  const candidates = open.filter((d) => d.depthLevel === deepest);
  const count = (id: string) => used.filter((u) => u === id).length;
  return [...candidates].sort((a, b) => count(a.id) - count(b.id))[0] ?? open[0];
}

function pickCards(deck: Deck, count: number): QuestionRef[] {
  let history: number[] = [];
  const cards: QuestionRef[] = [];
  for (let i = 0; i < Math.min(count, deck.cards.length); i++) {
    const index = nextQuestionIndex(deck.cards.length, history);
    history = rememberQuestion(history, index, deck.cards.length);
    cards.push({ deckId: deck.id, index });
  }
  return cards;
}

const END_TAP_GUARD_MS = 800;

export function DateMode({ go, deckId }: { go: Go; deckId?: string }) {
  const store = useStore();
  const { state, settings } = store;
  const couple = state.couple!;
  const open = openDecks(state.unlockedLayer);
  const [stage, setStage] = useState<Stage>(() => {
    const deck = open.find((d) => d.id === deckId);
    return deck ? { name: "setup", deck } : { name: "pick" };
  });
  const [first, setFirst] = useState<PartnerId>("A");
  const [count, setCount] = useState(3);
  const [dndWanted, setDndWanted] = useState(settings.dndOnDates);
  const [dndInfo, setDndInfo] = useState<{ available: boolean; granted: boolean } | null>(null);
  const [manual, setManual] = useState(false);
  const [reflections, setReflections] = useState<Partial<Record<PartnerId, Reflection & { share: { good: boolean; learned: boolean } }>>>({});
  const [step, setStep] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const dateRef = useRef<DateState | null>(null);
  const phaseChangedAt = useRef(0);
  const dndApplied = useRef(false);
  const startedIso = useRef("");
  const [, rerender] = useState(0);

  /** `fromPeer`: the action came from the other phone, so it is not echoed back. */
  const act = (action: DateAction, fromPeer = false) => {
    if (!dateRef.current) return;
    // A quick second tap on "ready" lands on "done for tonight", which sits in the same spot on the next screen.
    if (action.type === "end" && Date.now() - phaseChangedAt.current < END_TAP_GUARD_MS) return;
    const before = dateRef.current;
    const result = dateReducer(before, action);
    if (result.state.phase !== before.phase) phaseChangedAt.current = Date.now();
    dateRef.current = result.state;
    result.effects.forEach((effect) => void vibrate(effect.haptic));
    rerender((n) => n + 1);
    // Two phones: the break reaches the other phone too, and so does each "ready".
    if (store.link.paired) {
      if (result.state.phase === "break" && before.phase !== "break" && !fromPeer) void sendSignal("break", { returnAt: result.state.breakReturnAt });
      if (action.type === "ready" && !fromPeer) void sendSignal("break-ready", { who: action.partner });
      if (before.phase === "break" && result.state.phase !== "break") void sendSignal("break-over");
    }
  };

  useEffect(
    () =>
      store.onSignal((signal) => {
        if (!dateRef.current) return;
        if (signal.name === "break" && dateRef.current.phase !== "break") act({ type: "start-break", now: Date.now() }, true);
        if (signal.name === "break-ready" && (signal.data.who === "A" || signal.data.who === "B")) act({ type: "ready", partner: signal.data.who }, true);
      }),
    [store.onSignal] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Two phones: the other phone can offer a break button while this one runs the date.
  useEffect(() => {
    if (!store.link.paired) return;
    const on = stage.name === "run";
    void sendSignal(on ? "date-on" : "date-off");
  }, [stage.name === "run"]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void sendSignal("date-off"), []);

  const date = dateRef.current;
  const running = stage.name === "run" && date?.phase === "running";
  const now = useNow(stage.name === "run" && (date?.phase === "running" || date?.phase === "paused"));
  useEffect(() => {
    if (running) act({ type: "tick", now });
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensor = useFaceDown(stage.name === "run" && date?.phase !== "break" && date?.phase !== "ended", (o) =>
    act(o === "down" ? { type: "placed-down", now: Date.now() } : { type: "picked-up", now: Date.now() })
  );

  // Leave the date cleanly: screen sleep and notifications back to normal.
  const release = async () => {
    await keepAwake(false);
    if (dndApplied.current) {
      await setDnd(false);
      dndApplied.current = false;
    }
  };
  useEffect(() => () => void release(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stage.name === "run" && date?.phase === "ended") {
      void release();
      setStage({ name: "end-handoff", who: date.firstSpeaker });
    }
  }, [stage.name, date?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stage.name === "setup" && dndInfo === null) void dndStatus().then(setDndInfo);
  }, [stage.name, dndInfo]);

  const begin = async (deck: Deck, firstSpeaker: PartnerId, cardCount: number) => {
    dateRef.current = startDate(pickCards(deck, cardCount), firstSpeaker);
    startedIso.current = new Date().toISOString();
    await keepAwake(true);
    if (dndWanted) dndApplied.current = await setDnd(true);
    setStage({ name: "run" });
  };

  // Pick -----------------------------------------------------------------------
  if (stage.name === "pick") {
    const suggestion = suggestedDeck(open, state.dates.flatMap((d) => d.deckIds));
    return (
      <Screen onBack={() => go({ name: "home" })} title="ערב יחד" actions={<button className="btn btn-primary" onClick={() => setStage({ name: "setup", deck: suggestion })}>{`הערב: ${suggestion.title}`}</button>}>
        <h2>על מה מדברים הערב?</h2>
        <div className="card card-hero">
          <span className="eyebrow">ההצעה להערב</span>
          <h3>{suggestion.title}</h3>
          <p>{suggestion.therapeuticGoal}</p>
          <span className="small muted">{`כ-${suggestion.timeMinutes} דקות`}</span>
        </div>
        <span className="eyebrow">או בחירה אחרת</span>
        <div className="list">
          {open.filter((d) => d.id !== suggestion.id).map((deck) => (
            <button key={deck.id} className="list-item" onClick={() => setStage({ name: "setup", deck })}>
              <span><strong>{deck.title}</strong><small>{deck.therapeuticGoal}</small></span>
              <span className="small muted" style={{ whiteSpace: "nowrap" }}>{`${deck.timeMinutes} דק׳`}</span>
            </button>
          ))}
        </div>
        <span className="eyebrow">שיחות מובנות</span>
        <div className="list">
          <button className="list-item" onClick={() => go({ name: "structured", kind: "stress-reducing" })}>
            <span><strong>{deckById(STRESS_REDUCING_DECK_ID)?.title}</strong><small>לחץ מבחוץ. אחד מדבר, השני תומך בלי לפתור.</small></span>
          </button>
          <button className="list-item" onClick={() => go({ name: "structured", kind: "aftermath" })}>
            <span><strong>{deckById(AFTERMATH_DECK_ID)?.title}</strong><small>לריב שכבר נגמר, כשרגועים ובטוחים. חמישה שלבים.</small></span>
          </button>
        </div>
      </Screen>
    );
  }

  // Setup ------------------------------------------------------------------------
  if (stage.name === "setup") {
    const deck = stage.deck;
    const go2 = () => (settings.hapticsPracticed ? void begin(deck, first, count) : setStage({ name: "practice", deck, first, count }));
    return (
      <Screen onBack={() => setStage({ name: "pick" })} title={deck.title} actions={<button className="btn btn-primary" onClick={go2}>מוכנים</button>}>
        <h2>{deck.purpose}</h2>
        <div className="card">
          <span className="eyebrow">איך זה עובד</span>
          <p>{say("כל שאלה: {f} {f:מדבר|מדברת} שתי דקות, רטט ארוך, ואז {o} {o:משקף|משקפת} במשפט אחד ו{o:מדבר|מדברת} שתי דקות. בשאלה הבאה מתחלפים.", couple, { f: couple[first], o: couple[other(first)] })}</p>
          <p className="muted">מניחים את הטלפון עם המסך למטה, והשעון מתחיל. מרימים? השעון מחכה.</p>
        </div>
        <span className="eyebrow">מי מתחיל?</span>
        <div className="segmented">
          {(["A", "B"] as PartnerId[]).map((p) => (
            <button key={p} aria-pressed={first === p} onClick={() => setFirst(p)}>{couple[p].name}</button>
          ))}
        </div>
        <span className="eyebrow">כמה שאלות?</span>
        <div className="segmented" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          {CARD_COUNTS.map((n) => (
            <button key={n} aria-pressed={count === n} onClick={() => setCount(n)}>{`${n} · ${n * 4} דק׳`}</button>
          ))}
        </div>
        <div className="card">
          <label className="toggle-row">
            <span>
              <strong>שקט מהתראות בזמן הערב</strong>
              <br />
              <span className="small muted">כדי ששום הודעה לא תרטיט באמצע. חוזר למצב הקודם בסוף.</span>
            </span>
            <input type="checkbox" checked={dndWanted} onChange={(e) => { setDndWanted(e.target.checked); void store.updateSettings({ dndOnDates: e.target.checked }); }} />
          </label>
          {dndWanted && dndInfo && !dndInfo.granted && (
            <div className="stack">
              {dndInfo.available && (
                <>
                  <p className="small">כדי להפעיל &quot;נא לא להפריע&quot; בשבילכם, אנדרואיד מבקש אישור חד-פעמי בהגדרות.</p>
                  <button className="btn btn-secondary" onClick={() => void openDndSettings().then(() => setDndInfo(null))}>לאישור בהגדרות</button>
                </>
              )}
              <p className="small muted">או בלי אישור: משכו את הלוח העליון והפעילו &quot;נא לא להפריע&quot; בעצמכם.</p>
            </div>
          )}
        </div>
      </Screen>
    );
  }

  if (stage.name === "practice") {
    return (
      <HapticPractice
        onDone={() => {
          void store.updateSettings({ hapticsPracticed: true });
          void begin(stage.deck, stage.first, stage.count);
        }}
      />
    );
  }

  // Run ----------------------------------------------------------------------------
  if (stage.name === "run" && date) {
    if (date.phase === "ended") return <div className="night" style={{ minHeight: "100dvh" }} />;
    if (date.phase === "break") {
      // With the other phone in touch, each says "ready" on their own phone.
      const only = store.link.connected && store.me ? [store.me] : undefined;
      return <BreakScreen couple={couple} returnAt={date.breakReturnAt ?? Date.now()} ready={date.ready} only={only} onReady={(p) => act({ type: "ready", partner: p })} />;
    }
    const speaker = currentSpeaker(date);
    const listener = other(speaker);
    const card = date.cards[date.cardIndex];
    const left = remainingMs(date, now);
    const breakButton = <button className="break-button" onClick={() => act({ type: "start-break", now: Date.now() })}>הפסקה</button>;
    const endButton = <button className="btn btn-quiet" onClick={() => act({ type: "end", now: Date.now() })}>סיימנו להערב</button>;

    if (date.phase === "running") {
      return (
        <div className="blackout" onClick={manual || sensor === false ? () => act({ type: "picked-up", now: Date.now() }) : undefined}>
          <p>{manual || sensor === false ? "נגיעה עוצרת את השעון" : ""}</p>
        </div>
      );
    }

    const roles = { s: couple[speaker], l: couple[listener] };
    const placeLine = sensor === false || manual ? "" : "מניחים את הטלפון עם המסך למטה, והשעון מתחיל.";
    if (date.phase === "card-done") {
      return (
        <Screen night actions={<><button className="btn btn-primary" onClick={() => act({ type: "next-card" })}>לשאלה הבאה</button>{endButton}</>}>
          {breakButton}
          <div className="stack" style={{ marginTop: "16vh" }}>
            <span className="eyebrow">{`שאלה ${date.cardIndex + 1} מתוך ${date.cards.length}`}</span>
            <h1>שניכם דיברתם.</h1>
            <p className="lead">אפשר להמשיך לשאלה הבאה, או לעצור כאן לערב הזה.</p>
          </div>
        </Screen>
      );
    }

    // waiting-down or paused
    const paused = date.phase === "paused";
    return (
      <Screen
        night
        actions={
          <>
            {(sensor === false || manual) ? (
              <button className="btn btn-primary" onClick={() => act({ type: "placed-down", now: Date.now() })}>{paused ? "ממשיכים" : "מתחילים את השעון"}</button>
            ) : (
              <p className="muted" style={{ textAlign: "center" }}>{paused ? "מניחים שוב, והשעון ממשיך." : placeLine}</p>
            )}
            {!isLastCard(date) && paused && <button className="btn btn-secondary" onClick={() => act({ type: "next-card" })}>לשאלה הבאה</button>}
            {endButton}
          </>
        }
      >
        {breakButton}
        <div className="stack" style={{ marginTop: "4.5rem" }}>
          <span className="eyebrow">{`שאלה ${date.cardIndex + 1} מתוך ${date.cards.length}${paused ? " · השעון מחכה" : ""}`}</span>
          <p className="lead">{say(date.turn === 0 ? "{s} {s:מדבר|מדברת}, {l} {l:מקשיב|מקשיבה}" : "{l} {l:סיים|סיימה}. {s} {s:משקף|משקפת} במשפט אחד, ואז {s:מדבר|מדברת}", couple, roles)}</p>
          <p className="question">{questionText(card, couple, speaker)}</p>
          <div className="big-clock" role="timer" aria-label={`נותרו ${clock(left / 1000)}`}>{clock(left / 1000)}</div>
          {sensor !== false && !manual && (
            <button className="btn btn-quiet" onClick={() => setManual(true)}>בלי להניח את הטלפון</button>
          )}
        </div>
      </Screen>
    );
  }

  // End: two private questions each, pass the phone ---------------------------------
  if (stage.name === "end-handoff") {
    return (
      <Handoff
        night
        couple={couple}
        to={stage.who}
        lead={say("שתי שאלות קטנות, בסתר. רק מה ש{p} {p:יבחר|תבחר} יופיע בכרטיס המשותף.", couple, { p: couple[stage.who] })}
        onReady={() => setStage({ name: "end-answer", who: stage.who })}
      />
    );
  }

  if (stage.name === "end-answer") {
    const who = stage.who;
    const mine = reflections[who] ?? { good: "", learned: "", share: { good: true, learned: true } };
    const set = (patch: Partial<typeof mine>) => setReflections({ ...reflections, [who]: { ...mine, ...patch } });
    const firstWho = date?.firstSpeaker ?? "A";
    const next = () => (who === firstWho ? setStage({ name: "end-handoff", who: other(who) }) : setStage({ name: "summary" }));
    const partner = couple[other(who)];
    return (
      <Screen night title={couple[who].name} actions={<button className="btn btn-primary" onClick={next}>שומרים</button>}>
        <PrivateNote>{say("{p:רק אתה רואה|רק את רואה} את זה", couple, { p: couple[who] })}</PrivateNote>
        <label className="field">
          {say(END_QUESTIONS.good, couple, youThem(couple, who))}
          <textarea value={mine.good} onChange={(e) => set({ good: e.target.value })} />
        </label>
        <label className="toggle-row small">
          <span>{say("להראות בכרטיס המשותף (גם {o} {o:יראה|תראה})", couple, { o: partner })}</span>
          <input type="checkbox" checked={mine.share.good} onChange={(e) => set({ share: { ...mine.share, good: e.target.checked } })} />
        </label>
        <label className="field">
          {say(END_QUESTIONS.learned, couple, youThem(couple, who))}
          <textarea value={mine.learned} onChange={(e) => set({ learned: e.target.value })} />
        </label>
        <label className="toggle-row small">
          <span>{say("להראות בכרטיס המשותף (גם {o} {o:יראה|תראה})", couple, { o: partner })}</span>
          <input type="checkbox" checked={mine.share.learned} onChange={(e) => set({ share: { ...mine.share, learned: e.target.checked } })} />
        </label>
      </Screen>
    );
  }

  // Summary ---------------------------------------------------------------------------
  if (stage.name === "summary" && date) {
    return <Summary go={go} date={date} reflections={reflections} startedIso={startedIso.current} step={step} setStep={setStep} image={image} setImage={setImage} />;
  }
  return null;
}

function Summary({ go, date, reflections, startedIso, step, setStep, image, setImage }: {
  go: Go;
  date: DateState;
  reflections: Partial<Record<PartnerId, Reflection & { share: { good: boolean; learned: boolean } }>>;
  startedIso: string;
  step: string;
  setStep: (s: string) => void;
  image: string | null;
  setImage: (s: string | null) => void;
}) {
  const store = useStore();
  const couple = store.state.couple!;
  const deck = deckById(date.cards[0].deckId)!;
  const minutes = Math.max(1, Math.round(date.talkMs / 60000));
  const shared: Partial<Record<PartnerId, Reflection>> = {};
  const lines: { name: string; text: string }[] = [];
  for (const p of ["A", "B"] as PartnerId[]) {
    const r = reflections[p];
    if (!r) continue;
    const s: Reflection = {};
    if (r.good?.trim() && r.share.good) { s.good = r.good.trim(); lines.push({ name: say("{p}: מה היה טוב", couple, { p: couple[p] }), text: s.good }); }
    if (r.learned?.trim() && r.share.learned) { s.learned = r.learned.trim(); lines.push({ name: say("{p}: מה {p:למד|למדה}", couple, { p: couple[p] }), text: s.learned }); }
    if (s.good || s.learned) shared[p] = s;
  }
  const facts = [`${minutes} דקות יחד`, `${date.cardsTalked} ${date.cardsTalked === 1 ? "שאלה" : "שאלות"}`];
  if (date.breaks) facts.push(date.breaks === 1 ? "הפסקה אחת" : `${date.breaks} הפסקות`);
  const dateLine = new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  const content = { title: say("הערב של {a} ו{b}", couple), dateLine, facts: [deck.title, ...facts], lines, step: step.trim() || undefined };
  const contentKey = JSON.stringify(content);

  useEffect(() => {
    void renderSummary(content).then(setImage);
  }, [contentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async () => {
    const privateOnly: Partial<Record<PartnerId, Reflection>> = {};
    for (const p of ["A", "B"] as PartnerId[]) {
      const r = reflections[p];
      if (!r) continue;
      privateOnly[p] = { good: r.share.good ? undefined : r.good?.trim() || undefined, learned: r.share.learned ? undefined : r.learned?.trim() || undefined };
    }
    store.finishDate(
      {
        id: `${Date.now().toString(36)}`,
        deckIds: Array.from(new Set(date.cards.map((c) => c.deckId))),
        startedAt: startedIso,
        endedAt: new Date().toISOString(),
        talkMinutes: minutes,
        cardsTalked: date.cardsTalked,
        breaks: date.breaks,
        shared
      },
      privateOnly
    );
    if (step.trim()) {
      if (!(await notificationsAllowed())) await askNotifications();
      await store.setWeeklyStep(step.trim());
    }
    go({ name: "home" });
  };

  return (
    <Screen
      title="כרטיס הסיכום"
      actions={
        <>
          <button className="btn btn-primary" onClick={() => void finish()}>שומרים ומסיימים</button>
          {image && <button className="btn btn-secondary" onClick={() => void shareImage(image, "couple-lab-evening.png", "הערב שלנו")}>שיתוף כתמונה</button>}
        </>
      }
    >
      {image ? <img src={image} alt="כרטיס הסיכום של הערב" style={{ width: "100%", borderRadius: 14 }} /> : <div className="card">מכינים את הכרטיס…</div>}
      <p className="small muted">בכרטיס רק מה ששניכם בחרתם להראות. בשיתוף, התמונה עוברת לאפליקציה שתבחרו (וואטסאפ, גלריה…), ומי שתשלחו לו יראה אותה.</p>
      <label className="field">
        צעד קטן לשבוע (לא חובה)
        <input type="text" value={step} onChange={(e) => setStep(e.target.value)} placeholder="למשל: ארוחת בוקר בלי טלפונים ביום שישי" maxLength={80} />
      </label>
      {step.trim() && <p className="small muted">נזכיר לכם בעוד שבוע, בשעה 21:00, בהתראה אחת. אם אנדרואיד ישאל, זה כדי שמותר יהיה להציג אותה.</p>}
    </Screen>
  );
}
