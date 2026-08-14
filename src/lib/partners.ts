import { CoupleProfile, PartnerId } from "../types";

export function partnerName(profile: CoupleProfile, partner: PartnerId) {
  return partner === "A" ? profile.partnerAName || "Partner A" : profile.partnerBName || "Partner B";
}

export function slotName(slot: "left" | "right") {
  return slot === "left" ? "left side of the frame" : "right side of the frame";
}

export function otherPartner(partner: PartnerId): PartnerId;
export function otherPartner(partner: PartnerId | undefined): PartnerId | undefined;
export function otherPartner(partner?: PartnerId): PartnerId | undefined {
  if (!partner) return undefined;
  return partner === "A" ? "B" : "A";
}
