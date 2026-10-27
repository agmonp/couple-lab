import { type ReactNode, useEffect } from "react";
import { setBarsForNight } from "./native/device";
import { resolveForms, type FormRoles } from "@shared/deckForms";
import type { PartnerId } from "@shared/types";
import { type Couple, other } from "./core/model";

/** Fill a template for this couple. Roles a/b are always the two partners. */
export function say(template: string, couple: Couple, roles: FormRoles = {}) {
  return resolveForms(template, { a: couple.A, b: couple.B, ...roles });
}

/** Roles for a line put to `who`. */
export function youThem(couple: Couple, who: PartnerId): FormRoles {
  return { you: couple[who], them: couple[other(who)] };
}

export function Screen({
  children,
  actions,
  night = false,
  onBack,
  title,
  tabs = false
}: {
  children: ReactNode;
  actions?: ReactNode;
  night?: boolean;
  onBack?: () => void;
  title?: string;
  tabs?: boolean;
}) {
  useEffect(() => setBarsForNight(night), [night]);
  return (
    <div className={`${night ? "night" : ""} ${tabs ? "has-tabs" : ""}`} style={{ minHeight: "100%" }}>
      <div className="status-scrim" aria-hidden="true" />
      <section className="screen">
        {(onBack || title) && (
          <div className="topbar">
            {onBack ? <button className="back" onClick={onBack}>→ חזרה</button> : <span />}
            {title && <span className="eyebrow">{title}</span>}
          </div>
        )}
        <div className="screen-body">{children}</div>
        {actions && <div className="screen-actions">{actions}</div>}
      </section>
    </div>
  );
}

export function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** "Only you see this", next to anything private. */
export function PrivateNote({ children }: { children: ReactNode }) {
  return (
    <p className="lock">
      <LockIcon /> {children}
    </p>
  );
}

/**
 * Pass-the-phone: hides what came before and asks the next person to confirm
 * it is them. Guards against a glance, not a determined partner (QA doc).
 */
export function Handoff({ couple, to, note, lead, onReady, night = false }: { couple: Couple; to: PartnerId; note?: string; lead?: string; onReady: () => void; night?: boolean }) {
  const person = couple[to];
  const away = couple[other(to)];
  return (
    <Screen night={night} actions={<button className="btn btn-primary" onClick={onReady}>{say("אני {p}", couple, { p: person })}</button>}>
      <div style={{ marginTop: "18vh" }} className="stack">
        <span className="eyebrow">מעבירים את הטלפון</span>
        <h1>{say("עכשיו ל{p}", couple, { p: person })}</h1>
        <p className="lead">{lead ?? say("{w}, {w:תסתכל|תסתכלי} רגע הצידה. מה ש{p} {p:כותב|כותבת} נשאר נעול עד ששניכם עונים.", couple, { w: away, p: person })}</p>
        {note && <p className="muted">{note}</p>}
      </div>
    </Screen>
  );
}
