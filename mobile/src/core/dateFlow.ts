import { LISTENING_TURN_SECONDS, breakReturnAt } from "@shared/practiceTiming";
import type { PartnerId } from "@shared/types";
import type { HapticName } from "./haptics";
import { type QuestionRef, other } from "./model";

/**
 * The date, as a pure state machine. The screen feeds it what happened
 * (phone placed down, picked up, a clock tick, a button) and plays the haptic
 * effects it returns. No timers live here, so every rule is testable.
 *
 * Per card: the first speaker talks for two minutes, one long buzz, then the
 * other reflects and talks for two minutes. Picking the phone up pauses the
 * clock; putting it down resumes. Nothing is counted against anyone.
 */
export type DatePhase =
  | "waiting-down" // card shown, waiting for the phone to be placed face down
  | "running"
  | "paused" // phone picked up mid-turn
  | "card-done" // both talked; the next card is waiting
  | "break"
  | "ended";

export interface DateState {
  cards: QuestionRef[];
  cardIndex: number;
  firstSpeaker: PartnerId;
  /** 0: first speaker's turn, 1: the other's. */
  turn: 0 | 1;
  turnMs: number;
  remainingMs: number;
  turnEndsAt?: number;
  phase: DatePhase;
  /** Where to go back to when a break ends. */
  beforeBreak?: Exclude<DatePhase, "break" | "running" | "ended">;
  breakReturnAt?: number;
  ready: Partial<Record<PartnerId, true>>;
  startedAt?: number;
  talkMs: number;
  breaks: number;
  cardsTalked: number;
}

export type DateAction =
  | { type: "placed-down"; now: number }
  | { type: "picked-up"; now: number }
  | { type: "tick"; now: number }
  | { type: "next-card" }
  | { type: "start-break"; now: number }
  | { type: "ready"; partner: PartnerId }
  | { type: "end"; now: number };

export interface Effect {
  haptic: HapticName;
}

export interface Step {
  state: DateState;
  effects: Effect[];
}

export function startDate(cards: QuestionRef[], firstSpeaker: PartnerId, turnSeconds = LISTENING_TURN_SECONDS): DateState {
  const turnMs = turnSeconds * 1000;
  return {
    cards,
    cardIndex: 0,
    firstSpeaker,
    turn: 0,
    turnMs,
    remainingMs: turnMs,
    phase: "waiting-down",
    ready: {},
    talkMs: 0,
    breaks: 0,
    cardsTalked: 0
  };
}

export function currentSpeaker(state: DateState): PartnerId {
  // Who opens alternates by card, so neither always goes first.
  const opener = state.cardIndex % 2 === 0 ? state.firstSpeaker : other(state.firstSpeaker);
  return state.turn === 0 ? opener : other(opener);
}

export function remainingMs(state: DateState, now: number) {
  return state.phase === "running" && state.turnEndsAt !== undefined ? Math.max(0, state.turnEndsAt - now) : state.remainingMs;
}

export function isLastCard(state: DateState) {
  return state.cardIndex >= state.cards.length - 1;
}

function run(state: DateState, now: number): DateState {
  return { ...state, phase: "running", turnEndsAt: now + state.remainingMs, startedAt: state.startedAt ?? now };
}

function freeze(state: DateState, now: number): DateState {
  const left = remainingMs(state, now);
  return { ...state, remainingMs: left, turnEndsAt: undefined, talkMs: state.talkMs + (state.remainingMs - left) };
}

export function dateReducer(state: DateState, action: DateAction): Step {
  const none = (next: DateState): Step => ({ state: next, effects: [] });

  switch (action.type) {
    case "placed-down":
      if (state.phase === "waiting-down" || state.phase === "paused") return none(run(state, action.now));
      return none(state);

    case "picked-up":
      if (state.phase === "running") return none({ ...freeze(state, action.now), phase: "paused" });
      return none(state);

    case "tick": {
      if (state.phase !== "running" || state.turnEndsAt === undefined || action.now < state.turnEndsAt) return none(state);
      const talked = freeze(state, state.turnEndsAt);
      if (state.turn === 0) {
        // The listener now reflects and takes the second turn; the phone stays down.
        const next = { ...talked, turn: 1 as const, remainingMs: state.turnMs };
        return { state: run(next, state.turnEndsAt), effects: [{ haptic: "turnEnd" }] };
      }
      const cardsTalked = state.cardsTalked + 1;
      if (isLastCard(state)) {
        return { state: { ...talked, cardsTalked, phase: "ended" }, effects: [{ haptic: "dateEnd" }] };
      }
      return { state: { ...talked, cardsTalked, phase: "card-done" }, effects: [{ haptic: "turnEnd" }] };
    }

    case "next-card": {
      if (state.phase !== "card-done" && state.phase !== "paused" && state.phase !== "waiting-down") return none(state);
      if (isLastCard(state)) return none(state);
      const cardsTalked = state.phase === "card-done" ? state.cardsTalked : state.cardsTalked + (state.turn > 0 || state.remainingMs < state.turnMs ? 1 : 0);
      return none({ ...state, cardIndex: state.cardIndex + 1, turn: 0, remainingMs: state.turnMs, turnEndsAt: undefined, phase: "waiting-down", cardsTalked });
    }

    case "start-break": {
      if (state.phase === "break" || state.phase === "ended") return none(state);
      const frozen = state.phase === "running" ? { ...freeze(state, action.now), phase: "paused" as const } : state;
      const beforeBreak = frozen.phase as DateState["beforeBreak"];
      return {
        state: { ...frozen, phase: "break", beforeBreak, breakReturnAt: breakReturnAt(action.now), ready: {}, breaks: state.breaks + 1 },
        effects: [{ haptic: "breakStart" }]
      };
    }

    case "ready": {
      if (state.phase !== "break") return none(state);
      const ready = { ...state.ready, [action.partner]: true as const };
      if (ready.A && ready.B) {
        return none({ ...state, ready: {}, phase: state.beforeBreak ?? "paused", beforeBreak: undefined, breakReturnAt: undefined });
      }
      return none({ ...state, ready });
    }

    case "end": {
      if (state.phase === "ended") return none(state);
      const frozen = state.phase === "running" ? freeze(state, action.now) : state;
      const talkedThisCard = frozen.turn > 0 || frozen.remainingMs < frozen.turnMs;
      const cardsTalked = frozen.cardsTalked + (frozen.phase !== "card-done" && talkedThisCard ? 1 : 0);
      return { state: { ...frozen, cardsTalked, phase: "ended", turnEndsAt: undefined }, effects: [{ haptic: "dateEnd" }] };
    }
  }
}
