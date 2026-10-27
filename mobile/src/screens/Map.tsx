import { useState } from "react";
import type { PartnerId } from "@shared/types";
import { type Couple, other } from "../core/model";
import { openDecks } from "../core/questions";
import {
  MAP_DOMAINS,
  type MapRound,
  type MapScores,
  type Practice,
  activeRound,
  focusDomains,
  latestOpenMap,
  mapDone,
  mapOpen,
  practiceFor,
  seenDifferently
} from "../core/relationshipMap";
import { HELP_LINES, NOT_THERAPY } from "../content/prompts";
import { useStore } from "../store";
import { Handoff, LockIcon, PrivateNote, Screen, say } from "../ui";
import type { Go } from "../App";

/** The desktop's line for "conflict" uses a slash form; the phone addresses no one with "/ה". */
const PRACTICE_TEXT: Record<string, string> = {
  conflict: "פתחו בתחושה ובצורך, לא בהאשמה: מה מרגישים, לגבי מה, ומה חסר."
};
const practiceText = (key: string, fallback: string) => PRACTICE_TEXT[key] ?? fallback;

/** The four safety questions of the desktop app, asked to each partner alone. */
const SAFETY_QUESTIONS: { key: string; text: string }[] = [
  { key: "fearOrCoercion", text: "יש בקשר פחד או כפייה." },
  { key: "violenceOrThreats", text: "יש אלימות, איומים, מעקב או הפחדה." },
  { key: "pressuredToParticipate", text: "{p:אני מרגיש|אני מרגישה} לחץ להשתתף בזה." },
  { key: "seriousDepressionOrAddiction", text: "יש משבר פעיל, התמכרות או דיכאון חמור." }
];

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const roundName = (round: string) => `${MONTHS[Number(round.slice(5, 7)) - 1] ?? ""} ${round.slice(0, 4)}`;

type Step =
  | { name: "intro" }
  | { name: "handoff"; to: PartnerId }
  | { name: "fill"; who: PartnerId }
  | { name: "help" }
  | { name: "after-lock"; who: PartnerId }
  | { name: "ask-reveal" }
  | { name: "results" };

export function MapScreen({ go }: { go: Go }) {
  const store = useStore();
  if (store.me) return <MapTwoPhones go={go} me={store.me} />;
  return <MapOnePhone go={go} />;
}

/** Ten domains, one per screen, then the private safety questions. */
function Fill({ couple, who, onBack, onDone }: {
  couple: Couple;
  who: PartnerId;
  onBack: () => void;
  onDone: (scores: MapScores, safety: string[]) => void;
}) {
  const [scores, setScores] = useState<MapScores>({});
  const [index, setIndex] = useState(0);
  const [safety, setSafety] = useState<string[]>([]);
  const person = couple[who];
  const roles = { p: person };

  if (index >= MAP_DOMAINS.length) {
    return (
      <Screen onBack={() => setIndex(MAP_DOMAINS.length - 1)} title={say("המפה של {p}", couple, roles)} actions={
        <button className="btn btn-primary" onClick={() => onDone(scores, safety)}><LockIcon /> סוגרים את המפה</button>
      }>
        <span className="eyebrow">שאלה אחרונה, רק בשבילך</span>
        <h2>משהו מאלה נכון עכשיו?</h2>
        <p className="lead">תרגול זוגי מתאים כשבטוח לשניכם. אם משהו כאן נכון, עדיף עזרה מקצועית קודם.</p>
        <div className="card">
          {SAFETY_QUESTIONS.map((q) => (
            <label key={q.key} className="toggle-row">
              <span>{say(q.text, couple, roles)}</span>
              <input type="checkbox" checked={safety.includes(q.key)} onChange={(e) => setSafety(e.target.checked ? [...safety, q.key] : safety.filter((k) => k !== q.key))} />
            </label>
          ))}
        </div>
        <PrivateNote>{say("התשובה הזו לא עוברת ל{t} ולא מופיעה במפה המשותפת", couple, { t: couple[other(who)] })}</PrivateNote>
      </Screen>
    );
  }

  const domain = MAP_DOMAINS[index];
  const selected = scores[domain.key];
  const pick = (value: number) => {
    setScores({ ...scores, [domain.key]: value });
    // A beat to see the choice land, then on to the next domain.
    window.setTimeout(() => setIndex((i) => (i === index ? i + 1 : i)), 220);
  };
  return (
    <Screen onBack={index === 0 ? onBack : () => setIndex(index - 1)} title={say("המפה של {p}", couple, roles)}>
      <div className="map-progress" aria-label={`שאלה ${index + 1} מתוך ${MAP_DOMAINS.length}`}>
        {MAP_DOMAINS.map((d, i) => <i key={d.key} className={i < index ? "done" : i === index ? "now" : ""} />)}
      </div>
      <span className="eyebrow">{`${index + 1} מתוך ${MAP_DOMAINS.length}`}</span>
      <h2>{domain.label}</h2>
      <p className="lead">{domain.description}</p>
      <div className="scale" role="radiogroup" aria-label={domain.label}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((value) => (
          <button key={value} role="radio" aria-checked={selected === value} className={selected === value ? "on" : ""} onClick={() => pick(value)}>
            {value}
          </button>
        ))}
      </div>
      <div className="scale-ends small muted">
        <span>{say("1: כמעט לא {p:מרגיש|מרגישה} כך עכשיו", couple, roles)}</span>
        <span>{say("10: {p:מרגיש|מרגישה} כך מאוד", couple, roles)}</span>
      </div>
      <PrivateNote>{say("{p:רק אתה רואה|רק את רואה} את זה, עד שתפתחו יחד", couple, roles)}</PrivateNote>
    </Screen>
  );
}

