import { useEffect, useState } from "react";
import { BREAK_MINUTES, CALMING_STEPS, clock, secondsUntil } from "@shared/practiceTiming";
import type { PartnerId } from "@shared/types";
import { BREATH_CYCLE_MS, BREATH_IN_MS, HAPTICS, patternMs } from "../core/haptics";
import type { Couple } from "../core/model";
import { BREAK_RETURN_LINE, DISTRACTIONS } from "../content/prompts";
import { stopVibration, vibrate } from "../native/device";
import { useNow } from "../hooks";
import { Screen, say } from "../ui";

/**
 * The agreed 20-minute break. Breathing in the hand (4 in, 6 out), something
 * else to do, and the way back only when both say they are ready.
 */
export function BreakScreen({ couple, returnAt, ready, onReady }: {
  couple: Couple;
  returnAt: number;
  ready: Partial<Record<PartnerId, true>>;
  onReady: (partner: PartnerId) => void;
}) {
  const now = useNow(true, 1000);
  const [breathing, setBreathing] = useState(true);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [idea, setIdea] = useState(0);
  const left = secondsUntil(returnAt, now);

  useEffect(() => {
    if (!breathing) return;
    let outTimer = 0;
    let id = 0;
    const cycle = () => {
      setPhase("in");
      void vibrate("breatheIn");
      outTimer = window.setTimeout(() => setPhase("out"), BREATH_IN_MS);
    };
    // The first breath waits for the "break started" signal to finish; a new vibration cuts the one playing.
    const firstBreath = window.setTimeout(() => {
      cycle();
      id = window.setInterval(cycle, BREATH_CYCLE_MS);
    }, patternMs("breakStart") + 300);
    return () => {
      window.clearTimeout(firstBreath);
      window.clearInterval(id);
      window.clearTimeout(outTimer);
      void stopVibration();
    };
  }, [breathing]);

  return (
    <Screen
      night
      actions={
        <>
          {(["A", "B"] as PartnerId[]).map((p) => (
            <button key={p} className={`btn ${ready[p] ? "btn-secondary" : "btn-primary"}`} disabled={!!ready[p]} onClick={() => onReady(p)}>
              {ready[p] ? say("{p} {p:מוכן|מוכנה}. מחכים ל{o}", couple, { p: couple[p], o: couple[p === "A" ? "B" : "A"] }) : say("{p}: אני {p:מוכן|מוכנה}", couple, { p: couple[p] })}
            </button>
          ))}
        </>
      }
    >
      <span className="eyebrow">הפסקה מוסכמת · {BREAK_MINUTES} דקות</span>
      <h2>{left > 0 ? "עוצרים כדי לחזור קרובים יותר" : "הזמן עבר. חוזרים כששניכם מוכנים"}</h2>
      <div className="big-clock" role="timer" aria-label={`נותרו ${clock(left)}`}>{clock(left)}</div>

      <div className="card">
        <div className={`breath ${phase}`} aria-hidden="true" />
        <p style={{ textAlign: "center", fontSize: "1.2rem" }}>{breathing ? (phase === "in" ? "שואפים… (4)" : "נושפים לאט… (6)") : "הנשימה מושתקת"}</p>
        <p className="small muted" style={{ textAlign: "center" }}>{HAPTICS.breatheIn.meaning}</p>
        <button className="btn btn-quiet" onClick={() => setBreathing((b) => !b)}>{breathing ? "בלי רטט נשימה" : "להחזיר את רטט הנשימה"}</button>
      </div>

      <div className="card">
        <span className="eyebrow">משהו אחר לעשות עכשיו</span>
        <p style={{ fontSize: "1.15rem" }}>{DISTRACTIONS[idea % DISTRACTIONS.length]}</p>
        <button className="btn btn-quiet" onClick={() => setIdea((i) => i + 1)}>רעיון אחר</button>
      </div>

      <ul className="muted" style={{ margin: 0, paddingInlineStart: "1.2rem" }}>
        {CALMING_STEPS.map((step) => <li key={step}>{step}</li>)}
      </ul>
      <p>{BREAK_RETURN_LINE}</p>
    </Screen>
  );
}

/** Learn the four patterns once: 20 seconds, one after another. */
export function HapticPractice({ onDone, night = true }: { onDone: () => void; night?: boolean }) {
  const order = ["turnEnd", "breakStart", "breatheIn", "dateEnd"] as const;
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    if (index < 0 || index >= order.length) return;
    void vibrate(order[index]);
    const t = window.setTimeout(() => setIndex((i) => i + 1), 5000);
    return () => window.clearTimeout(t);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = index >= order.length;
  return (
    <Screen
      night={night}
      title="שפת הרטט"
      actions={
        index < 0 ? (
          <>
            <button className="btn btn-primary" onClick={() => setIndex(0)}>מרגישים את זה (20 שניות)</button>
            <button className="btn btn-quiet" onClick={onDone}>דילוג</button>
          </>
        ) : (
          <button className="btn btn-primary" disabled={!done} onClick={onDone}>{done ? "הבנו" : "מרגישים…"}</button>
        )
      }
    >
      <p className="lead">בזמן השיחה הטלפון מונח עם המסך למטה. הוא מדבר אליכם רק ברטט:</p>
      <div className="list">
        {order.map((name, i) => (
          <div key={name} className="list-item" style={i === index ? { borderColor: "#9fd0c2" } : undefined}>
            <span>
              <strong>{HAPTICS[name].label}</strong>
              <small>{HAPTICS[name].meaning}</small>
            </span>
            {i === index && <span aria-live="polite">עכשיו</span>}
          </div>
        ))}
      </div>
    </Screen>
  );
}
