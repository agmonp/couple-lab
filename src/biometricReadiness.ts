import type {
  BiometricEnrollmentState,
  PartnerBiometricEnrollment,
  PartnerBiometricSummary,
  PartnerId
} from "./types";

type EnrollmentForPartner = PartnerBiometricEnrollment | PartnerBiometricSummary | undefined;

export function isPartnerBiometricReady(enrollment: EnrollmentForPartner) {
  if (!enrollment) return false;
  const faceCount = "faceTemplateCount" in enrollment
    ? enrollment.faceTemplateCount
    : enrollment.faceTemplates.length;
  const voiceCount = "voiceTemplateCount" in enrollment
    ? enrollment.voiceTemplateCount
    : enrollment.voiceTemplates.length;
  return faceCount > 0 && voiceCount > 0;
}

export function incompleteBiometricPartners(state: BiometricEnrollmentState): PartnerId[] {
  return (["A", "B"] as PartnerId[]).filter(
    (partnerId) => !isPartnerBiometricReady(state.partners[partnerId])
  );
}