/** Shown right after a partner ticked a safety question. Private to them. */
function SafetyHelp({ onContinue }: { onContinue: () => void }) {
  return (
    <Screen actions={<button className="btn btn-primary" onClick={onContinue}>הבנתי</button>}>
      <h2>תודה שסימנת. זה נשאר רק אצלך.</h2>
      <p className="lead">כשיש פחד, איום או משבר, הצעד הנכון הוא עזרה, לא תרגיל זוגי. אפשר לפנות בכל שעה:</p>
      <div className="card stack">
        {HELP_LINES.map((line) => (
          <div key={line.number} className="help-line">
            <span><strong>{line.title}</strong><br /><span className="small muted">{line.detail}</span></span>
            <a href={`tel:${line.number}`}>{line.number}</a>
          </div>
        ))}
      </div>
      <p className="small muted">{NOT_THERAPY}</p>
    </Screen>
  );
}

function practiceButton(practice: Practice | undefined, go: Go) {
  if (!practice) return null;
  if (practice.kind === "deck") return <button className="btn btn-secondary" onClick={() => go({ name: "date", deckId: practice.deckId })}>מדברים על זה בערב יחד</button>;
  if (practice.kind === "structured") return <button className="btn btn-secondary" onClick={() => go({ name: "structured", kind: practice.session })}>{practice.session === "aftermath" ? "לשיחת 'אחרי ריב'" : "לשיחה מפחיתת לחץ"}</button>;
  if (practice.kind === "daily") return <button className="btn btn-secondary" onClick={() => go({ name: "daily" })}>מתחילים משאלת היום</button>;
  return <button className="btn btn-secondary" onClick={() => go({ name: "ours" })}>כותבים פתק הערכה</button>;
}

export function MapResults({ r, go }: { r: MapRound; go: Go }) {
  const { state } = useStore();
  const a = r.revealed.A!;
  const b = r.revealed.B!;
  const focus = focusDomains(a, b);
  const differently = seenDifferently(a, b, focus.map((f) => f.domain.key));
  const open = openDecks(state.unlockedLayer).map((d) => d.id);
  return (
    <Screen onBack={() => go({ name: "home" })} title="מפת הקשר" actions={<button className="btn btn-primary" onClick={() => go({ name: "home" })}>חזרה לבית</button>}>
      <div className="stack" style={{ gap: "0.2rem" }}>
        <span className="eyebrow">{roundName(r.round)}</span>
        <h1>שלושה נושאים <span className="accent">לתרגל יחד</span></h1>
      </div>
      <p className="lead">זו נקודת פתיחה לשיחה, לא אבחון של הקשר. אין כאן ציון, ואין מי ענה מה.</p>
      {focus.map((f, i) => (
        <div key={f.domain.key} className="card focus-card">
          <div className="row-between">
            <span className="step-label">{`נושא ${i + 1}`}</span>
            {f.differently && <span className="chip chip-warm">ראיתם את זה אחרת</span>}
          </div>
          <h3>{f.domain.label}</h3>
          <p className="small muted">{f.domain.description}</p>
          <p className="quote">{practiceText(f.domain.key, f.domain.practice)}</p>
          {practiceButton(practiceFor(f.domain.key, open), go)}
        </div>
      ))}
      {differently.length > 0 && (
        <div className="card">
          <h3>ראיתם אחרת גם כאן</h3>
          <p className="small muted">לא מי צודק, אלא מה כל אחד רואה. שווה לשאול: "איך זה נראה מהצד שלך?"</p>
          <div className="row" style={{ flexWrap: "wrap" }}>{differently.map((d) => <span key={d.key} className="chip">{d.label}</span>)}</div>
        </div>
      )}
      <p className="small muted">את המפה ממלאים שוב בחודש הבא, כדי לראות מה זז.</p>
    </Screen>
  );
}

