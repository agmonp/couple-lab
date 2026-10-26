import { useEffect, useRef, useState } from "react";
import { Ear, HeartHandshake, MessageCircle, Pause, Play, RotateCcw, Wind } from "lucide-react";

export const LISTENING_TURN_SECONDS = 120;

function clock(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

/** Always-visible two-line reminder of each role, for free (non-structured) questions. */
export function SpeakerListenerTip({ speakerName, listenerName }: { speakerName: string; listenerName: string }) {
  return (
    <div className="role-tip" aria-label="הנחיה לדובר ולמקשיב">
      <p><MessageCircle size={16} aria-hidden="true" /><strong>{speakerName} מדבר/ת:</strong> דוגמה אחת מסוימת, במשפטי "אני" ולא "את/ה תמיד".</p>
      <p><Ear size={16} aria-hidden="true" /><strong>{listenerName} מקשיב/ה:</strong> לפני שעונים, משקפים במשפט אחד מה ששמעתם ובודקים "הבנתי נכון?"</p>
    </div>
  );
}

/**
 * A two-minute turn for the speaker. When it ends the listener is invited to
 * reflect; nothing is recorded or scored by the timer itself.
 */
export function ListeningTurnTimer({ speakerName, listenerName }: { speakerName: string; listenerName: string }) {
  const [left, setLeft] = useState(LISTENING_TURN_SECONDS);
  const [running, setRunning] = useState(false);
  const endsAt = useRef(0);

  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => {
      const remaining = Math.ceil((endsAt.current - Date.now()) / 1000);
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) setRunning(false);
    }, 250);
    return () => window.clearInterval(tick);
  }, [running]);

  const start = () => {
    const from = left > 0 ? left : LISTENING_TURN_SECONDS;
    endsAt.current = Date.now() + from * 1000;
    setLeft(from);
    setRunning(true);
  };
  const reset = () => {
    setRunning(false);
    setLeft(LISTENING_TURN_SECONDS);
  };
  const done = left === 0;

  return (
    <div className={`turn-timer ${running ? "is-running" : ""} ${done ? "is-done" : ""}`}>
      <div className="turn-timer-copy">
        <strong>תור של שתי דקות</strong>
        <small aria-live="polite">
          {done
            ? `הזמן נגמר. ${listenerName}, שקפ/י במשפט אחד מה ששמעת, ואז מחליפים.`
            : running
              ? `${speakerName} מדבר/ת, ${listenerName} רק מקשיב/ה.`
              : "כשיודעים שיש זמן בלי הפרעה, קל יותר להקשיב עד הסוף."}
        </small>
      </div>
      <span className="turn-timer-clock" dir="ltr" role="timer" aria-label={`נותרו ${clock(left)}`}>{clock(left)}</span>
      <div className="turn-timer-actions">
        {running ? (
          <button className="secondary" onClick={() => setRunning(false)}><Pause size={16} aria-hidden="true" /> השהיה</button>
        ) : (
          <button className="secondary" onClick={start}><Play size={16} aria-hidden="true" /> {left === LISTENING_TURN_SECONDS ? "התחלת התור" : done ? "תור חדש" : "המשך"}</button>
        )}
        {left !== LISTENING_TURN_SECONDS && (
          <button className="text-button" onClick={reset} aria-label="איפוס הטיימר"><RotateCcw size={15} aria-hidden="true" /></button>
        )}
      </div>
    </div>
  );
}

const calmingSteps = [
  "כל אחד הולך למקום אחר בבית.",
  "נושמים לאט: שאיפה של 4, נשיפה של 6.",
  "שותים מים, זזים קצת, מוזיקה שקטה.",
  "לא מנסחים בראש תשובות לוויכוח. נותנים לגוף להירגע."
];

/**
 * Full-screen agreed break. The recording is already stopped by the caller;
 * this shows the time left and lets the couple come back when both are ready.
 */
export function CalmingBreak({ returnAt, requestedBy, onResume }: { returnAt: number; requestedBy: string; onResume: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const resumeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    resumeRef.current?.focus();
    return () => window.clearInterval(tick);
  }, []);

  const left = Math.max(0, Math.ceil((returnAt - now) / 1000));
  const returnClock = new Date(returnAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="calming-break-overlay" role="dialog" aria-modal="true" aria-labelledby="calming-break-title">
      <div className="calming-break-card">
        <span className="calming-break-badge"><Wind size={16} aria-hidden="true" /> הפסקה מוסכמת · ההקלטה נעצרה</span>
        <h2 id="calming-break-title">{left > 0 ? "עוצרים כדי לחזור קרובים יותר" : "הזמן עבר. חוזרים כשאתם מוכנים"}</h2>
        <p className="calming-break-lead">{requestedBy} ביקש/ה הפסקה. חוזרים לשיחה בשעה <bdi>{returnClock}</bdi>, כדי שאף אחד לא ירגיש שנטשו אותו.</p>
        <div className="calming-break-clock" dir="ltr" role="timer" aria-label={`נותרו ${clock(left)}`}>{clock(left)}</div>
        <ul>
          {calmingSteps.map((step) => <li key={step}>{step}</li>)}
        </ul>
        <p className="calming-break-return">כשחוזרים, מתחילים במשפט אחד של אכפתיות, למשל: "אני רוצה שנבין זה את זו."</p>
        <button ref={resumeRef} className="primary" onClick={onResume}>
          <HeartHandshake size={17} aria-hidden="true" /> {left > 0 ? "שנינו רגועים, חוזרים עכשיו" : "חוזרים לשיחה"}
        </button>
      </div>
    </div>
  );
}
