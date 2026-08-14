import { formatTime } from "../lib/format";
import { partnerName } from "../lib/partners";
import { CoupleProfile, InteractionTag } from "../types";

export function tagFamilyLabel(family: InteractionTag["family"]) {
  const labels: Record<InteractionTag["family"], string> = {
    "four-horsemen": "Four Horsemen",
    repair: "Repair",
    strength: "Strength",
    flooding: "Flooding",
    "turn-taking": "Turn-taking",
    nonverbal: "Nonverbal",
    desire: "Desire",
    "conversation-structure": "Structure"
  };

  return labels[family];
}

export function tagParticipantLine(profile: CoupleProfile, tag: InteractionTag) {
  if (tag.speaker && tag.target) {
    return `${partnerName(profile, tag.speaker)} to ${partnerName(profile, tag.target)}`;
  }
  if (tag.speaker) {
    return partnerName(profile, tag.speaker);
  }
  return "Couple moment";
}

export function TaggedTimeline({ profile, tags, title }: { profile: CoupleProfile; tags: InteractionTag[]; title: string }) {
  return (
    <div className="tagged-timeline">
      <strong>{title}</strong>
      {tags.length === 0 && <span className="muted">No tagged moments yet.</span>}
      {tags.map((tag) => (
        <article key={tag.id} className={`timeline-tag ${tag.family}`}>
          <div>
            <span>{formatTime(tag.seconds)}</span>
            <b>{tag.label}</b>
            <small>
              {tagParticipantLine(profile, tag)} - {tag.source} - {tagFamilyLabel(tag.family)} - {Math.round(tag.confidence * 100)}%
            </small>
          </div>
          <p>{tag.evidence}</p>
          {tag.suggestion && <small>{tag.suggestion}</small>}
        </article>
      ))}
    </div>
  );
}
