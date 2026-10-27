import { useState } from "react";
import type { AddressForm } from "@shared/deckForms";
import { buildReminderIcs } from "@shared/calendarReminder";
import { DAILY_ID } from "../core/reminders";
import { HELP_LINES, NOT_THERAPY } from "../content/prompts";
import { askNotifications, cancelNotification, isNative, notificationsAllowed, shareTextFile } from "../native/device";
import { useStore } from "../store";
import { LockIcon, Screen } from "../ui";
import { HapticPractice } from "./Break";
import type { Go } from "../App";

export function More({ go }: { go: Go }) {
  const store = useStore();
  const { settings, state } = store;
  const [asking, setAsking] = useState(false);
  const [denied, setDenied] = useState(false);

  const toggleDaily = async (on: boolean) => {
    if (!on) {
      await store.updateSettings({ notifyOn: false });
      await cancelNotification(DAILY_ID);
      return;
    }
    if (!(await notificationsAllowed())) {
      setAsking(true);
      return;
    }
    await store.updateSettings({ notifyOn: true });
  };

  return (
    <Screen tabs>
      <div className="stack" style={{ gap: "0.2rem" }}>
        <span className="eyebrow">עוד</span>
        <h1>הגדרות ומידע</h1>
      </div>

      <div className="card">
        <label className="toggle-row">
          <span><strong>תזכורת אחת ביום</strong><br /><span className="small muted">בשעה שתבחרו, בלי לחץ ובלי ספירת ימים.</span></span>
          <input type="checkbox" checked={settings.notifyOn} onChange={(e) => void toggleDaily(e.target.checked)} />
        </label>
        {asking && (
          <div className="stack">
            <p className="small">כדי להזכיר לכם, אנדרואיד צריך לאשר שהאפליקציה מציגה התראה. אחת ביום לכל היותר.</p>
            <button className="btn btn-secondary" onClick={async () => {
              const ok = await askNotifications();
              setAsking(false);
              setDenied(!ok);
              if (ok) await store.updateSettings({ notifyOn: true });
            }}>אישור התראות</button>
          </div>
        )}
        {denied && <p className="small muted">בלי אישור לא נשלח תזכורת. אפשר לשנות בהגדרות האפליקציה באנדרואיד.</p>}
        {!isNative && <p className="small muted">בדפדפן אין התראות. הן פועלות באפליקציה בטלפון.</p>}
        {settings.notifyOn && (
          <label className="field">
            באיזו שעה?
            <input type="time" value={settings.notifyTime} onChange={(e) => void store.updateSettings({ notifyTime: e.target.value })} />
          </label>
        )}
      </div>

      {state.weeklyStep && (
        <div className="card">
          <span className="eyebrow">הצעד לשבוע</span>
          <p>{state.weeklyStep.text}</p>
          <button className="btn btn-quiet" onClick={() => void shareTextFile(buildReminderIcs({ step: state.weeklyStep!.text }), "couple-lab-step.ics", "הוספה ליומן")}>להוסיף גם ליומן</button>
        </div>
      )}

      <div className="list">
        <button className="list-item" onClick={() => go({ name: "practice" })}><span><strong>שפת הרטט</strong><small>לתרגל שוב את ארבעת הדפוסים</small></span></button>
        <button className="list-item" onClick={() => go({ name: "names" })}><span><strong>שמות ולשון פנייה</strong><small>{`${state.couple?.A.name} ו${state.couple?.B.name}`}</small></span></button>
        <button className="list-item" onClick={() => go({ name: "privacy" })}><span><strong>פרטיות</strong><small>מה נשמר ואיפה</small></span><LockIcon /></button>
        <button className="list-item" onClick={() => go({ name: "safety" })}><span><strong>בטיחות ועזרה</strong><small>118, ער"ן 1201, ומה האפליקציה לא</small></span></button>
      </div>
      <p className="small muted">{NOT_THERAPY}</p>
    </Screen>
  );
}

export function PracticeScreen({ go }: { go: Go }) {
  const store = useStore();
  return <HapticPractice night={false} onDone={() => { void store.updateSettings({ hapticsPracticed: true }); go({ name: "more" }); }} />;
}

