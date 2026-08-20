const MAX_TEMPLATES_PER_MODALITY = 20;
const MAX_VECTOR_DIMENSIONS = 4096;

function emptyEnrollmentState() {
  return { schemaVersion: 1, partners: {} };
}

function validateTemplate(template) {
  if (!template || typeof template !== "object") throw new Error("invalid-biometric-template");
  if (typeof template.modelId !== "string" || !template.modelId.trim() || template.modelId.length > 200) {
    throw new Error("invalid-biometric-model-id");
  }
  if (!Array.isArray(template.vector) || template.vector.length === 0 || template.vector.length > MAX_VECTOR_DIMENSIONS) {
    throw new Error("invalid-biometric-vector-size");
  }
  if (!template.vector.every((value) => Number.isFinite(value))) {
    throw new Error("invalid-biometric-vector-value");
  }
  if (typeof template.capturedAt !== "string" || !Number.isFinite(Date.parse(template.capturedAt))) {
    throw new Error("invalid-biometric-captured-at");
  }
  if (template.quality !== undefined && (!Number.isFinite(template.quality) || template.quality < 0 || template.quality > 1)) {
    throw new Error("invalid-biometric-quality");
  }
  return {
    modelId: template.modelId.trim(),
    vector: template.vector.map(Number),
    capturedAt: template.capturedAt,
    ...(template.quality === undefined ? {} : { quality: template.quality })
  };
}

function validatePartnerEnrollment(partnerId, value) {
  if (!value || typeof value !== "object") throw new Error("invalid-partner-enrollment");
  const displayName = typeof value.displayName === "string" ? value.displayName.trim().slice(0, 200) : "";
  const faceTemplates = Array.isArray(value.faceTemplates) ? value.faceTemplates : [];
  const voiceTemplates = Array.isArray(value.voiceTemplates) ? value.voiceTemplates : [];
  if (faceTemplates.length > MAX_TEMPLATES_PER_MODALITY || voiceTemplates.length > MAX_TEMPLATES_PER_MODALITY) {
    throw new Error("too-many-biometric-templates");
  }
  return {
    partnerId,
    displayName,
    faceTemplates: faceTemplates.map(validateTemplate),
    voiceTemplates: voiceTemplates.map(validateTemplate),
    updatedAt:
      typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))
        ? value.updatedAt
        : new Date().toISOString()
  };
}

function validateEnrollmentState(value) {
  if (!value || typeof value !== "object") throw new Error("invalid-enrollment-state");
  const partners = value.partners && typeof value.partners === "object" ? value.partners : {};
  return {
    schemaVersion: 1,
    partners: {
      ...(partners.A ? { A: validatePartnerEnrollment("A", partners.A) } : {}),
      ...(partners.B ? { B: validatePartnerEnrollment("B", partners.B) } : {})
    }
  };
}

function enrollmentSummary(state) {
  return {
    schemaVersion: state.schemaVersion,
    partners: Object.fromEntries(
      Object.entries(state.partners).map(([partnerId, partner]) => [
        partnerId,
        {
          displayName: partner.displayName,
          faceTemplateCount: partner.faceTemplates.length,
          voiceTemplateCount: partner.voiceTemplates.length,
          updatedAt: partner.updatedAt
        }
      ])
    )
  };
}

module.exports = {
  MAX_TEMPLATES_PER_MODALITY,
  MAX_VECTOR_DIMENSIONS,
  emptyEnrollmentState,
  enrollmentSummary,
  validateEnrollmentState
};
