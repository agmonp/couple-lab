import { AssessmentDomain, BodySignals, CoupleProfile, Deck, SafetyState } from "./types";

export const defaultProfile: CoupleProfile = {
  partnerAName: "Partner A",
  partnerBName: "Partner B",
  relationshipGoal: "Build respect, affection, calm conflict, intimacy, and shared meaning.",
  createdAt: new Date().toISOString()
};

export const domains: AssessmentDomain[] = [
  {
    key: "friendship",
    label: "Friendship Map",
    description: "Knowing each other's inner world, stressors, joys, hopes, and ordinary details.",
    practice: "Ask one open question and reflect the answer before responding."
  },
  {
    key: "fondness",
    label: "Respect & Fondness",
    description: "Daily admiration, appreciation, and the sense that your partner is fundamentally worthy.",
    practice: "Name one specific thing you admired today."
  },
  {
    key: "turning",
    label: "Turning Toward",
    description: "Noticing bids for connection and responding with interest, warmth, or presence.",
    practice: "Pause when your partner reaches out and turn toward for 20 seconds."
  },
  {
    key: "safety",
    label: "Emotional Safety",
    description: "Feeling safe enough to be honest without ridicule, punishment, or collapse.",
    practice: "Say what felt vulnerable and ask for one kind response."
  },
  {
    key: "conflict",
    label: "Calm Conflict",
    description: "Starting gently, staying specific, and separating the issue from the person.",
    practice: "Use: I feel, about what, and I need."
  },
  {
    key: "repair",
    label: "Repair",
    description: "Catching disconnection early and accepting repair attempts before the conflict hardens.",
    practice: "Try: That came out wrong. Let me start again."
  },
  {
    key: "intimacy",
    label: "Intimacy & Desire",
    description: "Balancing closeness, play, separateness, erotic imagination, and honest wanting.",
    practice: "Ask what feels alive, playful, or missing without demanding an answer."
  },
  {
    key: "meaning",
    label: "Shared Meaning",
    description: "Rituals, values, dreams, family culture, and the story you are building together.",
    practice: "Choose one ritual that says: this is us."
  },
  {
    key: "flooding",
    label: "Flooding Recovery",
    description: "Noticing overwhelm and returning to the conversation after real self-soothing.",
    practice: "Take a timed pause and return with one sentence of care."
  },
  {
    key: "teamwork",
    label: "Life Teamwork",
    description: "Money, parenting, home, labor, logistics, and the felt fairness of the partnership.",
    practice: "Name the invisible work you each carried this week."
  }
];

export const decks: Deck[] = [
  {
    id: "love-maps",
    title: "Love Maps",
    lens: "Gottman-inspired",
    purpose: "Rebuild curiosity about each other's inner world.",
    cards: [
      "What is one pressure in your life that I may not fully understand yet?",
      "What small thing helped you feel cared for this week?",
      "What dream has been quiet in you lately?",
      "What do you wish I knew about your day before I try to solve anything?",
      "What is a current worry that feels easier when I simply know about it?"
    ]
  },
  {
    id: "fondness",
    title: "Fondness & Admiration",
    lens: "Gottman-inspired",
    purpose: "Strengthen respect and warmth with specific memories and present-day appreciation.",
    cards: [
      "Tell me one trait in me that still matters to you.",
      "What is a memory where you felt proud to be with me?",
      "What did I do recently that made your life lighter?",
      "What part of my effort do you want me to know you see?",
      "What is one thing about us that you do not want us to lose?"
    ]
  },
  {
    id: "repair",
    title: "Repair",
    lens: "Gottman-inspired",
    purpose: "Practice interrupting escalation before it becomes a spiral.",
    cards: [
      "What phrase helps you hear a repair attempt instead of defending?",
      "Where did I miss you in the last conflict?",
      "What would a good pause sound like from me?",
      "What is one sentence I can use when I want to restart gently?",
      "What helps you believe I am still on your side during conflict?"
    ]
  },
  {
    id: "gridlock",
    title: "Gridlock To Dreams",
    lens: "Practice",
    purpose: "Find the value, identity, fear, or dream underneath a stuck issue.",
    cards: [
      "What does this issue symbolize for you?",
      "What dream is underneath your position?",
      "What fear shows up if you imagine letting go?",
      "What part of this is flexible, and what part feels sacred?",
      "What would make you feel respected even before we solve it?"
    ]
  },
  {
    id: "desire",
    title: "Desire & Aliveness",
    lens: "Perel-inspired",
    purpose: "Hold both security and surprise, closeness and separateness.",
    cards: [
      "When do you feel most alive as your own person?",
      "What kind of play has disappeared from us that you miss?",
      "What helps you move from logistics into desire?",
      "What is one small mystery or surprise we could bring back?",
      "Where do you want more tenderness, and where do you want more spark?"
    ]
  },
  {
    id: "shared-meaning",
    title: "Shared Meaning",
    lens: "Gottman-inspired",
    purpose: "Make rituals, values, family culture, and future dreams more explicit.",
    cards: [
      "What ritual would make our home feel more like ours?",
      "What value do you want our relationship to protect?",
      "What story do you hope we tell about this chapter later?",
      "What do you want us to be known for by the people closest to us?",
      "What tradition should we begin, revive, or retire?"
    ]
  }
];

export const defaultAssessment = domains.reduce(
  (acc, domain) => {
    acc.A[domain.key] = 6;
    acc.B[domain.key] = 6;
    return acc;
  },
  { A: {}, B: {}, updatedAt: undefined } as { A: Record<string, number>; B: Record<string, number>; updatedAt?: string }
);

export const defaultSignals: BodySignals = {
  A: { stress: 3, relaxed: 7 },
  B: { stress: 3, relaxed: 7 }
};

export const defaultSafety: SafetyState = {
  fearOrCoercion: false,
  violenceOrThreats: false,
  pressuredToParticipate: false,
  seriousDepressionOrAddiction: false
};

export const evidenceNotes = [
  "Use relationship pattern labels as prompts for reflection, not as clinical diagnosis.",
  "Computer vision and voice signals are weaker than partner-confirmed transcript review.",
  "The app should measure change over time: quicker repair, more warmth, less harsh startup, and better recovery.",
  "Any fear, coercion, threats, or abuse moves the couple out of practice mode and toward professional support."
];