export function NamesScreen({ go }: { go: Go }) {
  const store = useStore();
  const couple = store.state.couple!;
  const [a, setA] = useState({ name: couple.A.name, form: couple.A.form as AddressForm });
  const [b, setB] = useState({ name: couple.B.name, form: couple.B.form as AddressForm });
  const ok = a.name.trim() && b.name.trim() && a.name.trim() !== b.name.trim();
  return (
    <Screen onBack={() => go({ name: "more" })} title="שמות ולשון פנייה" actions={
      <button className="btn btn-primary" disabled={!ok} onClick={() => { store.setCouple({ ...a, name: a.name.trim() }, { ...b, name: b.name.trim() }); go({ name: "more" }); }}>שומרים</button>
    }>
      {[{ v: a, set: setA }, { v: b, set: setB }].map(({ v, set }, i) => (
        <div key={i} className="card">
          <input type="text" value={v.name} onChange={(e) => set({ ...v, name: e.target.value })} maxLength={24} aria-label="שם" />
          <div className="segmented">
            <button aria-pressed={v.form === "m"} onClick={() => set({ ...v, form: "m" })}>בלשון זכר</button>
            <button aria-pressed={v.form === "f"} onClick={() => set({ ...v, form: "f" })}>בלשון נקבה</button>
          </div>
        </div>
      ))}
    </Screen>
  );
}

export function PrivacyScreen({ go }: { go: Go }) {
  const store = useStore();
  const [confirm, setConfirm] = useState(false);
  return (
    <Screen onBack={() => go({ name: "more" })} title="פרטיות" actions={
      confirm ? (
        <>
          <button className="btn btn-warm" onClick={() => void store.eraseEverything()}>כן, למחוק הכל מהטלפון</button>
          <button className="btn btn-quiet" onClick={() => setConfirm(false)}>ביטול</button>
        </>
      ) : <button className="btn btn-secondary" onClick={() => setConfirm(true)}>מחיקת כל המידע</button>
    }>
      <h2>הכל נשאר בטלפון הזה.</h2>
      <div className="card stack">
        <p><strong>אין חשבון, אין שרת, אין ענן.</strong> שום דבר לא נשלח מהאפליקציה לשום מקום.</p>
        <p><LockIcon /> <strong>תשובות לפני חשיפה</strong> נשמרות נעולות, ומוצגות רק כששניכם עניתם ואישרתם.</p>
        <p><LockIcon /> <strong>מה שבחרתם לא להראות</strong> בסוף ערב נשאר רק אצל מי שכתב אותו, ולא מופיע בכרטיס.</p>
        <p><strong>שאלות הבטיחות</strong> לפני "אחרי ריב" לא נשמרות בכלל.</p>
        <p><strong>שיתוף</strong> קורה רק כשאתם לוחצים "שיתוף כתמונה", ורק לאפליקציה שתבחרו.</p>
        <p className="small muted">שימו לב: מי שפותח את הטלפון יכול לפתוח גם את האפליקציה. נעילת מסך שומרת עליה.</p>
      </div>
      {confirm && <p className="notice">המחיקה סופית: תשובות, ערבים, פתקים והגדרות. אי אפשר לשחזר.</p>}
    </Screen>
  );
}

export function SafetyScreen({ go }: { go: Go }) {
  return (
    <Screen onBack={() => go({ name: "more" })} title="בטיחות ועזרה">
      <h2>אם יש פחד, איום או אלימות, עוצרים כאן.</h2>
      <p className="lead">תרגול זוגי מתאים לבני זוג שמרגישים בטוחים זה עם זה. כשזה לא המצב, הצעד הנכון הוא עזרה מקצועית, לא תרגיל.</p>
      <div className="card stack">
        {HELP_LINES.map((line) => (
          <div key={line.number} className="help-line">
            <span><strong>{line.title}</strong><br /><span className="small muted">{line.detail}</span></span>
            <a href={`tel:${line.number}`}>{line.number}</a>
          </div>
        ))}
      </div>
      <div className="card">
        <h3>טיפול זוגי</h3>
        <p>כשנתקעים באותו ויכוח, כשמשהו כבד מדי לשיחה לבד, או כשרוצים ליווי: יועץ או יועצת זוגיים יכולים לעזור. אין צורך לחכות למשבר.</p>
      </div>
      <p className="muted">{NOT_THERAPY}</p>
    </Screen>
  );
}
