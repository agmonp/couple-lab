import { decks } from "@shared/data";
import type { AddressForm, AddressedPerson } from "@shared/deckForms";
import type { Deck, DepthLevel, PartnerId, StructuredSessionKind } from "@shared/types";
import type { EventLog } from "./events";

/** Stage 1 offers the light layers; 4–7 wait for a couples therapist's review (plan §5). */
export const MAX_LAYER_THIS_STAGE: DepthLevel = 3;
/** How many uses of a layer before the next one is offered. */
export const USES_BEFORE_DEEPER = 3;
/** Days away after which the app opens with a light question. */
export const WELCOME_BACK_DAYS = 7;

export interface Partner extends AddressedPerson {
  id: PartnerId;
}

export interface Couple {
  A: Partner;
  B: Partner;
}

export interface QuestionRef {
  deckId: string;
  index: number;
}

// Event payloads ------------------------------------------------------------

export interface CoupleSet { A: { name: string; form: AddressForm }; B: { name: string; form: AddressForm } }
export interface DailyChosen extends QuestionRef { day: string }
export interface AnswerLocked { day: string; text: string }
export interface AnswerRevealed { day: string; text: string }
export interface Reflection { good?: string; learned?: string }
export interface DateFinished {
  id: string;
  deckIds: string[];
  startedAt: string;
  endedAt: string;
  talkMinutes: number;
  cardsTalked: number;
  breaks: number;
  /** Only what each partner chose to show on the shared card. */
  shared: Partial<Record<PartnerId, Reflection>>;
}
export interface DatePrivateReflection { dateId: string; reflection: Reflection }
export interface JarNote { id: string; to: PartnerId; text: string }
export interface JarOpened { id: string }
export interface LayerConsent { level: DepthLevel }
export interface WeeklyStep { text: string; remindAt: string }
export interface StructuredFinished {
  kind: StructuredSessionKind;
  stepsDone: number;
  stressBefore?: Partial<Record<PartnerId, number>>;
  stressAfter?: Partial<Record<PartnerId, number>>;
  /** True when they chose "זה לא מתאים לנו עכשיו" partway. */
  stoppedEarly: boolean;
}

// Derived state -------------------------------------------------------------

export interface DayState {
  day: string;
  question?: QuestionRef;
  locked: Partial<Record<PartnerId, string>>;
  revealed: Partial<Record<PartnerId, string>>;
}

export interface JarItem extends JarNote {
  from: PartnerId;
  writtenAt: string;
  openedAt?: string;
}

export interface TimelineItem {
  at: string;
  kind: "reveal" | "date" | "jar" | "structured" | "layer";
  title: string;
}

export interface AppState {
  couple?: Couple;
  days: Record<string, DayState>;
  dates: (DateFinished & { at: string })[];
  structured: (StructuredFinished & { at: string })[];
  jar: JarItem[];
  unlockedLayer: DepthLevel;
  consent: Partial<Record<DepthLevel, Partial<Record<PartnerId, true>>>>;
  weeklyStep?: WeeklyStep & { at: string };
  lastActivityAt?: string;
  timeline: TimelineItem[];
}

export function other(partner: PartnerId): PartnerId {
  return partner === "A" ? "B" : "A";
}

