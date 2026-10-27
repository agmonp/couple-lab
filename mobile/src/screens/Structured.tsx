import { useEffect, useState } from "react";
import { defaultSafety } from "@shared/data";
import { resolveSlashForms } from "@shared/deckForms";
import { clock, secondsUntil, breakReturnAt } from "@shared/practiceTiming";
import {
  AFTERMATH_STEPS,
  FEELINGS_PALETTE,
  STRESS_REDUCING_STEPS,
  evaluateAftermathGate,
  structuredKindLabel,
  summarizeStressChange
} from "@shared/structuredSessions";
import type { PartnerId, SafetyState, StructuredSessionKind } from "@shared/types";
import { other } from "../core/model";
import { AFTERMATH_TEXT, LISTENER_RULES_TEXT, STRESS_DRIFT_NOTE, STRESS_TEXT, STRESS_TURN_MINUTES, type StepText } from "../content/sessionText";
import { HELP_LINES, NOT_THERAPY } from "../content/prompts";
import { keepAwake, vibrate } from "../native/device";
import { useNow } from "../hooks";
import { useStore } from "../store";
import { Handoff, LockIcon, PrivateNote, Screen, say } from "../ui";
import { BreakScreen } from "./Break";
import type { Go } from "../App";

/**
 * "אחרי ריב" and "שיחה מפחיתת לחץ" on one phone, dark screens.
 *
 * Safety: each partner answers the safety check alone. If either marks fear,
 * coercion, threats or violence, the shared gate (evaluateAftermathGate) blocks
 * the session. The person who marked it sees the help lines right there, in
 * private; the screen the couple then sees together only says this
 * conversation does not fit tonight, so nobody is exposed for answering. The
 * answers are not stored anywhere.
 */
type Stage =
  | { name: "intro" }
  | { name: "safety-handoff"; who: PartnerId }
  | { name: "safety"; who: PartnerId }
  | { name: "private-help"; who: PartnerId; next: PartnerId | null; reason: string }
  | { name: "stress"; when: "before" | "after" }
  | { name: "not-tonight" }
  | { name: "caution"; reason: string }
  | { name: "step"; index: number; swapped: boolean }
  | { name: "break"; returnAt: number; resume: number; ready: Partial<Record<PartnerId, true>> }
  | { name: "done"; stoppedEarly: boolean };

type SafetyFlag = Exclude<keyof SafetyState, "checkedAt">;

const SAFETY_QUESTIONS: { key: SafetyFlag; text: string }[] = [
  { key: "fearOrCoercion", text: "יש לי פחד מהתגובה, או {you:שאני מרגיש|שאני מרגישה} שאין לי ברירה" },
  { key: "violenceOrThreats", text: "היו איומים, דחיפות או אלימות" },
  { key: "pressuredToParticipate", text: "אני כאן כי לחצו עליי, לא כי אני רוצה" },
  { key: "seriousDepressionOrAddiction", text: "עובר עליי משבר קשה (דיכאון, התמכרות) שצריך עזרה אחרת" }
];

