import { useEffect, useState } from "react";
import type { PartnerId } from "@shared/types";
import { dayKey, other } from "../core/model";
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

export function Daily({ go }: { go: Go }) {
  const store = useStore();
  const { state } = store;
  const couple = state.couple!;
  const d = state.days[dayKey()];
  const locked = (p: PartnerId) => d?.locked[p] !== undefined;
  const bothLocked = locked("A") && locked("B");
  const revealed = d?.revealed.A !== undefined && d?.revealed.B !== undefined;

  const initial = (): Step => {
    if (revealed) return { name: "reveal" };
    if (bothLocked) return { name: "ask-reveal" };
    if (locked("A")) return { name: "handoff", to: "B" };
    if (locked("B")) return { name: "handoff", to: "A" };
    return { name: "first" };
  };
  const [step, setStep] = useState<Step>(initial);
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState<Partial<Record<PartnerId, true>>>({});
  const [open, setOpen] = useState(revealed);

  useEffect(() => {
    if (step.name === "reveal" && !open) {
      const t = window.setTimeout(() => {
        setOpen(true);
        chime();
      }, 350);
      return () => window.clearTimeout(t);
    }
  }, [step.name, open]);

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
    const person = couple[who];
    const lock = () => {
      store.lockAnswer(who, draft.trim());
      setDraft("");
      setStep({ name: "after-lock", who });
    };
    return (
      <Screen
        onBack={home}
        title={say("התור של {p}", couple, { p: person })}
        actions={<button className="btn btn-primary" disabled={!draft.trim()} onClick={lock}><LockIcon /> נועלים את התשובה</button>}
      >
        <p className="question">{questionText(d.question, couple, who)}</p>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="כמה מילים מספיקות" aria-label="התשובה שלך" />
        <PrivateNote>{say("{p:רק אתה רואה|רק את רואה} את זה, עד שתחשפו יחד", couple, { p: person })}</PrivateNote>
      </Screen>
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

  // Reveal: the one festive screen.
  const followUp = REVEAL_FOLLOW_UPS[Number(dayKey().slice(-2)) % REVEAL_FOLLOW_UPS.length];
  return (
    <Screen onBack={home} title="חשיפה" actions={<button className="btn btn-primary" onClick={() => go({ name: "date" })}>מדברים על זה, עם הטלפון למטה</button>}>
      <div className="reveal-grid">
        {(["A", "B"] as PartnerId[]).map((p) => (
          <div key={p} className={`flip ${open ? "open" : ""}`}>
            <div className="flip-inner">
              <div className="flip-face flip-front"><LockIcon size={28} /><strong>{couple[p].name}</strong></div>
              <div className="flip-face flip-back">
                <span className="eyebrow">{couple[p].name}</span>
                <p className="small muted">{questionText(d.question!, couple, p)}</p>
                <p style={{ fontSize: "1.15rem" }}>{d.revealed[p] ?? d.locked[p]}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <span className="eyebrow">שאלה אחת להמשך</span>
        <p>{say(followUp, couple)}</p>
      </div>
    </Screen>
  );
}
