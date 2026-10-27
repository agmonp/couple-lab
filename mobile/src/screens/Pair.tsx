import { useEffect, useState } from "react";
import type { PartnerId } from "@shared/types";
import { other } from "../core/model";
import { Pair as PairPlugin, linkAvailable } from "../native/pair";
import { useStore } from "../store";
import { LockIcon, Screen, say } from "../ui";

/**
 * Two phones (plan §3.3, stage 2): pair once with a QR code and four digits,
 * then see whether the phones are in touch, sync by hand, or unpair.
 */
type Step =
  | { name: "start" }
  | { name: "permission"; then: "host" | "join" }
  | { name: "host"; qr: string }
  /** `link`: already scanned (camera app); otherwise scan after the warning. */
  | { name: "join-warning"; link?: string }
  | { name: "joining" };

const ERRORS: Record<string, string> = {
  "sas-mismatch": "הספרות לא היו זהות, אז לא חיברנו. אפשר לנסות שוב, קרוב יותר זה לזה.",
  "wrong-key": "הקוד לא תאם את הטלפון שנמצא. אפשר לסרוק שוב.",
  "same-person": "שני הטלפונים בחרו את אותו אדם. בכל טלפון בוחרים מי מחזיק אותו.",
  disconnected: "החיבור נקטע באמצע. מקרבים את הטלפונים ומנסים שוב."
};

function when(iso?: string) {
  if (!iso) return "עוד לא";
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  const time = at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `היום, ${time}` : `${at.toLocaleDateString("he-IL", { day: "numeric", month: "long" })}, ${time}`;
}

