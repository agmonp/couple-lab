import { SafetyState } from "../types";

/**
 * The single definition of what counts as a safety concern. Any one of these
 * takes the app out of practice mode, so the checklist UI and every guard read
 * from the same list.
 */
export const safetyItems: { key: keyof SafetyState; label: string }[] = [
  { key: "fearOrCoercion", label: "One partner feels afraid or coerced." },
  { key: "violenceOrThreats", label: "There has been violence, threats, stalking, or intimidation." },
  { key: "pressuredToParticipate", label: "One partner feels pressured to record or share." },
  { key: "seriousDepressionOrAddiction", label: "Serious depression, addiction, or crisis is active." }
];

export function hasSafetyConcern(safety: SafetyState) {
  return safetyItems.some((item) => Boolean(safety[item.key]));
}