export function Structured({ go, kind }: { go: Go; kind: StructuredSessionKind }) {
  const store = useStore();
  const couple = store.state.couple!;
  const steps = kind === "aftermath" ? AFTERMATH_STEPS : STRESS_REDUCING_STEPS;
  const texts: StepText[] = kind === "aftermath" ? AFTERMATH_TEXT : STRESS_TEXT;
  const [stage, setStage] = useState<Stage>({ name: "intro" });
  const [safety, setSafety] = useState<SafetyState>(defaultSafety);
  const [flagged, setFlagged] = useState(false);
  const [stressBefore, setStressBefore] = useState<Record<PartnerId, number>>({ A: 3, B: 3 });
  const [stressAfter, setStressAfter] = useState<Record<PartnerId, number>>({ A: 3, B: 3 });
  const [first, setFirst] = useState<PartnerId>("A");
  const [turnMinutes, setTurnMinutes] = useState(10);
  const [turnEndsAt, setTurnEndsAt] = useState<number | null>(null);
  const [stepsDone, setStepsDone] = useState(0);
  const now = useNow(turnEndsAt !== null, 500);

  useEffect(() => {
    void keepAwake(true);
    return () => void keepAwake(false);
  }, []);
  useEffect(() => {
    if (turnEndsAt !== null && now >= turnEndsAt) {
      setTurnEndsAt(null);
      void vibrate("turnEnd");
    }
  }, [now, turnEndsAt]);

  const label = structuredKindLabel(kind);
  const back = () => go({ name: "date" });
  const stopTonight = (
    <button className="btn btn-quiet" onClick={() => finish(true)}>זה לא מתאים לנו עכשיו</button>
  );
  const startBreak = () => {
    if (stage.name !== "step") return;
    void vibrate("breakStart");
    setTurnEndsAt(null);
    setStage({ name: "break", returnAt: breakReturnAt(), resume: stage.index, ready: {} });
  };

  function finish(stoppedEarly: boolean) {
    store.finishStructured({
      kind,
      stepsDone,
      stressBefore: kind === "stress-reducing" ? stressBefore : undefined,
      stressAfter: kind === "stress-reducing" && !stoppedEarly ? stressAfter : undefined,
      stoppedEarly
    });
    setStage({ name: "done", stoppedEarly });
  }

  if (stage.name === "intro") {
    const next = () =>
      kind === "aftermath" ? setStage({ name: "safety-handoff", who: first }) : setStage({ name: "stress", when: "before" });
    return (
      <Screen night onBack={back} title={label} actions={<><button className="btn btn-primary" onClick={next}>מתחילים</button>{stopTonight}</>}>
        <h1>{label}</h1>
        {kind === "aftermath" ? (
          <>
            <p className="lead">לעבד יחד ריב שכבר נגמר: להבין מה קרה לכל אחד, לא להכריע מי צדק. רק כשרגועים, לא באמצע סערה.</p>
            <p className="muted">קודם כל אחד עונה לבד על כמה שאלות בטיחות. אחר כך חמישה שלבים, בסדר קבוע.</p>
          </>
        ) : (
          <>
            <p className="lead">לפרוק לחץ שמגיע מבחוץ: עבודה, משפחה, העולם. מי שמקשיב לא פותר, רק תומך.</p>
            <span className="eyebrow">כמה זמן לכל תור?</span>
            <div className="segmented" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              {STRESS_TURN_MINUTES.map((m) => (
                <button key={m} aria-pressed={turnMinutes === m} onClick={() => setTurnMinutes(m)}>{`${m} דק׳`}</button>
              ))}
            </div>
          </>
        )}
        <span className="eyebrow">מי מתחיל?</span>
        <div className="segmented">
          {(["A", "B"] as PartnerId[]).map((p) => (
            <button key={p} aria-pressed={first === p} onClick={() => setFirst(p)}>{couple[p].name}</button>
          ))}
        </div>
      </Screen>
    );
  }

  if (stage.name === "safety-handoff") {
    return (
      <Handoff
        night
        couple={couple}
        to={stage.who}
        lead={say("כמה שאלות שרק {p} {p:רואה|רואה}. התשובות לא נשמרות ולא מוצגות לאף אחד.", couple, { p: couple[stage.who] })}
        onReady={() => setStage({ name: "safety", who: stage.who })}
      />
    );
  }

  if (stage.name === "safety") {
    const who = stage.who;
    const nextWho = who === first ? other(who) : null;
    const [answers, setAnswers] = [safety, setSafety];
    const mine = SAFETY_QUESTIONS.map((q) => ({ ...q, text: say(q.text, couple, { you: couple[who] }) }));
    const proceed = () => {
      const gate = evaluateAftermathGate({ signals: { A: { stress: 0, relaxed: 10 }, B: { stress: 0, relaxed: 10 } }, safety: answers });
      if (!gate.allowed) {
        setFlagged(true);
        setStage({ name: "private-help", who, next: nextWho, reason: gate.blockingReason ?? "" });
        return;
      }
      setSafety(defaultSafety);
      if (nextWho) setStage({ name: "safety-handoff", who: nextWho });
      else setStage(flagged ? { name: "not-tonight" } : { name: "stress", when: "before" });
    };
    return (
      <Screen night title={couple[who].name} actions={<button className="btn btn-primary" onClick={proceed}>המשך</button>}>
        <PrivateNote>{say("{p:רק אתה רואה|רק את רואה} את זה. לא נשמר.", couple, { p: couple[who] })}</PrivateNote>
        <h2>{say("לפני שמתחילים: האם משהו מאלה נכון {you:לגביך|לגבייך} עכשיו?", couple, { you: couple[who] })}</h2>
        <div className="list">
          {mine.map((q) => (
            <label key={q.key} className="list-item">
              <span>{q.text}</span>
              <input type="checkbox" checked={answers[q.key]} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.checked })} style={{ width: "1.6rem", height: "1.6rem" }} />
            </label>
          ))}
        </div>
        <p className="small muted">אם אף אחד לא נכון, ממשיכים.</p>
      </Screen>
    );
  }

  if (stage.name === "private-help") {
    const continueOn = () => {
      setSafety(defaultSafety);
      if (stage.next) setStage({ name: "safety-handoff", who: stage.next });
      else setStage({ name: "not-tonight" });
    };
    return (
      <Screen night title={couple[stage.who].name} actions={<button className="btn btn-primary" onClick={continueOn}>{stage.next ? "להמשיך" : "סגירה"}</button>}>
        <PrivateNote>רק לעיניים שלך</PrivateNote>
        <h2>תודה שענית בכנות.</h2>
        <p className="lead">{stage.reason}</p>
        <div className="card stack">
          {HELP_LINES.map((line) => (
            <div key={line.number} className="help-line">
              <span><strong>{line.title}</strong><br /><span className="small muted">{line.detail}</span></span>
              <a href={`tel:${line.number}`}>{line.number}</a>
            </div>
          ))}
        </div>
        <p className="small muted">על המסך המשותף ייכתב רק שהשיחה הזו לא מתאימה הערב, בלי לומר למה.</p>
      </Screen>
    );
  }

  if (stage.name === "stress") {
    const values = stage.when === "before" ? stressBefore : stressAfter;
    const setValues = stage.when === "before" ? setStressBefore : setStressAfter;
    const proceed = () => {
      if (stage.when === "after") return finish(false);
      if (flagged) return setStage({ name: "not-tonight" });
      if (kind === "aftermath") {
        const gate = evaluateAftermathGate({
          signals: { A: { stress: values.A, relaxed: 10 - values.A }, B: { stress: values.B, relaxed: 10 - values.B } },
          safety: defaultSafety
        });
        if (gate.cautionReason) return setStage({ name: "caution", reason: gate.cautionReason });
      }
      setStage({ name: "step", index: 0, swapped: false });
    };
    return (
      <Screen night title={label} actions={<button className="btn btn-primary" onClick={proceed}>{stage.when === "before" ? "המשך" : "סיום"}</button>}>
        <h2>{stage.when === "before" ? "כמה לחץ יש בגוף עכשיו?" : "ועכשיו?"}</h2>
        <p className="muted">כל אחד מסמן לעצמו. 0 רגוע לגמרי, 10 בסערה.</p>
        {(["A", "B"] as PartnerId[]).map((p) => (
          <label key={p} className="field">
            <span className="row-between"><span>{couple[p].name}</span><span className="display" style={{ fontSize: "1.6rem" }}>{values[p]}</span></span>
            <input className="slider" type="range" min={0} max={10} value={values[p]} onChange={(e) => setValues({ ...values, [p]: Number(e.target.value) })} />
          </label>
        ))}
      </Screen>
    );
  }

  if (stage.name === "not-tonight") {
    return (
      <Screen night actions={<button className="btn btn-primary" onClick={() => go({ name: "home" })}>חזרה הביתה</button>}>
        <div className="stack" style={{ marginTop: "14vh" }}>
          <h1>השיחה הזו לא מתאימה לערב הזה.</h1>
          <p className="lead">זה בסדר. אפשר לבחור הערב שאלה קלה יותר, או פשוט לנוח.</p>
          <p className="muted">{NOT_THERAPY}</p>
          <button className="btn btn-quiet" onClick={() => go({ name: "safety" })}>איפה מקבלים עזרה</button>
        </div>
      </Screen>
    );
  }

  if (stage.name === "caution") {
    return (
      <Screen night actions={<><button className="btn btn-primary" onClick={() => go({ name: "home" })}>נחזור לזה אחר כך</button><button className="btn btn-secondary" onClick={() => setStage({ name: "step", index: 0, swapped: false })}>בכל זאת מתחילים</button></>}>
        <div className="stack" style={{ marginTop: "14vh" }}>
          <h1>רגע לנשום</h1>
          <p className="lead">{stage.reason}</p>
        </div>
      </Screen>
    );
  }

  if (stage.name === "break") {
    return (
      <BreakScreen
        couple={couple}
        returnAt={stage.returnAt}
        ready={stage.ready}
        onReady={(p) => {
          const ready = { ...stage.ready, [p]: true as const };
          if (ready.A && ready.B) setStage({ name: "step", index: stage.resume, swapped: false });
          else setStage({ ...stage, ready });
        }}
      />
    );
  }

  if (stage.name === "step") {
    const step = steps[stage.index];
    const text = texts.find((t) => t.key === step.key)!;
    // Aftermath: whoever opens alternates by step. Stress: turn 2 is the other partner.
    const opener = stage.index % 2 === 0 ? first : other(first);
    const speaker = stage.swapped ? other(opener) : opener;
    const roles = { s: couple[speaker], l: couple[other(speaker)] };
    const isTurnStep = !!text.turn;
    const last = stage.index === steps.length - 1;
    const next = () => {
      setTurnEndsAt(null);
      setStepsDone(Math.max(stepsDone, stage.index + 1));
      if (isTurnStep && !stage.swapped && kind === "aftermath") return setStage({ ...stage, swapped: true });
      if (last) return kind === "stress-reducing" ? setStage({ name: "stress", when: "after" }) : finish(false);
      setStage({ name: "step", index: stage.index + 1, swapped: false });
    };
    const turnSeconds = kind === "stress-reducing" ? turnMinutes * 60 : 120;
    const left = turnEndsAt === null ? null : secondsUntil(turnEndsAt, now);
    return (
      <Screen
        night
        actions={
          <>
            {left === null ? (
              <button className="btn btn-secondary" onClick={() => setTurnEndsAt(Date.now() + turnSeconds * 1000)}>{`טיימר לתור (${Math.round(turnSeconds / 60)} דק׳)`}</button>
            ) : (
              <div className="big-clock" role="timer" style={{ fontSize: "3rem" }}>{clock(left)}</div>
            )}
            <button className="btn btn-primary" onClick={next}>
              {isTurnStep && !stage.swapped && kind === "aftermath" ? "מתחלפים" : last ? "סיימנו את השלבים" : "לשלב הבא"}
            </button>
            {stopTonight}
          </>
        }
      >
        <button className="break-button" onClick={startBreak}>הפסקה</button>
        <div className="stack" style={{ marginTop: "3.5rem" }}>
          <span className="eyebrow">{`${label} · ${stage.index + 1} מתוך ${steps.length}`}</span>
          <h2>{step.title}</h2>
          <p className="muted">{text.intent}</p>
          {text.together && <p className="question">{say(text.together, couple)}</p>}
          {text.turn && <p className="question">{say(text.turn, couple, roles)}</p>}
          {text.perPerson && (["A", "B"] as PartnerId[]).map((p) => (
            <div key={p} className="card">
              <span className="eyebrow">{couple[p].name}</span>
              <p style={{ fontSize: "1.2rem" }}>{say(text.perPerson!, couple, { you: couple[p] })}</p>
            </div>
          ))}
          {step.key === "feelings" && (["A", "B"] as PartnerId[]).map((p) => (
            <div key={p} className="stack">
              <span className="small muted">{`המילים של ${couple[p].name}`}</span>
              <div className="palette">{FEELINGS_PALETTE.map((w) => <span key={w}>{resolveSlashForms(w, couple[p].form)}</span>)}</div>
            </div>
          ))}
          {kind === "stress-reducing" && (
            <div className="card">
              <span className="eyebrow">{say("ל{l}, בזמן ההקשבה", couple, roles)}</span>
              <ol style={{ margin: 0, paddingInlineStart: "1.2rem" }}>
                {LISTENER_RULES_TEXT.map((rule) => <li key={rule}>{say(rule, couple, roles)}</li>)}
              </ol>
              <p className="small muted">{STRESS_DRIFT_NOTE}</p>
            </div>
          )}
        </div>
      </Screen>
    );
  }

  // done
  const change =
    kind === "stress-reducing" && !stage.stoppedEarly
      ? summarizeStressChange(stressBefore, stressAfter, (p) => couple[p].name, (p) => (couple[p].form === "f" ? "סימנה" : "סימן"))
      : null;
  return (
    <Screen night actions={<button className="btn btn-primary" onClick={() => go({ name: "home" })}>חזרה הביתה</button>}>
      <div className="stack" style={{ marginTop: "14vh" }}>
        <span className="lock"><LockIcon /> נשמר רק בטלפון הזה</span>
        <h1>{stage.stoppedEarly ? "עצרתם. גם זה צעד." : "עשיתם את זה יחד."}</h1>
        {change && <p className="lead">{change}</p>}
        {!stage.stoppedEarly && kind === "aftermath" && <p className="lead">את משפט התיקון שבחרתם אפשר לכתוב כצעד לשבוע בסוף ערב הבא.</p>}
        <p className="muted">{NOT_THERAPY}</p>
      </div>
    </Screen>
  );
}
