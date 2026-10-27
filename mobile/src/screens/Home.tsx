import { useEffect } from "react";
import type { PartnerId } from "@shared/types";
import { answered, bothRevealed, dayKey, deckById, deeperLayerOffer, jarWaitingFor, other } from "../core/model";
import { WELCOME_BACK } from "../content/prompts";
import { vibrate } from "../native/device";
import { linkAvailable, sendSignal } from "../native/pair";
import { useStore } from "../store";
import { LockIcon, Screen, say } from "../ui";
import type { Go } from "../App";

const LAYERS: Record<number, { name: string; goal: string }> = {
  2: { name: "חיבה והערכה", goal: "להרגיל את העין לראות את הטוב, ולומר אותו בקול." },
  3: { name: "פנייה זה לזה", goal: "לשים לב לפניות הקטנות לקרבה, ולהיענות להן." }
};

export function Home({ go }: { go: Go }) {
  const { state, settings, welcomeBack, ensureToday, consentLayer, updateSettings, me, link, peerDateOn } = useStore();
  const couple = state.couple!;
  const today = dayKey();
  const d = state.days[today];
  useEffect(() => ensureToday(), [today]); // eslint-disable-line react-hooks/exhaustive-deps

  const deck = d?.question ? deckById(d.question.deckId) : undefined;
  const locked = (p: PartnerId) => answered(d, p);
  const revealed = bothRevealed(d);
  const answeredCount = Number(locked("A")) + Number(locked("B"));

  const offer = deeperLayerOffer(state);
  const showOffer = offer && settings.deeperLaterOn !== today;
  const consent = offer ? state.consent[offer] ?? {} : {};
  // Two phones: each phone shows the notes waiting for its own person.
  const jarA = me === "B" ? 0 : jarWaitingFor(state, "A").length;
  const jarB = me === "A" ? 0 : jarWaitingFor(state, "B").length;

  const status = (p: PartnerId) => {
    if (me === p) return locked(p) ? "ענית" : "עוד לא ענית";
    if (locked(p)) return say("{p} {p:ענה|ענתה}", couple, { p: couple[p] });
    // The other phone's answer is known only after the phones met.
    if (me && p !== me) return say("{p}: עוד אין תשובה", couple, { p: couple[p] });
    return say("{p} עוד לא {p:ענה|ענתה}", couple, { p: couple[p] });
  };

  let primary = <button className="btn btn-primary" onClick={() => go({ name: "daily" })}>עונים על שאלת היום</button>;
  if (me) {
    if (revealed) primary = <button className="btn btn-primary" onClick={() => go({ name: "date" })}>מתחילים ערב יחד</button>;
    else if (answeredCount === 2) primary = <button className="btn btn-primary" onClick={() => go({ name: "daily" })}>חושפים יחד</button>;
    else if (locked(me)) primary = <button className="btn btn-primary" onClick={() => go({ name: "date" })}>מתחילים ערב יחד</button>;
  } else if (answeredCount === 1) {
    const next = locked("A") ? "B" : "A";
    primary = <button className="btn btn-primary" onClick={() => go({ name: "daily" })}>{say("ממשיכים: התור של {p}", couple, { p: couple[next] })}</button>;
  } else if (answeredCount === 2 && !revealed) {
    primary = <button className="btn btn-primary" onClick={() => go({ name: "daily" })}>חושפים יחד</button>;
  } else if (revealed) {
    primary = <button className="btn btn-primary" onClick={() => go({ name: "date" })}>מתחילים ערב יחד</button>;
  }
  const them = me ? other(me) : undefined;
  const heroLine = revealed
    ? "שניכם עניתם וחשפתם. אפשר לדבר על זה הערב."
    : me && them && locked(them) && !locked(me)
      ? say("{p} {p:ענה|ענתה}, ומחכה לשמוע אותך.", couple, { p: couple[them] })
      : "כל אחד עונה בסתר. התשובות נפתחות רק כששניכם עניתם, יחד.";
  const invite = !link.paired && linkAvailable && state.dates.length >= 2;

  return (
    <Screen
      tabs
      actions={
        <>
          {primary}
          {revealed
            ? <button className="btn btn-quiet" onClick={() => go({ name: "daily" })}>לראות שוב את התשובות</button>
            : <button className="btn btn-quiet" onClick={() => go({ name: "date" })}>או ערב יחד, עם הטלפון למטה</button>}
        </>
      }
    >
      <div className="stack" style={{ gap: "0.2rem" }}>
        <span className="eyebrow">הערב שלנו</span>
        <h1>{say("{a} ו{b}", couple)}</h1>
      </div>

      {welcomeBack && !d?.locked.A && !d?.locked.B && <p className="notice">{WELCOME_BACK}</p>}

      {peerDateOn && them && (
        <div className="card card-warm">
          <h3>{say("ערב יחד בטלפון של {p}", couple, { p: couple[them] })}</h3>
          <p className="small">צריכים לעצור? ההפסקה מרטיטה את שני הטלפונים, ו-20 דקות מתחילות.</p>
          <button className="btn btn-secondary" onClick={() => {
            const returnAt = Date.now() + 20 * 60 * 1000;
            void sendSignal("break", { returnAt });
            void vibrate("breakStart");
            go({ name: "remote-break", returnAt });
          }}>הפסקה</button>
        </div>
      )}

      <div className="card card-hero">
        <div className="row-between">
          <span className="eyebrow">שאלת היום</span>
          {deck && <span className="small muted">{deck.title}</span>}
        </div>
        <p className="question">{heroLine}</p>
        {!revealed && <div className="row" style={{ flexWrap: "wrap" }}>
          {(["A", "B"] as PartnerId[]).map((p) => (
            <span key={p} className="chip" style={{ background: "#ffffff22", color: "inherit" }}>
              {locked(p) && <LockIcon size={14} />} {status(p)}
            </span>
          ))}
        </div>}
      </div>

      {showOffer && offer && (
        <div className="card card-warm">
          <h3>מוכנים להעמיק?</h3>
          <p>{`השלב הבא: ${LAYERS[offer].name}. ${LAYERS[offer].goal}`}</p>
          <p className="small muted">נפתח רק כששניכם מסכימים. תמיד אפשר לחזור לשאלות קלות.</p>
          <div className="row">
            {(["A", "B"] as PartnerId[]).map((p) => (
              <button key={p} className="btn btn-secondary" disabled={!!consent[p] || (!!me && p !== me)} onClick={() => consentLayer(offer, p)}>
                {consent[p] ? say("{p} {p:מוכן|מוכנה}", couple, { p: couple[p] }) : say("{p}: אני {p:מוכן|מוכנה}", couple, { p: couple[p] })}
              </button>
            ))}
          </div>
          <button className="btn btn-quiet" onClick={() => void updateSettings({ deeperLaterOn: today })}>לא היום</button>
        </div>
      )}

      {(jarA > 0 || jarB > 0) && (
        <button className="list-item" onClick={() => go({ name: "ours" })}>
          <span>
            <strong>יש פתק בצנצנת</strong>
            <small>
              {[jarA ? say("מחכה ל{p}", couple, { p: couple.A }) : "", jarB ? say("מחכה ל{p}", couple, { p: couple.B }) : ""].filter(Boolean).join(" · ")}
            </small>
          </span>
          <span aria-hidden="true">←</span>
        </button>
      )}

      {invite && (
        <button className="list-item" onClick={() => go({ name: "pair" })}>
          <span>
            <strong>רוצים לענות כל אחד מהטלפון שלו?</strong>
            <small>שאלת היום במהלך היום, חשיפה כשנפגשים, פתקים שמגיעים ישר. בלי שרת.</small>
          </span>
          <span aria-hidden="true">←</span>
        </button>
      )}

      {state.weeklyStep && (
        <div className="card">
          <span className="eyebrow">הצעד שבחרנו השבוע</span>
          <p>{state.weeklyStep.text}</p>
        </div>
      )}
    </Screen>
  );
}
