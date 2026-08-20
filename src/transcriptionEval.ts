function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("he")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance<T>(expected: T[], actual: T[]) {
  const previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let row = 1; row <= expected.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= actual.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (expected[row - 1] === actual[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[actual.length];
}

export function transcriptionAccuracy(expected: string, actual: string) {
  const normalizedExpected = normalizeText(expected);
  const normalizedActual = normalizeText(actual);
  const expectedWords = normalizedExpected ? normalizedExpected.split(" ") : [];
  const actualWords = normalizedActual ? normalizedActual.split(" ") : [];
  const expectedCharacters = Array.from(normalizedExpected.replace(/\s/g, ""));
  const actualCharacters = Array.from(normalizedActual.replace(/\s/g, ""));
  const wordErrors = editDistance(expectedWords, actualWords);
  const characterErrors = editDistance(expectedCharacters, actualCharacters);

  return {
    expectedWords: expectedWords.length,
    actualWords: actualWords.length,
    wordErrors,
    characterErrors,
    wer: expectedWords.length ? wordErrors / expectedWords.length : actualWords.length ? 1 : 0,
    cer: expectedCharacters.length ? characterErrors / expectedCharacters.length : actualCharacters.length ? 1 : 0
  };
}