function Intro({ couple, onPick, onBack, two }: { couple: Couple; onPick?: (p: PartnerId) => void; onBack: () => void; two?: () => void }) {
  return (
    <Screen onBack={onBack} title="מפת הקשר" actions={
      two ? <button className="btn btn-primary" onClick={two}>מתחילים</button> : (
        <>
          {(["A", "B"] as PartnerId[]).map((p) => (
            <button key={p} className={`btn ${p === "A" ? "btn-primary" : "btn-secondary"}`} onClick={() => onPick?.(p)}>
              {say("{p} {p:ממלא ראשון|ממלאת ראשונה}", couple, { p: couple[p] })}
            </button>
          ))}
        </>
      )
    }>
      <div className="stack" style={{ gap: "0.2rem" }}>
        <span className="eyebrow">עשר שאלות, חמש דקות</span>
        <h1>איפה אנחנו <span className="accent">עכשיו?</span></h1>
      </div>
      <p className="lead">כל אחד מדרג לבד עשרה תחומים בקשר, מ-1 עד 10, לפי התחושה שלו עכשיו. אין תשובה נכונה.</p>
      <div className="card">
        <div className="check-line"><LockIcon /> <span>המפה של כל אחד נסגרת ונפתחת רק כששניכם סיימתם, יחד.</span></div>
        <div className="check-line"><LockIcon /> <span>מה שנפתח: שלושה נושאים לתרגל, ואיפה אתם רואים דברים אחרת. בלי ציון ובלי השוואה.</span></div>
        <div className="check-line"><LockIcon /> <span>ממלאים פעם בחודש, כדי לראות מה זז.</span></div>
      </div>
    </Screen>
  );
}

function MapOnePhone({ go }: { go: Go }) {
  const store = useStore();
  const { state } = store;
  const couple = state.couple!;
  const r = activeRound(state);
  const latest = latestOpenMap(state);
  const done = (p: PartnerId) => r.locked[p] !== undefined;
  const initial = (): Step => {
    if (latest && !done("A") && !done("B") && latest.round === r.round) return { name: "results" };
    if (done("A") && done("B")) return { name: "ask-reveal" };
    if (done("A")) return { name: "handoff", to: "B" };
    if (done("B")) return { name: "handoff", to: "A" };
    return { name: "intro" };
  };
  const [step, setStep] = useState<Step>(initial);
  const [ready, setReady] = useState<Partial<Record<PartnerId, true>>>({});
  const [afterHelp, setAfterHelp] = useState<PartnerId | null>(null);
  const home = () => go({ name: "home" });

  if (mapOpen(state.maps[r.round]) || step.name === "results") {
    const shown = mapOpen(state.maps[r.round]) ? state.maps[r.round] : latest;
    if (shown) return <MapResults r={shown} go={go} />;
  }

  if (step.name === "intro") return <Intro couple={couple} onBack={home} onPick={(p) => setStep({ name: "fill", who: p })} />;
  if (step.name === "handoff") return <Handoff couple={couple} to={step.to} lead={say("עכשיו המפה של {p}.", couple, { p: couple[step.to] })} onReady={() => setStep({ name: "fill", who: step.to })} />;
  if (step.name === "help") return <SafetyHelp onContinue={() => setStep({ name: "after-lock", who: afterHelp ?? "A" })} />;

  if (step.name === "fill") {
    const who = step.who;
    return (
      <Fill key={who} couple={couple} who={who} onBack={home} onDone={(scores, safety) => {
        store.lockMap(who, scores, safety);
        setAfterHelp(who);
        setStep(safety.length ? { name: "help" } : { name: "after-lock", who });
      }} />
    );
  }

  if (step.name === "after-lock" && !done(other(step.who))) {
    const next = other(step.who);
    return (
      <Screen actions={
        <>
          <button className="btn btn-primary" onClick={() => setStep({ name: "handoff", to: next })}>{say("מעבירים ל{p}", couple, { p: couple[next] })}</button>
          <button className="btn btn-quiet" onClick={home}>{say("{p} {p:ימלא|תמלא} אחר כך", couple, { p: couple[next] })}</button>
        </>
      }>
        <div className="stack" style={{ marginTop: "16vh" }}>
          <span className="lock" style={{ fontSize: "1.1rem" }}><LockIcon size={22} /> נסגר</span>
          <h1>המפה נסגרה.</h1>
          <p className="lead">{say("היא תיפתח רק אחרי ש{n} {n:ימלא את שלו|תמלא את שלה}, ושניכם תאשרו.", couple, { n: couple[next] })}</p>
        </div>
      </Screen>
    );
  }

  const both = ready.A && ready.B;
  return (
    <Screen onBack={home} actions={
      <>
        {(["A", "B"] as PartnerId[]).map((p) => (
          <button key={p} className={`btn ${ready[p] ? "btn-secondary" : "btn-primary"}`} disabled={!!ready[p]} onClick={() => {
            const next = { ...ready, [p]: true as const };
            setReady(next);
            if (next.A && next.B) {
              store.revealMap();
              setStep({ name: "results" });
            }
          }}>
            {ready[p] ? say("{p} {p:מוכן|מוכנה}", couple, { p: couple[p] }) : say("{p}: {p:מוכן|מוכנה} לפתוח", couple, { p: couple[p] })}
          </button>
        ))}
      </>
    }>
      <div className="stack" style={{ marginTop: "14vh" }}>
        <span className="eyebrow">שניכם מילאתם</span>
        <h1>פותחים את המפה יחד?</h1>
        <p className="lead">שבו יחד מול המסך. המפה נפתחת כששניכם מאשרים.</p>
        {both && <p className="muted">פותחים…</p>}
      </div>
    </Screen>
  );
}

