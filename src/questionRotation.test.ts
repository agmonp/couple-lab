import { describe, expect, it } from "vitest";
import { nextQuestionIndex, rememberQuestion } from "./questionRotation";

describe("question rotation", () => {
  it("uses every unseen question before repeating one", () => {
    let history: number[] = [];
    const shown: number[] = [];

    for (let count = 0; count < 5; count += 1) {
      const next = nextQuestionIndex(5, history, () => 0);
      shown.push(next);
      history = rememberQuestion(history, next, 5);
    }

    expect(new Set(shown).size).toBe(5);
  });

  it("does not immediately repeat after a complete cycle", () => {
    const history = [0, 1, 2];
    expect(nextQuestionIndex(3, history, () => 0.99)).not.toBe(2);
  });

  it("drops invalid and duplicate history entries", () => {
    expect(rememberQuestion([-1, 0, 0, 8], 1, 3)).toEqual([0, 1]);
  });
});