export function PairScreen({ onBack, initialLink }: { onBack: () => void; initialLink?: string }) {
  const store = useStore();
  const { link, state } = store;
  const couple = state.couple;
  const [step, setStep] = useState<Step>({ name: "start" });
  const [me, setMe] = useState<PartnerId>("A");
  const [failed, setFailed] = useState<string | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [started, setStarted] = useState<string | null>(null);

  const join = async (text: string) => {
    setFailed(null);
    setStep({ name: "joining" });
    if (!(await store.joinPairing(text))) {
      setFailed("זה לא קוד צימוד של Couple Lab.");
      setStep({ name: "start" });
    }
  };

  const withPermission = async (then: "host" | "join") => {
    if (!(await store.askNearby())) {
      setStep({ name: "permission", then });
      return;
    }
    if (then === "host") {
      const { qr } = await store.hostPairing(me);
      setStep({ name: "host", qr });
    } else if (couple) {
      setStep({ name: "join-warning" });
    } else {
      await scan();
    }
  };

  const scan = async () => {
    const { text } = await PairPlugin.scanQr().catch(() => ({ text: "" }));
    if (text) await join(text);
    else setStep({ name: "start" });
  };

  // A link opened from outside (the camera app, or a second scan) starts joining once.
  useEffect(() => {
    if (!initialLink || started === initialLink || link.paired) return;
    setStarted(initialLink);
    void (async () => {
      if (!(await store.askNearby())) {
        setStep({ name: "permission", then: "join" });
        return;
      }
      if (couple) setStep({ name: "join-warning", link: initialLink });
      else await join(initialLink);
    })();
  }, [initialLink]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => {
    if (!link.paired) void store.cancelPairing();
    onBack();
  };

  if (!linkAvailable) {
    return (
      <Screen onBack={onBack} title="שני טלפונים">
        <h2>חיבור בין טלפונים עובד באפליקציה בטלפון.</h2>
        <p className="lead">בדפדפן אפשר להמשיך בטלפון אחד.</p>
      </Screen>
    );
  }

  // The digits: the only moment both people must look at both screens.
  if (link.phase === "sas" && link.sas) {
    return (
      <Screen title="שני טלפונים" actions={
        link.waitingForPeer ? undefined : (
          <>
            <button className="btn btn-primary" onClick={() => void store.confirmSas(true)}>כן, אותן ספרות</button>
            <button className="btn btn-quiet" onClick={() => void store.confirmSas(false)}>לא, הספרות שונות</button>
          </>
        )
      }>
        <div className="stack" style={{ marginTop: "8vh" }}>
          <span className="eyebrow">בדיקה אחרונה</span>
          <h1>אותן ספרות בשני הטלפונים?</h1>
          <p className="big-clock" style={{ letterSpacing: "0.3em" }} aria-label={`הספרות: ${link.sas.split("").join(" ")}`}>{link.sas}</p>
          <p className="lead">כך יודעים שהטלפון השני הוא באמת שלכם, ולא טלפון אחר בסביבה.</p>
          {link.waitingForPeer && <p className="notice">מחכים לאישור בטלפון השני…</p>}
        </div>
      </Screen>
    );
  }

  if (link.paired) {
    const peer = link.peerMe && couple ? couple[link.peerMe] : undefined;
    const mine = link.me && couple ? couple[link.me] : undefined;
    if (!couple) {
      return (
        <Screen title="שני טלפונים">
          <div className="stack" style={{ marginTop: "14vh" }}>
            <span className="eyebrow">מחוברים</span>
            <h1>מקבלים את מה שכבר יש לכם…</h1>
            <p className="lead">השמות, הערבים והפתקים עוברים מהטלפון השני. השאירו את הטלפונים קרובים ואת האפליקציה פתוחה בשניהם.</p>
            <p className="muted">{link.connected ? "הטלפונים מחוברים עכשיו." : "מחפשים את הטלפון השני…"}</p>
          </div>
        </Screen>
      );
    }
    return (
      <Screen onBack={onBack} title="שני טלפונים" actions={
        confirmUnpair ? (
          <>
            <button className="btn btn-warm" onClick={() => void store.unpair().then(() => setConfirmUnpair(false))}>כן, לנתק</button>
            <button className="btn btn-quiet" onClick={() => setConfirmUnpair(false)}>ביטול</button>
          </>
        ) : (
          <>
            <button className="btn btn-primary" onClick={() => void store.syncNow()}>לסנכרן עכשיו</button>
            <button className="btn btn-quiet" onClick={() => setConfirmUnpair(true)}>ניתוק הטלפונים</button>
          </>
        )
      }>
        <h2>{peer ? say("מחוברים לטלפון של {p}", couple, { p: peer }) : "הטלפונים מחוברים"}</h2>
        {confirmUnpair && peer && (
          <p className="notice">{say("ניתוק עוצר את ההעברות מעכשיו. מה שכבר עבר לטלפון של {p} נשאר שם, ומה שנמצא כאן נשאר כאן.", couple, { p: peer })}</p>
        )}
        <div className="card">
          <div className="row-between">
            <strong>{link.connected ? "בקשר עכשיו" : "לא בטווח כרגע"}</strong>
            <span className="chip">{link.connected ? "מחובר" : "ממתין"}</span>
          </div>
          <p className="small muted">{link.connected ? "מה ששניכם משתפים עובר מיד." : "כשהטלפונים יהיו קרובים, מה שחסר יעבור לבד. הכי בטוח: לפתוח את האפליקציה בשניהם."}</p>
          <p className="small">{`סונכרן לאחרונה: ${when(link.lastSyncAt)}`}</p>
          {mine && <p className="small muted">{say("בטלפון הזה: {p}", couple, { p: mine })}</p>}
        </div>
        <div className="card stack">
          <h3>מה עובר ומה לא</h3>
          <p><strong>עובר:</strong> תשובות אחרי ששניכם אישרתם חשיפה, פתקים ששלחתם, ערבים וכרטיסי סיכום, הצעד לשבוע.</p>
          <p><LockIcon /> <strong>לא עובר לעולם:</strong> תשובה לפני חשיפה, ומה שבחרתם לא להראות בסוף ערב.</p>
          <p className="small muted">בלי שרת ובלי אינטרנט: בלוטות' ו-Wi-Fi ישיר בין שני הטלפונים, בהצפנה שרק הם מכירים.</p>
        </div>
        <div className="card">
          <h3>אם הסנכרון לא קורה ברקע</h3>
          <p className="small">בחלק מהטלפונים (OPPO, Xiaomi) המערכת עוצרת אפליקציות ברקע. בהגדרות האפליקציה, תחת "סוללה", בוחרים "ללא הגבלה".</p>
          <button className="btn btn-quiet" onClick={() => void PairPlugin.openAppSettings()}>להגדרות האפליקציה</button>
        </div>
      </Screen>
    );
  }

  if (link.phase === "searching" || link.phase === "connecting" || link.phase === "connected" || step.name === "joining") {
    const host = step.name === "host";
    return (
      <Screen onBack={leave} title="שני טלפונים" actions={<button className="btn btn-quiet" onClick={leave}>ביטול</button>}>
        {host && step.name === "host" && <img src={step.qr} alt="קוד צימוד" style={{ width: "min(100%, 18rem)", alignSelf: "center", borderRadius: 12 }} />}
        <div className="stack" style={{ marginTop: host ? 0 : "14vh" }}>
          <h2>{link.phase === "connected" ? "נמצא! עוד רגע…" : "מחפשים את הטלפון השני…"}</h2>
          <p className="lead">מחזיקים את הטלפונים קרוב, עם האפליקציה פתוחה בשניהם.</p>
        </div>
      </Screen>
    );
  }

  if (step.name === "host") {
    const partner = couple ? couple[other(me)] : undefined;
    return (
      <Screen onBack={leave} title="שני טלפונים" actions={<button className="btn btn-quiet" onClick={leave}>ביטול</button>}>
        <h2>{partner && couple ? say("{p} {p:סורק|סורקת} את הקוד", couple, { p: partner }) : "סורקים את הקוד מהטלפון השני"}</h2>
        <img src={step.qr} alt="קוד צימוד" style={{ width: "min(100%, 18rem)", alignSelf: "center", borderRadius: 12, background: "#fff" }} />
        <p className="lead">בטלפון השני פותחים את Couple Lab ובוחרים "לסרוק קוד". אפשר גם עם המצלמה של הטלפון.</p>
        <p className="small muted">הקוד טוב לצימוד הזה בלבד, וכולל מפתח הצפנה חד-פעמי.</p>
      </Screen>
    );
  }

  if (step.name === "permission") {
    return (
      <Screen onBack={() => setStep({ name: "start" })} title="שני טלפונים" actions={
        <button className="btn btn-primary" onClick={() => void withPermission(step.then)}>לנסות שוב</button>
      }>
        <h2>צריך אישור ל"מכשירים בקרבת מקום"</h2>
        <p className="lead">כך הטלפון מוצא את הטלפון השני בבלוטות' וב-Wi-Fi, בלי אינטרנט ובלי שרת.</p>
        <p>אנדרואיד מבקש גם "מיקום מדויק", כי חיפוש מכשירים בבלוטות' נחשב אצלו לעניין של מיקום. האפליקציה לא קוראת ולא שומרת את המיקום שלכם.</p>
        <p className="small muted">אם אנדרואיד כבר לא שואל: הגדרות האפליקציה ← הרשאות ← מכשירים בקרבת מקום.</p>
        <button className="btn btn-quiet" onClick={() => void PairPlugin.openAppSettings()}>להגדרות האפליקציה</button>
      </Screen>
    );
  }

  if (step.name === "join-warning") {
    return (
      <Screen onBack={() => setStep({ name: "start" })} title="שני טלפונים" actions={
        <>
          <button className="btn btn-primary" onClick={() => void (step.link ? join(step.link) : scan())}>{step.link ? "מבינים, לחבר" : "מבינים, לסרוק"}</button>
          <button className="btn btn-quiet" onClick={() => setStep({ name: "start" })}>ביטול</button>
        </>
      }>
        <h2>הטלפון הזה יקבל את ההיסטוריה מהטלפון השני</h2>
        <p className="lead">בטלפון הזה כבר יש ערבים ותשובות. בצימוד הוא מתחיל מחדש ומקבל את מה שיש בטלפון שמציג את הקוד. מה שנשמר רק כאן יימחק.</p>
        <p className="small muted">אם ההיסטוריה החשובה נמצאת דווקא כאן, מציגים את הקוד מהטלפון הזה וסורקים מהשני.</p>
      </Screen>
    );
  }

  // Start
  return (
    <Screen onBack={leave} title="שני טלפונים" actions={
      <>
        {couple && <button className="btn btn-primary" onClick={() => void withPermission("host")}>להציג קוד לטלפון השני</button>}
        <button className={`btn ${couple ? "btn-secondary" : "btn-primary"}`} onClick={() => void withPermission("join")}>לסרוק קוד מהטלפון השני</button>
      </>
    }>
      <h2>כל אחד מהטלפון שלו</h2>
      <p className="lead">עונים על שאלת היום במהלך היום, כל אחד לבד. כשאתם נפגשים, התשובות נחשפות יחד. פתקים מגיעים לטלפון של מי שהם בשבילו.</p>
      {failed && <p className="notice">{failed}</p>}
      {link.phase === "error" && link.error && <p className="notice">{ERRORS[link.error] ?? "החיבור לא הצליח. מקרבים את הטלפונים ומנסים שוב."}</p>}
      {couple && (
        <div className="card">
          <h3>מי מחזיק את הטלפון הזה?</h3>
          <div className="segmented" role="group" aria-label="מי בטלפון הזה">
            {(["A", "B"] as PartnerId[]).map((p) => (
              <button key={p} aria-pressed={me === p} onClick={() => setMe(p)}>{couple[p].name}</button>
            ))}
          </div>
          <p className="small muted">{say("מהטלפון הזה עונים ושולחים בשם {p}.", couple, { p: couple[me] })}</p>
        </div>
      )}
      <div className="card stack">
        <p><LockIcon /> תשובה לפני חשיפה לא יוצאת מהטלפון. רק "ענית" עובר, ורק כשהטלפונים קרובים.</p>
        <p className="small muted">בלי חשבון ובלי שרת. הטלפונים מדברים ישירות, רק כשהם קרובים זה לזה.</p>
      </div>
      <p className="small muted">בהמשך אנדרואיד יבקש אישור ל"מכשירים בקרבת מקום" ול"מיקום מדויק". הם משמשים רק כדי למצוא את הטלפון השני. המיקום עצמו לא נקרא ולא נשמר.</p>
    </Screen>
  );
}
