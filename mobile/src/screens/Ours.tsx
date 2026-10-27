import { useState } from "react";
import type { PartnerId } from "@shared/types";
import { type JarItem, achievements, jarWaitingFor, other } from "../core/model";
import { useStore } from "../store";
import { Handoff, LockIcon, Screen, say } from "../ui";
import type { Go } from "../App";

type View =
  | { name: "list" }
  | { name: "write-who" }
  | { name: "write"; from: PartnerId }
  | { name: "open-handoff"; who: PartnerId }
  | { name: "open"; who: PartnerId; note: JarItem };

/**
 * "שלנו": the appreciation jar (write now, the partner opens later), what we
 * did together, and shared descriptive milestones. Nothing here compares
 * the two of you or scores anything.
 */
export function Ours({ go }: { go: Go }) {
  const store = useStore();
  const { state } = store;
  const couple = state.couple!;
  const [view, setView] = useState<View>({ name: "list" });
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<PartnerId | null>(null);

  if (view.name === "write-who") {
    return (
      <Screen tabs onBack={() => setView({ name: "list" })} title="צנצנת ההערכות" actions={
        <>{(["A", "B"] as PartnerId[]).map((p) => (
          <button key={p} className="btn btn-primary" onClick={() => setView({ name: "write", from: p })}>{say("אני {p}", couple, { p: couple[p] })}</button>
        ))}</>
      }>
        <h2>מי כותב?</h2>
        <p className="lead">פתק על משהו קטן ומסוים שהיה טוב לכם. הוא נשמר סגור עד שהצד השני יבחר לפתוח אותו.</p>
      </Screen>
    );
  }

  if (view.name === "write") {
    const to = other(view.from);
    return (
      <Screen
        tabs
        onBack={() => setView({ name: "list" })}
        title={couple[view.from].name}
        actions={
          <button className="btn btn-primary" disabled={!draft.trim()} onClick={() => {
            store.writeJar(view.from, to, draft.trim());
            setDraft("");
            setSaved(to);
            setView({ name: "list" });
          }}>
            {say("סוגרים ושמים בצנצנת ל{t}", couple, { t: couple[to] })}
          </button>
        }
      >
        <h2>{say("מה הערכת ב{t} לאחרונה?", couple, { t: couple[to] })}</h2>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="למשל: שהבאת לי מים בלי שביקשתי" aria-label="הפתק" />
        <p className="lock"><LockIcon /> {say("זה יעבור ל{t}. {t:הוא יפתח|היא תפתח} את זה מתי {t:שירצה|שתרצה}.", couple, { t: couple[to] })}</p>
      </Screen>
    );
  }

  if (view.name === "open-handoff") {
    return (
      <Handoff
        tabs
        couple={couple}
        to={view.who}
        lead={say("יש פתק שמחכה ל{p} בצנצנת.", couple, { p: couple[view.who] })}
        onReady={() => {
          const note = jarWaitingFor(state, view.who)[0];
          if (note) setView({ name: "open", who: view.who, note });
          else setView({ name: "list" });
        }}
      />
    );
  }

  if (view.name === "open") {
    const note = view.note;
    return (
      <Screen tabs actions={<button className="btn btn-primary" onClick={() => { store.openJar(note.id, view.who); setView({ name: "list" }); }}>שומרים בצנצנת הפתוחה</button>}>
        <div className="stack" style={{ marginTop: "12vh" }}>
          <span className="eyebrow">{say("מ{f}, ל{t}", couple, { f: couple[note.from], t: couple[note.to] })}</span>
          <p className="question" style={{ fontSize: "1.7rem" }}>{note.text}</p>
          <p className="small muted">{new Date(note.writtenAt).toLocaleDateString("he-IL", { day: "numeric", month: "long" })}</p>
        </div>
      </Screen>
    );
  }

  const earned = achievements(state);
  const opened = state.jar.filter((n) => n.openedAt).reverse();
  const timeline = [...state.timeline].reverse().slice(0, 30);
  return (
    <Screen tabs actions={<button className="btn btn-primary" onClick={() => setView({ name: "write-who" })}>כותבים פתק הערכה</button>}>
      <div className="stack" style={{ gap: "0.2rem" }}>
        <span className="eyebrow">שלנו</span>
        <h1>מה שבנינו יחד</h1>
      </div>
      {saved && <p className="notice">{say("הפתק סגור בצנצנת. {t} {t:יראה|תראה} אותו כאן.", couple, { t: couple[saved] })}</p>}

      <div className="card">
        <h3>צנצנת ההערכות</h3>
        {(["A", "B"] as PartnerId[]).map((p) => {
          const waiting = jarWaitingFor(state, p).length;
          return waiting ? (
            <button key={p} className="list-item" onClick={() => setView({ name: "open-handoff", who: p })}>
              <span><strong>{waiting === 1 ? `פתק אחד ל${couple[p].name}` : `${waiting} פתקים ל${couple[p].name}`}</strong><small>נפתח כשנוח</small></span>
              <LockIcon />
            </button>
          ) : null;
        })}
        {opened.length === 0 && jarWaitingFor(state, "A").length + jarWaitingFor(state, "B").length === 0 && <p className="muted">הצנצנת עוד ריקה.</p>}
        {opened.slice(0, 6).map((n) => (
          <div key={n.id} className="stack" style={{ gap: 0 }}>
            <span className="small muted">{say("מ{f} ל{t}", couple, { f: couple[n.from], t: couple[n.to] })}</span>
            <p>{n.text}</p>
          </div>
        ))}
      </div>

      {earned.length > 0 && (
        <div className="card">
          <h3>הדרך שלנו</h3>
          <div className="row" style={{ flexWrap: "wrap" }}>{earned.map((a) => <span key={a} className="chip">{a}</span>)}</div>
        </div>
      )}

      <div className="card">
        <h3>ציר הזמן</h3>
        {timeline.length === 0 ? <p className="muted">כאן יופיעו הערבים והשאלות שחשפתם.</p> : (
          <div className="list">
            {timeline.map((item, i) => (
              <div key={`${item.at}-${i}`} className="row-between small">
                <span>{item.title}</span>
                <span className="muted">{new Date(item.at).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-quiet" onClick={() => go({ name: "date" })}>ערב יחד</button>
    </Screen>
  );
}
