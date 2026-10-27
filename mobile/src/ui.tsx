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

/** The website's mark: an amber heart on a deep-teal tile. */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="logo">
      <span className="logo-tile" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
      </span>
      {withName && <span className="logo-name">Couple Lab</span>}
    </span>
  );
}

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  heart: "M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  check: "M5 12.5l4.5 4.5L19 7",
  arrow: "M15 6l-6 6 6 6"
} as const;

export function Icon({ name, size = 22 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3.2 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
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
export function Handoff({ couple, to, note, lead, onReady, night = false, tabs = false }: { couple: Couple; to: PartnerId; note?: string; lead?: string; onReady: () => void; night?: boolean; tabs?: boolean }) {
  const person = couple[to];
  const away = couple[other(to)];
  return (
    <Screen night={night} tabs={tabs} actions={<button className="btn btn-primary" onClick={onReady}>{say("אני {p}", couple, { p: person })}</button>}>
      <div style={{ marginTop: "18vh" }} className="stack">
        <span className="eyebrow">מעבירים את הטלפון</span>
        <h1>{say("עכשיו ל{p}", couple, { p: person })}</h1>
        <p className="lead">{lead ?? say("{w}, {w:תסתכל|תסתכלי} רגע הצידה. מה ש{p} {p:כותב|כותבת} נשאר נעול עד ששניכם עונים.", couple, { w: away, p: person })}</p>
        {note && <p className="muted">{note}</p>}
      </div>
    </Screen>
  );
}
