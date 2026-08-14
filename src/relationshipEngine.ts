import {
  BodySignals,
  EmotionalStateScores,
  InteractionTag,
  InteractionTagFamily,
  LiveCue,
  PatternHit,
  SessionAnalysis,
  SessionMetrics,
  SessionType,
  TranscriptSegment,
  VisualObservation
} from "./types";
import { otherPartner } from "./lib/partners";
import { clamp, countWords } from "./lib/utils";

type TranscriptPattern = {
  label: string;
  regex: RegExp;
  hitFamily: PatternHit["family"];
  tagFamily: InteractionTagFamily;
  suggestion: string;
  confidence: number;
  metadata?: Record<string, string | number | boolean>;
};

const transcriptPatterns: TranscriptPattern[] = [
  {
    label: "Criticism-like startup",
    regex:
      /\b(you always|you never|what is wrong with you|you are so|you don't care|you only care)\b|(?:אתה|את)\s+(?:תמיד|אף פעם|לא\s+אכפת)|מה הבעיה שלך|לא אכפת לך/i,
    hitFamily: "risk",
    tagFamily: "four-horsemen",
    suggestion: "Use the antidote: gentle startup. Say what you feel, name one specific event, and ask for one doable need.",
    confidence: 0.76,
    metadata: { horseman: "criticism", antidote: "gentle startup" }
  },
  {
    label: "Contempt risk",
    regex:
      /\b(whatever|ridiculous|pathetic|grow up|that's stupid|you sound crazy|typical|idiot)\b|מגוחך|פתטי|תתבגר|תתבגרי|מטומטם|מטומטמת|הזוי|הזויה/i,
    hitFamily: "risk",
    tagFamily: "four-horsemen",
    suggestion: "Use the antidote: fondness and admiration. Pause superiority, name the hurt underneath, and add one respect statement.",
    confidence: 0.78,
    metadata: { horseman: "contempt", antidote: "fondness and admiration" }
  },
  {
    label: "Defensiveness risk",
    regex:
      /\b(not my fault|you did it too|why are you attacking|i only did that because|that is not true|you started)\b|לא אשמתי|גם את|גם אתה|למה את תוקפת|למה אתה תוקף|זה לא נכון/i,
    hitFamily: "risk",
    tagFamily: "four-horsemen",
    suggestion: "Use the antidote: take responsibility for one small piece before explaining your view.",
    confidence: 0.74,
    metadata: { horseman: "defensiveness", antidote: "take responsibility" }
  },
  {
    label: "Stonewalling / shutdown risk",
    regex:
      /\b(i am done|i'm done|leave me alone|i don't want to talk|nothing to say|stop talking|whatever)\b|עזבי אותי|עזוב אותי|אין לי מה להגיד|לא רוצה לדבר|סיימתי|תפסיקי לדבר|תפסיק לדבר/i,
    hitFamily: "risk",
    tagFamily: "four-horsemen",
    suggestion: "Use the antidote: physiological self-soothing. Take a timed break and return at an agreed time.",
    confidence: 0.72,
    metadata: { horseman: "stonewalling", antidote: "self soothing break" }
  },
  {
    label: "Global blame",
    regex: /\b(every time|all you do|nothing i do|you make me|you ruined)\b|כל פעם|תמיד את|תמיד אתה|כל מה שאת|כל מה שאתה|את גורמת לי|אתה גורם לי/i,
    hitFamily: "risk",
    tagFamily: "conversation-structure",
    suggestion: "Shrink the topic to one observable moment that can be repaired.",
    confidence: 0.72
  },
  {
    label: "Soft startup",
    regex:
      /\b(i feel|i felt|i need|i would like|would you be willing|can we|could we)\b|אני מרגיש|אני מרגישה|אני צריך|אני צריכה|היית מוכן|היית מוכנה|אפשר ש|אפשר לדבר/i,
    hitFamily: "strength",
    tagFamily: "conversation-structure",
    suggestion: "Good direction. Keep it specific and ask for one doable change.",
    confidence: 0.8,
    metadata: { skill: "gentle startup" }
  },
  {
    label: "Validation",
    regex:
      /\b(i hear you|that makes sense|i get why|i understand|tell me more|i can see|that sounds hard)\b|אני שומע|אני שומעת|זה הגיוני|אני מבין|אני מבינה|אני רואה|ספרי לי עוד|ספר לי עוד/i,
    hitFamily: "strength",
    tagFamily: "strength",
    suggestion: "Stay here longer before moving into solutions.",
    confidence: 0.8,
    metadata: { skill: "attunement" }
  },
  {
    label: "Emotional bank deposit",
    regex:
      /\b(i appreciate|thank you|i love|i admire|i'm grateful|you matter|i noticed that you)\b|תודה|אני מעריך|אני מעריכה|אני אוהב|אני אוהבת|אני גאה|שמתי לב ש/i,
    hitFamily: "strength",
    tagFamily: "strength",
    suggestion: "Make the appreciation specific and current so it becomes a usable reserve during stress.",
    confidence: 0.82,
    metadata: { skill: "emotional bank account" }
  },
  {
    label: "Turning toward / bid response",
    regex:
      /\b(tell me|show me|i'm listening|i am listening|what happened|do you have a minute|can i show you)\b|תקשיב|תקשיבי|תראה|תראי|אני מקשיב|אני מקשיבה|מה קרה|אפשר רגע/i,
    hitFamily: "strength",
    tagFamily: "strength",
    suggestion: "Mark this as a bid or a turn-toward moment. Small responses compound.",
    confidence: 0.72,
    metadata: { skill: "turning toward" }
  },
  {
    label: "Curiosity",
    regex:
      /\b(help me understand|what was that like|can you say more|what do you need|what do you mean|i'm curious)\b|תעזור לי להבין|תעזרי לי להבין|מה את צריכה|מה אתה צריך|מה זה אומר לך|אני סקרן|אני סקרנית/i,
    hitFamily: "strength",
    tagFamily: "strength",
    suggestion: "Ask one more question before responding.",
    confidence: 0.78,
    metadata: { skill: "curiosity before certainty" }
  },
  {
    label: "Repair attempt",
    regex:
      /\b(i'm sorry|i am sorry|that came out wrong|let me try again|can we pause|i don't want to fight|i love you|we are on the same team)\b|סליחה|יצא לי לא טוב|תני לי לנסות שוב|תן לי לנסות שוב|אפשר לעצור|לא רוצה לריב|אנחנו באותו צד/i,
    hitFamily: "repair",
    tagFamily: "repair",
    suggestion: "Slow down and let the repair land before continuing.",
    confidence: 0.84,
    metadata: { skill: "repair attempt" }
  },
  {
    label: "Ownership",
    regex:
      /\b(my part is|i can own|i take responsibility|i should have|i missed|i see my part)\b|החלק שלי|אני לוקח אחריות|אני לוקחת אחריות|הייתי צריך|הייתי צריכה|פספסתי/i,
    hitFamily: "repair",
    tagFamily: "repair",
    suggestion: "Name the impact on your partner and one next action.",
    confidence: 0.82,
    metadata: { skill: "personal responsibility" }
  },
  {
    label: "Desire / aliveness cue",
    regex:
      /\b(i miss us|i want you|i desire|i feel alive|playful|adventure|space to miss|mystery)\b|אני מתגעגע|אני מתגעגעת|אני רוצה אותך|חשק|תשוקה|משחקיות|הרפתקה|מרחב|חופש/i,
    hitFamily: "strength",
    tagFamily: "desire",
    suggestion: "Protect both closeness and separateness. Ask what would make the relationship feel more alive this week.",
    confidence: 0.68,
    metadata: { lens: "desire and separateness" }
  }
];

const visualStressLabels = new Set<VisualObservation["label"]>([
  "brow-tension",
  "mouth-tension",
  "closed-posture",
  "leaning-away",
  "looking-away",
  "head-turned-away",
  "sustained-tension",
  "possible-withdrawal"
]);

/** Cue tones the couple marked as going well, versus tones that signal overload. */
const positiveCueTones = new Set<LiveCue["tone"]>(["warmth", "repair", "humor", "softening"]);
const overwhelmCueTones = new Set<LiveCue["tone"]>(["overwhelm", "pause"]);

const visualPositiveLabels = new Set<VisualObservation["label"]>([
  "face-visible",
  "warm-expression",
  "partner-gaze",
  "mutual-attention",
  "shared-frame",
  "body-visible"
]);

const visualWithdrawalLabels = new Set<VisualObservation["label"]>([
  "looking-away",
  "leaning-away",
  "closed-posture",
  "head-turned-away",
  "possible-withdrawal"
]);

const visualEngagementLabels = new Set<VisualObservation["label"]>([
  "warm-expression",
  "sustained-warmth",
  "partner-gaze",
  "mutual-attention",
  "shared-frame",
  "possible-engagement"
]);

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function segmentEnd(segment: TranscriptSegment) {
  return segment.endSeconds ?? segment.seconds;
}

function findLinkedSegment(segments: TranscriptSegment[], seconds: number) {
  let bestSegment: TranscriptSegment | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    const start = segment.seconds;
    const end = segmentEnd(segment);
    const distance = seconds >= start && seconds <= end ? 0 : Math.min(Math.abs(seconds - start), Math.abs(seconds - end));
    if (distance <= 3 && distance < bestDistance) {
      bestSegment = segment;
      bestDistance = distance;
    }
  }

  return bestSegment;
}

function makeHit(pattern: TranscriptPattern, segment: TranscriptSegment): PatternHit {
  return {
    id: `${pattern.hitFamily}-${segment.id}-${slug(pattern.label)}`,
    label: pattern.label,
    family: pattern.hitFamily,
    speaker: segment.speaker,
    target: segment.target ?? otherPartner(segment.speaker),
    seconds: segment.seconds,
    endSeconds: segmentEnd(segment),
    source: "transcript",
    segmentId: segment.id,
    evidence: segment.text,
    suggestion: pattern.suggestion,
    confidence: pattern.confidence
  };
}

function makeTag(pattern: TranscriptPattern, segment: TranscriptSegment): InteractionTag {
  return {
    id: `tag-${segment.id}-${slug(pattern.label)}`,
    label: pattern.label,
    family: pattern.tagFamily,
    source: "transcript",
    seconds: segment.seconds,
    endSeconds: segmentEnd(segment),
    speaker: segment.speaker,
    target: segment.target ?? otherPartner(segment.speaker),
    segmentId: segment.id,
    evidence: segment.text,
    suggestion: pattern.suggestion,
    confidence: pattern.confidence,
    metadata: {
      ...(pattern.metadata ?? {}),
      wordCount: segment.wordCount ?? countWords(segment.text),
      detectedLanguage: segment.detectedLanguage ?? "unknown"
    }
  };
}

function scanSegments(segments: TranscriptSegment[]) {
  const hits: PatternHit[] = [];
  const tags: InteractionTag[] = [];

  segments.forEach((segment) => {
    transcriptPatterns.forEach((pattern) => {
      if (pattern.regex.test(segment.text)) {
        hits.push(makeHit(pattern, segment));
        tags.push(makeTag(pattern, segment));
      }
    });
  });

  return { hits, tags };
}

function cueHits(cues: LiveCue[]): PatternHit[] {
  return cues.map((cue) => {
    const positive = positiveCueTones.has(cue.tone);
    return {
      id: `cue-${cue.id}`,
      label: `Observed ${cue.tone}`,
      family: positive ? "strength" : "body",
      speaker: cue.speaker,
      target: otherPartner(cue.speaker),
      seconds: cue.seconds,
      source: "manual-cue",
      cueId: cue.id,
      evidence: `Marked at ${Math.round(cue.seconds)}s`,
      suggestion: positive
        ? "Name what worked so it can become repeatable."
        : "Check whether this was stress, disengagement, or simply a normal pause.",
      confidence: 0.62
    };
  });
}

function cueTags(cues: LiveCue[]): InteractionTag[] {
  return cues.map((cue) => {
    const positive = positiveCueTones.has(cue.tone);
    return {
      id: `tag-cue-${cue.id}`,
      label: `Manual cue: ${cue.tone}`,
      family: overwhelmCueTones.has(cue.tone) ? "flooding" : positive ? "strength" : "nonverbal",
      source: "manual-cue",
      seconds: cue.seconds,
      speaker: cue.speaker,
      target: otherPartner(cue.speaker),
      cueId: cue.id,
      evidence: `User marked ${cue.tone} at ${Math.round(cue.seconds)}s`,
      suggestion: positive ? "Use this cue to reinforce a repeatable strength." : "Use this cue as a prompt for a gentle check-in.",
      confidence: 0.62,
      metadata: { cueTone: cue.tone }
    };
  });
}

const visualLabels: Record<VisualObservation["label"], string> = {
  "face-visible": "Face visible",
  "warm-expression": "Possible warmth",
  "brow-tension": "Possible facial tension",
  "mouth-tension": "Possible mouth tension",
  "looking-away": "Possible looking away",
  "partner-gaze": "Possible partner gaze",
  "mutual-attention": "Possible mutual attention",
  "shared-frame": "Shared frame",
  "body-visible": "Body posture visible",
  "closed-posture": "Possible closed posture",
  "leaning-away": "Possible leaning away",
  "head-turned-away": "Possible head turned away",
  "sustained-warmth": "Sustained warmth pattern",
  "sustained-tension": "Sustained tension pattern",
  "possible-engagement": "Possible engagement",
  "possible-withdrawal": "Possible withdrawal"
};

function visualHits(observations: VisualObservation[], segments: TranscriptSegment[]): PatternHit[] {
  return observations.slice(-40).map((observation) => {
    const linkedSegment = findLinkedSegment(segments, observation.seconds);
    const positive = visualPositiveLabels.has(observation.label);

    return {
      id: `visual-${observation.id}`,
      label: visualLabels[observation.label],
      family: positive ? "strength" : "body",
      speaker: observation.subject ?? linkedSegment?.speaker,
      target: observation.subject ? otherPartner(observation.subject) : linkedSegment?.target,
      seconds: observation.seconds,
      source: "visual",
      segmentId: linkedSegment?.id,
      observationId: observation.id,
      evidence: `${observation.evidence} at ${Math.round(observation.seconds)}s`,
      suggestion: positive
        ? "Use this as a supportive cue and confirm it with what each partner felt."
        : "Treat this as a question to check gently, not as proof of emotion.",
      confidence: clamp(observation.score, 0.35, 0.86)
    };
  });
}

function visualTags(observations: VisualObservation[], segments: TranscriptSegment[]): InteractionTag[] {
  return observations.map((observation) => {
    const linkedSegment = findLinkedSegment(segments, observation.seconds);
    const stressCue = visualStressLabels.has(observation.label);

    return {
      id: `tag-visual-${observation.id}`,
      label: visualLabels[observation.label],
      family: stressCue ? "flooding" : "nonverbal",
      source: "visual",
      seconds: observation.seconds,
      speaker: observation.subject ?? linkedSegment?.speaker,
      target: observation.subject ? otherPartner(observation.subject) : linkedSegment?.target,
      segmentId: linkedSegment?.id,
      observationId: observation.id,
      evidence: observation.evidence,
      suggestion: stressCue
        ? "Check whether this reflected stress, fatigue, concentration, or disengagement before drawing conclusions."
        : "Use as context around the spoken moment, not as proof of emotion.",
      confidence: clamp(observation.score, 0.35, 0.86),
      metadata: {
        visualLabel: observation.label,
        linkedTranscript: Boolean(linkedSegment)
      }
    };
  });
}

function detectRepairAcceptance(segments: TranscriptSegment[], tags: InteractionTag[]) {
  const repairSegmentIds = new Set(tags.filter((tag) => tag.family === "repair" && tag.segmentId).map((tag) => tag.segmentId));
  const hits: PatternHit[] = [];
  const acceptedTags: InteractionTag[] = [];

  segments.forEach((segment, index) => {
    if (!repairSegmentIds.has(segment.id)) {
      return;
    }

    const nextSegments = segments.slice(index + 1, index + 3);
    const nextText = nextSegments.map((item) => item.text).join(" ");
    if (/\b(okay|thank you|i hear|i appreciate|let's|yes|that helps)\b|בסדר|תודה|שמעתי|כן|זה עוזר|בוא|בואי/i.test(nextText)) {
      const acceptingSegment = nextSegments[0];
      const seconds = acceptingSegment?.seconds ?? segmentEnd(segment);
      const speaker = acceptingSegment?.speaker;

      hits.push({
        id: `repair-accepted-${segment.id}`,
        label: "Repair accepted",
        family: "strength",
        speaker,
        target: otherPartner(speaker),
        seconds,
        source: "derived",
        segmentId: acceptingSegment?.id,
        evidence: nextText,
        suggestion: "This is a key resilience pattern. Keep repairs small and accept them early.",
        confidence: 0.7
      });

      acceptedTags.push({
        id: `tag-repair-accepted-${segment.id}`,
        label: "Repair accepted",
        family: "repair",
        source: "derived",
        seconds,
        speaker,
        target: otherPartner(speaker),
        segmentId: acceptingSegment?.id,
        evidence: nextText,
        suggestion: "This is a high-value moment. Reinforce that the repair was received.",
        confidence: 0.7,
        metadata: { repairedSegmentId: segment.id }
      });
    }
  });

  return { hits, tags: acceptedTags };
}

function deriveConversationTags(
  segments: TranscriptSegment[],
  tags: InteractionTag[],
  observations: VisualObservation[]
): InteractionTag[] {
  const derived: InteractionTag[] = [];

  segments.forEach((segment, index) => {
    const previous = segments[index - 1];
    if (previous && previous.speaker !== segment.speaker && segment.seconds <= segmentEnd(previous) + 1.5) {
      derived.push({
        id: `tag-interruption-${previous.id}-${segment.id}`,
        label: "Possible interruption / overlap",
        family: "turn-taking",
        source: "derived",
        seconds: segment.seconds,
        endSeconds: segmentEnd(segment),
        speaker: segment.speaker,
        target: previous.speaker,
        segmentId: segment.id,
        evidence: `${segment.speaker} began within 1.5s of ${previous.speaker}'s segment ending.`,
        suggestion: "Check whether this felt like energy, support, or interruption. If it felt bad, use a speaker handoff.",
        confidence: 0.54
      });
    }

    const words = segment.wordCount ?? countWords(segment.text);
    if (words >= 80) {
      derived.push({
        id: `tag-long-turn-${segment.id}`,
        label: "Long speaking turn",
        family: "turn-taking",
        source: "derived",
        seconds: segment.seconds,
        endSeconds: segmentEnd(segment),
        speaker: segment.speaker,
        target: segment.target ?? otherPartner(segment.speaker),
        segmentId: segment.id,
        evidence: `${words} words in one turn.`,
        suggestion: "Try a short summary and invite the other partner to reflect what they heard.",
        confidence: 0.68
      });
    }
  });

  const horsemenTags = tags.filter((tag) => tag.family === "four-horsemen").sort((a, b) => a.seconds - b.seconds);
  horsemenTags.forEach((tag, index) => {
    const nearby = horsemenTags.slice(index, index + 3).filter((item) => item.seconds - tag.seconds <= 45);
    if (nearby.length >= 2) {
      derived.push({
        id: `tag-escalation-cluster-${tag.id}`,
        label: "Escalation cluster",
        family: "conversation-structure",
        source: "derived",
        seconds: tag.seconds,
        endSeconds: nearby[nearby.length - 1].endSeconds ?? nearby[nearby.length - 1].seconds,
        speaker: tag.speaker,
        target: tag.target,
        evidence: `${nearby.length} four-horsemen signals appeared within 45 seconds.`,
        suggestion: "Stop problem solving. Use a repair attempt or a timed flooding reset before continuing.",
        confidence: 0.72,
        metadata: { count: nearby.length }
      });
    }
  });

  const repairTags = tags.filter((tag) => tag.family === "repair").sort((a, b) => a.seconds - b.seconds);
  horsemenTags.forEach((riskTag) => {
    const repair = repairTags.find((tag) => tag.seconds > riskTag.seconds && tag.seconds - riskTag.seconds <= 60);
    if (repair) {
      derived.push({
        id: `tag-risk-repaired-${riskTag.id}-${repair.id}`,
        label: "Risk followed by repair",
        family: "repair",
        source: "derived",
        seconds: riskTag.seconds,
        endSeconds: repair.endSeconds ?? repair.seconds,
        speaker: repair.speaker,
        target: repair.target,
        segmentId: repair.segmentId,
        evidence: `${riskTag.label} was followed by ${repair.label}.`,
        suggestion: "This is resilience. Slow down and let the repair change the emotional direction.",
        confidence: 0.7
      });
    }
  });

  const stressObservations = observations.filter((observation) => visualStressLabels.has(observation.label)).sort((a, b) => a.seconds - b.seconds);
  stressObservations.forEach((observation, index) => {
    const cluster = stressObservations.slice(index, index + 5).filter((item) => item.seconds - observation.seconds <= 30);
    if (cluster.length >= 3) {
      derived.push({
        id: `tag-visual-flooding-cluster-${observation.id}`,
        label: "Possible flooding cluster",
        family: "flooding",
        source: "derived",
        seconds: observation.seconds,
        endSeconds: cluster[cluster.length - 1].seconds,
        speaker: observation.subject,
        target: otherPartner(observation.subject),
        observationId: observation.id,
        evidence: `${cluster.length} stress-related visual cues appeared within 30 seconds.`,
        suggestion: "Ask both partners for a body check. If either is flooded, pause and return at a set time.",
        confidence: 0.64,
        metadata: { count: cluster.length }
      });
    }
  });

  return derived;
}

function floodingRisk(signals: BodySignals, cues: LiveCue[], observations: VisualObservation[]) {
  const stressAverage = (signals.A.stress + signals.B.stress) / 2;
  const relaxationAverage = (signals.A.relaxed + signals.B.relaxed) / 2;
  const heartRateRisk =
    (signals.A.heartRate && signals.A.heartRate > 100 ? 1 : 0) +
    (signals.B.heartRate && signals.B.heartRate > 100 ? 1 : 0);
  const overwhelmCues = cues.filter((cue) => overwhelmCueTones.has(cue.tone)).length;
  const visualStress = countVisual(observations, visualStressLabels);

  return clamp(
    Math.round(stressAverage * 8 + heartRateRisk * 12 + overwhelmCues * 6 + visualStress * 2 - relaxationAverage * 3),
    0,
    100
  );
}

function countVisual(observations: VisualObservation[], labels: Set<VisualObservation["label"]>) {
  return observations.filter((observation) => labels.has(observation.label)).length;
}

function scoreEmotionalState(
  hits: PatternHit[],
  cues: LiveCue[],
  observations: VisualObservation[],
  tags: InteractionTag[],
  flooding: number
): EmotionalStateScores {
  const repairSignals = hits.filter((hit) => hit.family === "repair").length;
  const riskSignals = hits.filter((hit) => hit.family === "risk").length;
  const validationSignals = tags.filter((tag) => tag.label === "Validation").length;
  const bankDeposits = tags.filter((tag) => tag.label === "Emotional bank deposit").length;
  const curiositySignals = tags.filter((tag) => tag.label === "Curiosity").length;
  const turningToward = tags.filter((tag) => tag.label === "Turning toward / bid response").length;
  const softStartups = tags.filter((tag) => tag.label === "Soft startup").length;
  const horsemenSignals = tags.filter((tag) => tag.family === "four-horsemen").length;
  const stonewallingSignals = tags.filter((tag) => tag.metadata?.horseman === "stonewalling").length;
  const positiveCues = cues.filter((cue) => positiveCueTones.has(cue.tone)).length;
  const overwhelmCues = cues.filter((cue) => overwhelmCueTones.has(cue.tone)).length;
  const visualEngagement = countVisual(observations, visualEngagementLabels);
  const visualStress = countVisual(observations, visualStressLabels);
  const visualWithdrawal = countVisual(observations, visualWithdrawalLabels);

  const warmth = clamp(18 + bankDeposits * 12 + validationSignals * 8 + positiveCues * 7 + visualEngagement * 3 + repairSignals * 4 - riskSignals * 6, 0, 100);
  const engagement = clamp(22 + curiositySignals * 10 + turningToward * 10 + softStartups * 5 + visualEngagement * 4 - visualWithdrawal * 3, 0, 100);
  const tension = clamp(10 + riskSignals * 12 + horsemenSignals * 10 + visualStress * 5 + overwhelmCues * 8 - repairSignals * 5, 0, 100);
  const withdrawal = clamp(8 + visualWithdrawal * 6 + stonewallingSignals * 16 + overwhelmCues * 5 - turningToward * 5, 0, 100);
  const repairReadiness = clamp(18 + repairSignals * 14 + validationSignals * 8 + softStartups * 7 + positiveCues * 5 - horsemenSignals * 6 - Math.round(flooding / 5), 0, 100);

  return {
    warmth: Math.round(warmth),
    engagement: Math.round(engagement),
    tension: Math.round(tension),
    flooding,
    withdrawal: Math.round(withdrawal),
    repairReadiness: Math.round(repairReadiness)
  };
}

function deriveStateTags(state: EmotionalStateScores, seconds: number): InteractionTag[] {
  const tags: InteractionTag[] = [];

  if (state.engagement >= 58 && state.warmth >= 45) {
    tags.push({
      id: `tag-state-engaged-${seconds}`,
      label: "Possible warm engagement",
      family: "strength",
      source: "derived",
      seconds,
      evidence: `Warmth ${state.warmth}%, engagement ${state.engagement}%.`,
      suggestion: "Slow down and reinforce what is working before moving to the next topic.",
      confidence: clamp((state.warmth + state.engagement) / 220, 0.45, 0.82),
      metadata: { warmth: state.warmth, engagement: state.engagement }
    });
  }

  if (state.tension >= 58 || state.flooding >= 58) {
    tags.push({
      id: `tag-state-tension-${seconds}`,
      label: "Possible elevated tension",
      family: "flooding",
      source: "derived",
      seconds,
      evidence: `Tension ${state.tension}%, flooding ${state.flooding}%.`,
      suggestion: "Use a body check. If either partner feels flooded, pause and return at a specific time.",
      confidence: clamp((state.tension + state.flooding) / 220, 0.45, 0.84),
      metadata: { tension: state.tension, flooding: state.flooding }
    });
  }

  if (state.withdrawal >= 50) {
    tags.push({
      id: `tag-state-withdrawal-${seconds}`,
      label: "Possible withdrawal",
      family: "flooding",
      source: "derived",
      seconds,
      evidence: `Withdrawal ${state.withdrawal}%.`,
      suggestion: "Check gently: 'Are you needing a pause, or are you still with me?'",
      confidence: clamp(state.withdrawal / 120, 0.42, 0.78),
      metadata: { withdrawal: state.withdrawal }
    });
  }

  if (state.repairReadiness >= 58) {
    tags.push({
      id: `tag-state-repair-ready-${seconds}`,
      label: "Repair readiness",
      family: "repair",
      source: "derived",
      seconds,
      evidence: `Repair readiness ${state.repairReadiness}%.`,
      suggestion: "This is a good window for a short repair, appreciation, or summary of what was heard.",
      confidence: clamp(state.repairReadiness / 115, 0.46, 0.84),
      metadata: { repairReadiness: state.repairReadiness }
    });
  }

  return tags;
}

function buildMetrics(
  segments: TranscriptSegment[],
  hits: PatternHit[],
  signals: BodySignals,
  cues: LiveCue[],
  observations: VisualObservation[],
  tags: InteractionTag[]
): SessionMetrics {
  const wordsA = segments.filter((segment) => segment.speaker === "A").reduce((sum, segment) => sum + countWords(segment.text), 0);
  const wordsB = segments.filter((segment) => segment.speaker === "B").reduce((sum, segment) => sum + countWords(segment.text), 0);
  const maxWords = Math.max(wordsA, wordsB, 1);
  const minWords = Math.min(wordsA, wordsB);
  const turnBalance = Math.round((minWords / maxWords) * 100);
  const positiveSignals = hits.filter((hit) => hit.family === "strength").length;
  const riskSignals = hits.filter((hit) => hit.family === "risk").length;
  const repairSignals = hits.filter((hit) => hit.family === "repair").length;
  const fourHorsemenSignals = tags.filter((tag) => tag.family === "four-horsemen").length;
  const contemptSignals = tags.filter((tag) => tag.metadata?.horseman === "contempt").length;
  const softStartups = tags.filter((tag) => tag.label === "Soft startup").length;
  const validationSignals = tags.filter((tag) => tag.label === "Validation").length;
  const emotionalBankDeposits = tags.filter((tag) => tag.label === "Emotional bank deposit").length;
  const bidsOrTurningToward = tags.filter((tag) => tag.label === "Turning toward / bid response").length;
  const interruptionRisks = tags.filter((tag) => tag.label === "Possible interruption / overlap").length;
  const nonverbalStressSignals = countVisual(observations, visualStressLabels);
  const risk = floodingRisk(signals, cues, observations);
  const emotionalState = scoreEmotionalState(hits, cues, observations, tags, risk);
  const balanceBonus = turnBalance > 60 ? 8 : turnBalance > 40 ? 3 : -7;
  const repairBonus = repairSignals * 4 + softStartups * 2 + validationSignals * 2 + emotionalBankDeposits * 2 + bidsOrTurningToward;
  const riskPenalty = riskSignals * 8 + fourHorsemenSignals * 4 + interruptionRisks * 2 + Math.round(risk / 8);
  const score = clamp(64 + positiveSignals * 4 + repairBonus - riskPenalty + balanceBonus, 0, 100);

  return {
    wordsA,
    wordsB,
    turnBalance,
    positiveSignals,
    riskSignals,
    repairSignals,
    floodingRisk: risk,
    connectionPracticeScore: score,
    emotionalState,
    fourHorsemenSignals,
    contemptSignals,
    softStartups,
    validationSignals,
    emotionalBankDeposits,
    bidsOrTurningToward,
    interruptionRisks,
    nonverbalStressSignals
  };
}

function selectStrengths(metrics: SessionMetrics, tags: InteractionTag[]) {
  const strengths = new Set<string>();
  if (metrics.turnBalance >= 65) strengths.add("Both partners had meaningful speaking space.");
  if (metrics.repairSignals > 0) strengths.add("Repair attempts appeared in the conversation.");
  if (metrics.validationSignals > 0) strengths.add("There were moments of validation and listening.");
  if (metrics.emotionalBankDeposits > 0) strengths.add("The conversation made emotional-bank deposits through appreciation or affection.");
  if (metrics.bidsOrTurningToward > 0) strengths.add("There were bids for connection or turn-toward moments.");
  if (tags.some((tag) => tag.family === "desire")) strengths.add("There was at least one aliveness, desire, play, or separateness cue.");
  if (strengths.size === 0) strengths.add("The conversation produced enough material to choose one concrete practice.");
  return Array.from(strengths).slice(0, 4);
}

function selectRisks(metrics: SessionMetrics, hits: PatternHit[]) {
  const risks = new Set<string>();
  if (metrics.riskSignals > 0) risks.add("Some language may have landed as blame, dismissal, contempt, or defensiveness.");
  if (metrics.fourHorsemenSignals > 0) risks.add("One or more Four Horsemen patterns appeared; use the matching antidote quickly.");
  if (metrics.contemptSignals > 0) risks.add("Possible contempt-risk language deserves immediate softening and respect repair.");
  if (metrics.interruptionRisks > 0) risks.add("Turn-taking may need a clearer speaker handoff.");
  if (metrics.turnBalance < 45) risks.add("Speaking time was uneven enough to review whether both people felt heard.");
  if (metrics.floodingRisk > 58) risks.add("Stress/flooding signals were high enough to justify a timed pause.");
  if (metrics.repairSignals === 0) risks.add("No repair attempt was detected; add one early next time.");
  if (hits.some((hit) => hit.label === "Stonewalling / shutdown risk")) risks.add("Possible shutdown language means problem solving should pause.");
  if (risks.size === 0) risks.add("No major risk pattern was flagged by the current rules.");
  return Array.from(risks).slice(0, 4);
}

function nextSteps(metrics: SessionMetrics, sessionType: SessionType) {
  const steps: string[] = [];
  if (metrics.floodingRisk > 58) {
    steps.push("Take a 20 minute reset before continuing the same topic.");
  }
  if (metrics.contemptSignals > 0) {
    steps.push("Before problem solving, each partner names one specific thing they respect or appreciate.");
  }
  if (metrics.fourHorsemenSignals > 0) {
    steps.push("Review each Four Horsemen tag and rewrite it with the matching antidote.");
  }
  if (metrics.interruptionRisks > 0) {
    steps.push("Use a two-sentence speaker turn, then the listener reflects one thing they heard.");
  }
  if (metrics.riskSignals > metrics.positiveSignals) {
    steps.push("Restart the topic with one gentle startup from each partner.");
  }
  if (metrics.repairSignals === 0) {
    steps.push("Agree on one repair phrase both partners will recognize.");
  }
  if (sessionType === "intimacy") {
    steps.push("Close with one request for tenderness and one request for play.");
  }
  if (sessionType === "shared-meaning") {
    steps.push("Turn one value into a small weekly ritual.");
  }
  steps.push("Review one tagged moment together and relabel it if the app misunderstood.");
  return steps.slice(0, 5);
}

function suggestedScript(metrics: SessionMetrics) {
  if (metrics.floodingRisk > 58) {
    return "I care about us and I am getting flooded. I want to pause now and come back at a specific time.";
  }
  if (metrics.contemptSignals > 0) {
    return "I want to come back to respect. One thing I appreciate about you is ___. The hurt underneath my reaction is ___.";
  }
  if (metrics.fourHorsemenSignals > 0) {
    return "I want to try that again with the antidote. I feel ___ about ___, and what I need is ___.";
  }
  if (metrics.repairSignals > 0) {
    return "Thank you for trying to repair. I can accept that, and I still want us to understand ___.";
  }
  return "One thing I heard you say is ___. One thing I appreciate is ___. One next step I can do is ___.";
}

export function analyzeSession(
  segments: TranscriptSegment[],
  signals: BodySignals,
  cues: LiveCue[],
  sessionType: SessionType,
  observations: VisualObservation[] = []
): SessionAnalysis {
  const scanned = scanSegments(segments);
  const repairAcceptance = detectRepairAcceptance(segments, scanned.tags);
  const baseTags = [
    ...scanned.tags,
    ...cueTags(cues),
    ...visualTags(observations, segments),
    ...repairAcceptance.tags
  ];
  const timelineTags = [...baseTags, ...deriveConversationTags(segments, baseTags, observations)].sort((a, b) => a.seconds - b.seconds);
  const allHits = [
    ...scanned.hits,
    ...cueHits(cues),
    ...visualHits(observations, segments),
    ...repairAcceptance.hits
  ].sort((a, b) => (a.seconds ?? 0) - (b.seconds ?? 0));
  const metrics = buildMetrics(segments, allHits, signals, cues, observations, timelineTags);
  const latestSeconds = Math.max(0, ...segments.map((segment) => segment.endSeconds ?? segment.seconds), ...observations.map((observation) => observation.seconds));
  const allTags = [...timelineTags, ...deriveStateTags(metrics.emotionalState, latestSeconds)].sort((a, b) => a.seconds - b.seconds);

  const summary =
    segments.length === 0
      ? "No transcript was captured yet. Use manual notes or speech capture to generate a richer session reflection."
      : `This ${sessionType.replace("-", " ")} session shows ${metrics.positiveSignals} positive signals, ${metrics.repairSignals} repair signals, ${metrics.fourHorsemenSignals} Four Horsemen signals, ${metrics.nonverbalStressSignals} nonverbal stress cues, and ${allTags.length} tagged data points. Current state estimates: warmth ${metrics.emotionalState.warmth}%, engagement ${metrics.emotionalState.engagement}%, tension ${metrics.emotionalState.tension}%. Treat these as practice indicators, not verdicts.`;

  return {
    summary,
    metrics,
    strengths: selectStrengths(metrics, allTags),
    risks: selectRisks(metrics, allHits),
    nextSteps: nextSteps(metrics, sessionType),
    suggestedScript: suggestedScript(metrics),
    hits: allHits.slice(0, 28),
    tags: allTags
  };
}