/** Two phones: each fills on their own phone; only "done" crosses until both agree to open. */
function MapTwoPhones({ go, me }: { go: Go; me: PartnerId }) {
  const store = useStore();
  const { state, link } = store;
  const couple = state.couple!;
  const r = activeRound(state);
  const latest = latestOpenMap(state);
  const them = other(me);
  const [filling, setFilling] = useState(false);
  const [help, setHelp] = useState(false);
  const home = () => go({ name: "home" });

  if (help) return <SafetyHelp onContinue={() => setHelp(false)} />;
  if (mapOpen(state.maps[r.round])) return <MapResults r={state.maps[r.round]} go={go} />;

  if (!mapDone(r, me)) {
    if (filling) {
      return <Fill couple={couple} who={me} onBack={() => setFilling(false)} onDone={(scores, safety) => {
        store.lockMap(me, scores, safety);
        setFilling(false);
        if (safety.length) setHelp(true);
      }} />;
    }
    if (latest && latest.round === r.round) return <MapResults r={latest} go={go} />;
    return <Intro couple={couple} onBack={home} two={() => setFilling(true)} />;
  }

  if (!mapDone(r, them)) {
    return (
      <Screen onBack={home} actions={<button className="btn btn-primary" onClick={home}>חזרה לבית</button>}>
        <div className="stack" style={{ marginTop: "16vh" }}>
          <span className="lock" style={{ fontSize: "1.1rem" }}><LockIcon size={22} /> נסגר</span>
          <h1>המפה שלך נסגרה.</h1>
          <p className="lead">{say("כש{t} {t:ימלא|תמלא} בטלפון {t:שלו|שלה} והטלפונים ייפגשו, תוכלו לפתוח יחד.", couple, { t: couple[them] })}</p>
          <p className="small muted">{say("{t} {t:יידע|תדע} רק שמילאת, לא מה.", couple, { t: couple[them] })}</p>
        </div>
      </Screen>
    );
  }

  const myConsent = !!r.consent[me];
  const theirConsent = !!r.consent[them];
  return (
    <Screen onBack={home} actions={
      myConsent ? undefined : <button className="btn btn-primary" onClick={() => store.consentMap()}>{say("אני {p:מוכן|מוכנה} לפתוח", couple, { p: couple[me] })}</button>
    }>
      <div className="stack" style={{ marginTop: "12vh" }}>
        <span className="eyebrow">שניכם מילאתם</span>
        <h1>פותחים את המפה יחד?</h1>
        <p className="lead">שבו יחד. כל אחד מאשר בטלפון שלו, והמפה נפתחת כששניכם אישרתם.</p>
        <div className="card">
          <p>{myConsent ? say("{p} {p:מוכן|מוכנה}", couple, { p: couple[me] }) : say("{p} עוד לא {p:אישר|אישרה}", couple, { p: couple[me] })}</p>
          <p>{theirConsent ? say("{p} {p:מוכן|מוכנה}", couple, { p: couple[them] }) : say("מחכים ל{p}", couple, { p: couple[them] })}</p>
        </div>
        {myConsent && theirConsent && <p className="muted">פותחים…</p>}
        {myConsent && !link.connected && <p className="small muted">הטלפונים לא בקשר כרגע. האישור יעבור כשיהיו קרובים.</p>}
      </div>
    </Screen>
  );
}
