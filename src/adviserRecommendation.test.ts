import { describe, expect, it } from "vitest";
import { decks, domains } from "./data";
import { deckIdForAssessmentDomain, resolveAdviserRecommendation } from "./adviserRecommendation";

describe("adviser recommendation routing", () => {
  it("opens a practice for a completed first assessment instead of reopening it", () => {
    const recommendation = resolveAdviserRecommendation({
      safetyFlag: false,
      floodingHigh: false,
      hasContemptRisk: false,
      hasRepair: false,
      hasLatestSession: false,
      focusKey: "friendship",
      focusLabel: "היכרות",
      focusPractice: "שאלו שאלה"
    });
    expect(recommendation.destination).toBe("practice");
    expect(recommendation).toMatchObject({ deckId: "love-maps", action: "לשיחה הראשונה" });
  });

  it("routes a safety recommendation to the safety screen", () => {
    expect(resolveAdviserRecommendation({
      safetyFlag: true,
      floodingHigh: false,
      hasContemptRisk: false,
      hasRepair: true,
      hasLatestSession: true
    }).destination).toBe("safety");
  });

  it("maps every assessment domain to an existing practice deck", () => {
    const deckIds = new Set(decks.map((deck) => deck.id));
    domains.forEach((domain) => expect(deckIds.has(deckIdForAssessmentDomain(domain.key))).toBe(true));
  });

  it("maps the main session signals to the intended practice", () => {
    const base = { safetyFlag: false, hasLatestSession: true };
    expect(resolveAdviserRecommendation({ ...base, floodingHigh: true, hasContemptRisk: false, hasRepair: true })).toMatchObject({ deckId: "repair" });
    expect(resolveAdviserRecommendation({ ...base, floodingHigh: false, hasContemptRisk: true, hasRepair: true })).toMatchObject({ deckId: "fondness" });
    expect(resolveAdviserRecommendation({ ...base, floodingHigh: false, hasContemptRisk: false, hasRepair: false })).toMatchObject({ deckId: "repair" });
  });
});
