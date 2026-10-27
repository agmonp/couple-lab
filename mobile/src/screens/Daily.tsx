import { useEffect, useState } from "react";
import type { PartnerId } from "@shared/types";
import { type Couple, type DayState, answered, bothRevealed, dayKey, other } from "../core/model";
import { questionText } from "../core/questions";
import { REVEAL_FOLLOW_UPS } from "../content/prompts";
import { useStore } from "../store";
import { Handoff, LockIcon, PrivateNote, Screen, say } from "../ui";
import type { Go } from "../App";

type Step =
  | { name: "first" }
  | { name: "handoff"; to: PartnerId }
  | { name: "answer"; who: PartnerId }
  | { name: "after-lock"; who: PartnerId }
  | { name: "ask-reveal" }
  | { name: "reveal" };

/** A soft two-note chime for the reveal, made on the spot (no audio file). */
function chime() {
  try {
    const ctx = new AudioContext();
    [523.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 1);
    });
  } catch {
    /* no audio: the reveal still happens */
  }
}

/** The answer, and an optional guess of the other's answer (the plan's "guess what they said"). */
function AnswerScreen({ d, couple, who, onBack, onLock }: {
  d: DayState;
  couple: Couple;
  who: PartnerId;
  onBack: () => void;
  onLock: (text: string, guess: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [guess, setGuess] = useState("");
  const person = couple[who];
  return (
    <Screen
      onBack={onBack}
      title={say("התור של {p}", couple, { p: person })}
      actions={<button className="btn btn-primary" disabled={!draft.trim()} onClick={() => onLock(draft.trim(), guess.trim())}><LockIcon /> נועלים את התשובה</button>}
    >
      <p className="question">{questionText(d.question!, couple, who)}</p>
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="כמה מילים מספיקות" aria-label="התשובה שלך" />
      <label className="field">
        <span className="small">{say("ומה לדעתך {t} {t:יענה|תענה}? (לא חובה)", couple, { t: couple[other(who)] })}</span>
        <input type="text" value={guess} onChange={(e) => setGuess(e.target.value)} maxLength={140} aria-label="ניחוש" />
      </label>
      <PrivateNote>{say("{p:רק אתה רואה|רק את רואה} את זה, עד שתחשפו יחד", couple, { p: person })}</PrivateNote>
    </Screen>
  );
}

function Reveal({ d, couple, go }: { d: DayState; couple: Couple; go: Go }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => {
      setOpen(true);
      chime();
    }, 350);
    return () => window.clearTimeout(t);
  }, []);
  const followUp = REVEAL_FOLLOW_UPS[Number(dayKey().slice(-2)) % REVEAL_FOLLOW_UPS.length];
  return (
    <Screen onBack={() => go({ name: "home" })} title="חשיפה" actions={<button className="btn btn-primary" onClick={() => go({ name: "date" })}>מדברים על זה, עם הטלפון למטה</button>}>
      <div className="reveal-grid">
        {(["A", "B"] as PartnerId[]).map((p) => {
          const guesser = other(p);
          const guess = d.guesses[guesser];
          return (
            <div key={p} className={`flip ${open ? "open" : ""}`}>
              <div className="flip-inner">
                <div className="flip-face flip-front"><LockIcon size={28} /><strong>{couple[p].name}</strong></div>
                <div className="flip-face flip-back">
                  <span className="eyebrow">{couple[p].name}</span>
                  <p className="small muted">{questionText(d.asked[p] ?? d.question!, couple, p)}</p>
                  <p style={{ fontSize: "1.15rem" }}>{d.revealed[p] ?? d.locked[p]}</p>
                  {guess && <p className="small muted">{`${say("{g} {g:ניחש|ניחשה}", couple, { g: couple[guesser] })}: ${guess}`}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="card">
        <span className="eyebrow">שאלה אחת להמשך</span>
        <p>{say(followUp, couple)}</p>
      </div>
    </Screen>
  );
}

/**
 * Two phones: each answers on their own phone, any time of day. Only "answered"
 * crosses to the other phone; the texts cross once both agreed to reveal.
 */
function DailyTwoPhones({ go, me }: { go: Go; me: PartnerId }) {
  const store = useStore();
  const { state, link } = store;
  const couple = state.couple!;
  const d = state.days[dayKey()];
  if (!d?.question) return null;
  const home = () => go({ name: "home" });
  const them = other(me);

  if (bothRevealed(d)) return <Reveal d={d} couple={couple} go={go} />;

  if (d.locked[me] === undefined && d.revealed[me] === undefined) {
    return <AnswerScreen d={d} couple={couple} who={me} onBack={home} onLock={(text, guess) => store.lockAnswer(me, text, guess)} />;
  }

  if (!answered(d, them)) {
    return (
      <Screen onBack={home} actions={<button className="btn btn-primary" onClick={home}>חזרה לבית</button>}>
        <div className="stack" style={{ marginTop: "16vh" }}>
          <span className="lock" style={{ fontSize: "1.1rem" }}><LockIcon size={22} /> ננעל</span>
          <h1>ננעל עד שתהיו יחד.</h1>
          <p className="lead">{say("כש{t} {t:יענה|תענה} בטלפון {t:שלו|שלה} והטלפונים ייפגשו, תוכלו לחשוף יחד.", couple, { t: couple[them] })}</p>
          <p className="small muted">{say("{t} {t:יידע|תדע} רק שיש תשובה, לא מה כתוב בה.", couple, { t: couple[them] })}</p>
        </div>
      </Screen>
    );
  }

  const myConsent = !!d.consent[me];
  const theirConsent = !!d.consent[them];
  return (
    <Screen onBack={home} actions={
      myConsent ? undefined : <button className="btn btn-primary" onClick={() => store.consentReveal()}>{say("אני {p:מוכן|מוכנה} לחשוף", couple, { p: couple[me] })}</button>
    }>
      <div className="stack" style={{ marginTop: "12vh" }}>
        <span className="eyebrow">שניכם עניתם</span>
        <h1>חושפים יחד?</h1>
        <p className="lead">שבו יחד. כל אחד מאשר בטלפון שלו, והתשובות נפתחות כששניכם אישרתם.</p>
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

export function Daily({ go }: { go: Go }) {
  const store = useStore();
  if (store.me) return <DailyTwoPhones go={go} me={store.me} />;
  return <DailyOnePhone go={go} />;
}

function DailyOnePhone({ go }: { go: Go }) {
  const store = useStore();
  const { state } = store;
  const couple = state.couple!;
  const d = state.days[dayKey()];
  const locked = (p: PartnerId) => d?.locked[p] !== undefined;
  const bothLocked = locked("A") && locked("B");
  const revealed = bothRevealed(d);

  const initial = (): Step => {
    if (revealed) return { name: "reveal" };
    if (bothLocked) return { name: "ask-reveal" };
    if (locked("A")) return { name: "handoff", to: "B" };
    if (locked("B")) return { name: "handoff", to: "A" };
    return { name: "first" };
  };
  const [step, setStep] = useState<Step>(initial);
  const [ready, setReady] = useState<Partial<Record<PartnerId, true>>>({});

  if (!d?.question) return null;
  const home = () => go({ name: "home" });

  if (step.name === "first") {
    return (
      <Screen onBack={home} title="שאלת היום" actions={
        <>
          {(["A", "B"] as PartnerId[]).map((p) => (
            <button key={p} className={`btn ${p === "A" ? "btn-primary" : "btn-secondary"}`} onClick={() => setStep({ name: "answer", who: p })}>
              {say("{p} {p:עונה ראשון|עונה ראשונה}", couple, { p: couple[p] })}
            </button>
          ))}
          <button className="btn btn-quiet" onClick={() => store.chooseLighterToday()}>משהו קל יותר</button>
        </>
      }>
        <h2>מי עונה ראשון?</h2>
        <p className="lead">כל אחד עונה לבד, בסתר. התשובות נשמרות נעולות, ונפתחות רק כששניכם עניתם, יחד.</p>
        <PrivateNote>נשמר רק בטלפון הזה</PrivateNote>
      </Screen>
    );
  }

  if (step.name === "handoff") {
    return <Handoff couple={couple} to={step.to} onReady={() => setStep({ name: "answer", who: step.to })} />;
  }

  if (step.name === "answer") {
    const who = step.who;
    return (
      <AnswerScreen key={who} d={d} couple={couple} who={who} onBack={home} onLock={(text, guess) => {
        store.lockAnswer(who, text, guess);
        setStep({ name: "after-lock", who });
      }} />
    );
  }

  if (step.name === "after-lock") {
    const next = other(step.who);
    if (locked(next)) return askReveal();
    return (
      <Screen
        actions={
          <>
            <button className="btn btn-primary" onClick={() => setStep({ name: "handoff", to: next })}>{say("מעבירים ל{p}", couple, { p: couple[next] })}</button>
            <button className="btn btn-quiet" onClick={home}>{say("{p} {p:יענה|תענה} אחר כך", couple, { p: couple[next] })}</button>
          </>
        }
      >
        <div className="stack" style={{ marginTop: "16vh" }}>
          <span className="lock" style={{ fontSize: "1.1rem" }}><LockIcon size={22} /> ננעל</span>
          <h1>ננעל עד שתהיו יחד.</h1>
          <p className="lead">{say("התשובה של {p} מחכה. היא תיפתח רק אחרי ש{n} {n:יענה|תענה}, ושניכם תאשרו.", couple, { p: couple[step.who], n: couple[next] })}</p>
        </div>
      </Screen>
    );
  }

  function askReveal() {
    const both = ready.A && ready.B;
    return (
      <Screen onBack={home} actions={
        <>
          {(["A", "B"] as PartnerId[]).map((p) => (
            <button key={p} className={`btn ${ready[p] ? "btn-secondary" : "btn-primary"}`} disabled={!!ready[p]} onClick={() => {
              const next = { ...ready, [p]: true as const };
              setReady(next);
              if (next.A && next.B) {
                store.revealToday();
                setStep({ name: "reveal" });
              }
            }}>
              {ready[p] ? say("{p} {p:מוכן|מוכנה}", couple, { p: couple[p] }) : say("{p}: {p:מוכן|מוכנה} לחשוף", couple, { p: couple[p] })}
            </button>
          ))}
        </>
      }>
        <div className="stack" style={{ marginTop: "14vh" }}>
          <span className="eyebrow">שניכם עניתם</span>
          <h1>חושפים יחד?</h1>
          <p className="lead">שבו יחד מול המסך. התשובות נפתחות כששניכם מאשרים.</p>
          {both && <p className="muted">פותחים…</p>}
        </div>
      </Screen>
    );
  }

  if (step.name === "ask-reveal") return askReveal();

  return <Reveal d={d} couple={couple} go={go} />;
}