export function dayKey(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function deckById(id: string): Deck | undefined {
  return decks.find((deck) => deck.id === id);
}

export function deckLayer(id: string): DepthLevel {
  return deckById(id)?.depthLevel ?? 1;
}

export function derive(log: EventLog): AppState {
  const state: AppState = { days: {}, dates: [], structured: [], jar: [], unlockedLayer: 1, consent: {}, timeline: [] };
  const day = (key: string) => (state.days[key] ??= { day: key, locked: {}, revealed: {} });

  for (const event of log.all()) {
    state.lastActivityAt = event.at;
    switch (event.type) {
      case "couple-set": {
        const p = event.payload as CoupleSet;
        state.couple = { A: { id: "A", ...p.A }, B: { id: "B", ...p.B } };
        break;
      }
      case "daily-chosen": {
        // A later choice ("something lighter") wins until someone has answered.
        const p = event.payload as DailyChosen;
        const d = day(p.day);
        if (!d.question || (d.locked.A === undefined && d.locked.B === undefined)) d.question = { deckId: p.deckId, index: p.index };
        break;
      }
      case "answer-locked": {
        const p = event.payload as AnswerLocked;
        day(p.day).locked[event.author] = p.text;
        break;
      }
      case "answer-revealed": {
        const p = event.payload as AnswerRevealed;
        const d = day(p.day);
        d.revealed[event.author] = p.text;
        if (d.revealed.A !== undefined && d.revealed.B !== undefined) {
          state.timeline.push({ at: event.at, kind: "reveal", title: "חשפנו תשובות לשאלת היום" });
        }
        break;
      }
      case "date-finished": {
        const p = event.payload as DateFinished;
        state.dates.push({ ...p, at: event.at });
        state.timeline.push({ at: event.at, kind: "date", title: `ערב יחד: ${p.deckIds.map((id) => deckById(id)?.title ?? id).join(", ")}` });
        break;
      }
      case "structured-finished": {
        const p = event.payload as StructuredFinished;
        state.structured.push({ ...p, at: event.at });
        state.timeline.push({ at: event.at, kind: "structured", title: p.kind === "aftermath" ? "שיחת 'אחרי ריב'" : "שיחה מפחיתת לחץ" });
        break;
      }
      case "jar-note": {
        const p = event.payload as JarNote;
        state.jar.push({ ...p, from: event.author, writtenAt: event.at });
        break;
      }
      case "jar-opened": {
        const p = event.payload as JarOpened;
        const item = state.jar.find((note) => note.id === p.id);
        if (item && !item.openedAt) {
          item.openedAt = event.at;
          state.timeline.push({ at: event.at, kind: "jar", title: "נפתח פתק מהצנצנת" });
        }
        break;
      }
      case "layer-consent": {
        const p = event.payload as LayerConsent;
        const entry = (state.consent[p.level] ??= {});
        entry[event.author] = true;
        if (entry.A && entry.B && p.level > state.unlockedLayer) {
          state.unlockedLayer = p.level;
          state.timeline.push({ at: event.at, kind: "layer", title: "בחרנו להעמיק" });
        }
        break;
      }
      case "weekly-step": {
        state.weeklyStep = { ...(event.payload as WeeklyStep), at: event.at };
        break;
      }
      default:
        break;
    }
  }
  return state;
}

/** How many times the couple used a layer: revealed daily questions plus evenings. */
export function usesOfLayer(state: AppState, level: DepthLevel) {
  let uses = 0;
  for (const d of Object.values(state.days)) {
    if (d.question && deckLayer(d.question.deckId) === level && d.revealed.A !== undefined && d.revealed.B !== undefined) uses++;
  }
  for (const date of state.dates) if (date.deckIds.some((id) => deckLayer(id) === level)) uses++;
  return uses;
}

/** The next layer to offer, if they used the current one enough and it is in this stage. */
export function deeperLayerOffer(state: AppState): DepthLevel | null {
  const next = (state.unlockedLayer + 1) as DepthLevel;
  if (next > MAX_LAYER_THIS_STAGE) return null;
  return usesOfLayer(state, state.unlockedLayer) >= USES_BEFORE_DEEPER ? next : null;
}

export function isWelcomeBack(state: AppState, now = new Date()) {
  if (!state.lastActivityAt) return false;
  return now.getTime() - new Date(state.lastActivityAt).getTime() > WELCOME_BACK_DAYS * 24 * 3600 * 1000;
}

export function jarWaitingFor(state: AppState, partner: PartnerId) {
  return state.jar.filter((note) => note.to === partner && !note.openedAt);
}

/** Shared, descriptive milestones. No scores, no streaks, nothing to lose. */
export function achievements(state: AppState): string[] {
  const list: string[] = [];
  const evenings = state.dates.length + state.structured.filter((s) => !s.stoppedEarly).length;
  if (evenings >= 1) list.push("הערב הראשון שלנו יחד");
  for (const n of [5, 10, 25, 50]) if (evenings >= n) list.push(`${n} ערבים יחד`);
  const discovered = Object.values(state.days).filter((d) => d.revealed.A !== undefined && d.revealed.B !== undefined).length * 2;
  for (const n of [10, 30, 100]) if (discovered >= n) list.push(`גילינו ${n} דברים חדשים זה על זה`);
  const opened = state.jar.filter((note) => note.openedAt).length;
  for (const n of [1, 10, 30]) if (opened >= n) list.push(n === 1 ? "הפתק הראשון בצנצנת נפתח" : `${n} פתקי הערכה נפתחו`);
  if (state.unlockedLayer >= 2) list.push("בחרנו יחד להעמיק");
  return list;
}
