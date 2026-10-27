import { decks } from "@shared/data";
import { addressedCard } from "@shared/deckForms";
import { nextQuestionIndex, rememberQuestion } from "@shared/questionRotation";
import type { DepthLevel, PartnerId } from "@shared/types";
import { type AppState, type Couple, type QuestionRef, MAX_LAYER_THIS_STAGE, deckById, other } from "./model";

/** Decks open to this couple right now, light first. Structured sessions are offered apart. */
export function openDecks(unlockedLayer: DepthLevel, maxLayer: DepthLevel = MAX_LAYER_THIS_STAGE) {
  const limit = Math.min(unlockedLayer, maxLayer);
  return decks
    .filter((deck) => (deck.depthLevel ?? 99) <= limit)
    .sort((a, b) => (a.depthLevel ?? 0) - (b.depthLevel ?? 0));
}

/** Every card in the open decks, as one rotation pool. */
export function questionPool(unlockedLayer: DepthLevel, onlyLayer?: DepthLevel): QuestionRef[] {
  return openDecks(unlockedLayer)
    .filter((deck) => onlyLayer === undefined || deck.depthLevel === onlyLayer)
    .flatMap((deck) => deck.cards.map((_, index) => ({ deckId: deck.id, index })));
}

/** Cards already used as daily questions, oldest first. */
export function usedQuestions(state: AppState): QuestionRef[] {
  return Object.values(state.days)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .flatMap((d) => (d.question ? [d.question] : []));
}

/**
 * Today's question: no repeats until the pool is used up (shared rotation).
 * `light` picks from layer 1 only, for "התגעגענו" and "משהו קל יותר".
 */
export function pickDailyQuestion(state: AppState, { light = false, random = Math.random } = {}): QuestionRef {
  const pool = questionPool(state.unlockedLayer, light ? 1 : undefined);
  const key = (q: QuestionRef) => `${q.deckId}#${q.index}`;
  const positions = new Map(pool.map((q, i) => [key(q), i]));
  let history: number[] = [];
  for (const q of usedQuestions(state)) {
    const at = positions.get(key(q));
    if (at !== undefined) history = rememberQuestion(history, at, pool.length);
  }
  return pool[nextQuestionIndex(pool.length, history, random)];
}

/** The card's text for `who`, naming the partner and in each one's chosen form. */
export function questionText(ref: QuestionRef, couple: Couple, who: PartnerId) {
  const deck = deckById(ref.deckId);
  const card = deck?.cards[ref.index] ?? "";
  return addressedCard(ref.deckId, ref.index, card, couple[who], couple[other(who)]);
}
