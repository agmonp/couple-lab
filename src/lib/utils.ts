/** Small domain-free helpers shared by the UI and the relationship engine. */

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

export function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
