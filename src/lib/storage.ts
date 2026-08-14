import { useEffect, useState } from "react";

/** Every key Couple Lab owns in localStorage. Clearing these clears the app. */
export const storageKeys = {
  profile: "couple-lab-profile",
  assessment: "couple-lab-assessment",
  sessions: "couple-lab-sessions",
  signals: "couple-lab-signals",
  safety: "couple-lab-safety",
  deckStats: "couple-lab-deck-stats"
};

/** useState that reads its initial value from localStorage and writes back on change. */
export function useLocalState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

export function downloadBlob(filename: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
