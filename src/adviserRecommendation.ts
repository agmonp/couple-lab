export interface AdviserRecommendationInput {
  safetyFlag: boolean;
  floodingHigh: boolean;
  hasContemptRisk: boolean;
  hasRepair: boolean;
  hasLatestSession: boolean;
  focusKey?: string;
  focusLabel?: string;
  focusPractice?: string;
}

export type AdviserRecommendation =
  | {
      destination: "safety";
      title: string;
      body: string;
      action: string;
    }
  | {
      destination: "practice";
      deckId: string;
      cardIndex?: number;
      title: string;
      body: string;
      action: string;
    };

export function deckIdForAssessmentDomain(domainKey?: string) {
  const mapping: Record<string, string> = {
    friendship: "love-maps",
    turning: "love-maps",
    safety: "love-maps",
    fondness: "fondness",
    conflict: "gridlock",
    teamwork: "gridlock",
    repair: "repair",
    flooding: "repair",
    intimacy: "desire",
    meaning: "shared-meaning"
  };
  return (domainKey && mapping[domainKey]) || "love-maps";
}

export function resolveAdviserRecommendation(input: AdviserRecommendationInput): AdviserRecommendation {
  if (input.safetyFlag) {
    return {
      destination: "safety",
      title: "עוצרים כרגע תרגול מחלוקת זוגי",
      body: "סומנה דאגת בטיחות. כרגע נכון לפנות לתמיכה אישית ולא לבצע באפליקציה תרגילי מחלוקת.",
      action: "לבדיקת הבטיחות"
    };
  }
  if (input.floodingHigh) {
    return {
      destination: "practice",
      deckId: "repair",
      cardIndex: 2,
      title: "מתרגלים עצירה וחזרה אחרי הצפה",
      body: "בשיחה האחרונה הופיעו רמזי עומס רבים. לפני נושא קשה נוסף, תרגלו הפסקה וחזרה בזמן מוסכם.",
      action: "לתרגול ההפסקה"
    };
  }
  if (input.hasContemptRisk) {
    return {
      destination: "practice",
      deckId: "fondness",
      title: "מחזירים קודם את הכבוד",
      body: "הופיע ניסוח שעלול להישמע מזלזל. לפני פתרון הבעיה, התחילו בהערכה ובדבר אחד שאתם מכבדים זה בזו.",
      action: "לתרגול הערכה"
    };
  }
  if (!input.hasRepair && input.hasLatestSession) {
    return {
      destination: "practice",
      deckId: "repair",
      cardIndex: 3,
      title: "מוסיפים ניסיון תיקון אחד",
      body: "בשיחה האחרונה לא זוהה ניסיון תיקון. בחרו משפט קצר ששניכם תזהו כהזמנה להאט ולתקן.",
      action: "לתרגול תיקון"
    };
  }
  return {
    destination: "practice",
    deckId: deckIdForAssessmentDomain(input.focusKey),
    title: `מחזקים היום את תחום ${input.focusLabel || "החיבור"}`,
    body: input.focusPractice || "בצעו שיחת בדיקה קצרה ושמרו אותה כדי לקבל הכוונה.",
    action: input.hasLatestSession ? "להתחלת התרגול" : "לשיחה הראשונה"
  };
}
