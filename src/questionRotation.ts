export type QuestionHistory = Record<string, number[]>;

export function nextQuestionIndex(cardCount: number, history: number[], random = Math.random) {
  if (cardCount <= 1) return 0;

  const validHistory = Array.from(new Set(history.filter((index) => index >= 0 && index < cardCount)));
  const unseen = Array.from({ length: cardCount }, (_, index) => index).filter((index) => !validHistory.includes(index));
  const lastShown = validHistory[validHistory.length - 1];
  const pool = unseen.length
    ? unseen
    : Array.from({ length: cardCount }, (_, index) => index).filter((index) => index !== lastShown);

  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

export function rememberQuestion(history: number[], index: number, cardCount: number) {
  const validHistory = Array.from(new Set(history.filter((item) => item >= 0 && item < cardCount && item !== index)));
  return [...validHistory, index].slice(-cardCount);
}
