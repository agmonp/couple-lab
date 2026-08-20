import { Fingerprint, HardDrive, LockKeyhole, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BiometricEnrollmentWizard } from "./BiometricEnrollmentWizard";
import { isPartnerBiometricReady } from "./biometricReadiness";
import type {
  BiometricEnrollmentSummary,
  CoupleProfile,
  DesktopRuntimeInfo,
  PartnerId,
  VoiceModelStatus
} from "./types";

function templateText(summary: BiometricEnrollmentSummary | null, partnerId: PartnerId) {
  const partner = summary?.partners[partnerId];
  return isPartnerBiometricReady(partner) ? "הזיהוי מוכן" : "עדיין לא למדנו לזהות";
}

export function DesktopFoundationPanel({
  profile,
  targetPartner,
  onSummaryChange,
  onProfilePhotoCaptured,
  onEnrollmentComplete,
  completionActionLabel
}: {
  profile: CoupleProfile;
  targetPartner?: PartnerId;
  onSummaryChange?: (summary: BiometricEnrollmentSummary) => void;
  onProfilePhotoCaptured?: (partnerId: PartnerId, dataUrl: string) => void;
  onEnrollmentComplete?: () => void;
  completionActionLabel?: string;
}) {
  const [runtime, setRuntime] = useState<DesktopRuntimeInfo | null>(null);
  const [summary, setSummary] = useState<BiometricEnrollmentSummary | null>(null);
  const [voiceModel, setVoiceModel] = useState<VoiceModelStatus | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [error, setError] = useState("");
  const [busyPartner, setBusyPartner] = useState<PartnerId | null>(null);

  const refresh = useCallback(async () => {
    const bridge = window.coupleLabDesktop;
    if (!bridge) return;
    try {
      const [runtimeInfo, enrollmentSummary, modelStatus] = await Promise.all([
        bridge.getRuntimeInfo(),
        bridge.getBiometricEnrollmentSummary(),
        bridge.getVoiceModelStatus()
      ]);
      setRuntime(runtimeInfo);
      setSummary(enrollmentSummary);
      onSummaryChange?.(enrollmentSummary);
      setVoiceModel(modelStatus);
      setError("");
    } catch {
      setError("לא הצלחנו להכין את הזיהוי. נסו לסגור ולפתוח את האפליקציה.");
    }
  }, [onSummaryChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const partnerAName = profile.partnerAName.trim();
  const partnerBName = profile.partnerBName.trim();
  const targetName = targetPartner === "A" ? partnerAName : targetPartner === "B" ? partnerBName : "";
  const namesReady = targetPartner ? Boolean(targetName) : Boolean(partnerAName && partnerBName);

  if (!window.coupleLabDesktop) {
    return (
      <section
        className="panel desktop-foundation desktop-unavailable wide"
        aria-labelledby={targetPartner ? undefined : "desktop-foundation-title"}
        aria-label={targetPartner ? `זיהוי של ${targetName}` : undefined}
      >
        {!targetPartner && (
          <div className="panel-heading">
            <div>
              <h2 id="desktop-foundation-title">נלמד לזהות אתכם באפליקציה שבמחשב</h2>
            </div>
            <HardDrive size={20} aria-hidden="true" />
          </div>
        )}
        <div className="runtime-notice">
          <strong>הזיהוי האוטומטי אינו זמין בחלון הזה</strong>
          <p>פתחו את Couple Lab מהסמל שעל שולחן העבודה כדי שנוכל ללמוד לזהות אתכם.</p>
        </div>
        <p className="desktop-foundation-note">אפשר להמשיך עכשיו ולחזור לשלב הזה מאוחר יותר.</p>
      </section>
    );
  }

  const clearPartner = async (partnerId: PartnerId) => {
    const name = partnerId === "A" ? profile.partnerAName || "שותף/ה א׳" : profile.partnerBName || "שותף/ה ב׳";
    if (!window.confirm(`למחוק את נתוני הזיהוי של ${name}?`)) return;
    setBusyPartner(partnerId);
    try {
      await window.coupleLabDesktop?.clearBiometricEnrollment(partnerId);
      await refresh();
    } catch {
      setError(`מחיקת נתוני הזיהוי של ${name} נכשלה.`);
    } finally {
      setBusyPartner(null);
    }
  };

  const canEnroll = runtime?.biometricEncryption === "os" && voiceModel?.ready && namesReady;
  const shownPartners: PartnerId[] = targetPartner ? [targetPartner] : ["A", "B"];
  const targetHasTemplates = targetPartner
    ? isPartnerBiometricReady(summary?.partners[targetPartner])
    : isPartnerBiometricReady(summary?.partners.A) && isPartnerBiometricReady(summary?.partners.B);

  return (
    <section
      className={`panel desktop-foundation wide ${targetPartner ? "embedded-enrollment" : ""}`}
      aria-labelledby={targetPartner ? undefined : "desktop-foundation-title"}
      aria-label={targetPartner ? `זיהוי של ${targetName}` : undefined}
    >
      {!targetPartner && (
        <div className="panel-heading">
          <div>
            <h2 id="desktop-foundation-title">
              {namesReady ? `נלמד לזהות את ${partnerAName} ואת ${partnerBName}` : "נלמד לזהות אתכם"}
            </h2>
          </div>
          <HardDrive size={20} aria-hidden="true" />
        </div>
      )}

      <div className="desktop-enrollment-actions">
        <div>
          <Fingerprint size={22} />
          <div>
            <strong>{targetHasTemplates ? `המערכת כבר מכירה את ${targetName || "שניכם"}` : "שני משפטים וכמה תמונות קצרות"}</strong>
            <p>{namesReady ? "כך נוכל לשייך את הדיבור לאדם הנכון בזמן השיחה." : "הזינו תחילה שם."}</p>
          </div>
        </div>
        <button className="primary" disabled={!canEnroll} onClick={() => setWizardOpen(true)}>
          {!namesReady
            ? "יש להזין שם"
            : targetHasTemplates
              ? "ללמד מחדש"
              : targetPartner ? "כן, נתחיל" : `מתחילים עם ${partnerAName}`}
        </button>
      </div>

      <details className="desktop-advanced">
        <summary>פרטיות ואפשרויות</summary>
        <div className="desktop-status-grid">
          <div>
            <LockKeyhole size={18} />
            <span>שמירה במחשב</span>
            <strong>{!runtime ? "בודק…" : runtime.biometricEncryption === "os" ? "המידע מוגן" : "הגנת המידע אינה זמינה"}</strong>
          </div>
          {shownPartners.map((partnerId) => {
            const name = partnerId === "A" ? profile.partnerAName || "שותף/ה א׳" : profile.partnerBName || "שותף/ה ב׳";
            const hasTemplates = isPartnerBiometricReady(summary?.partners[partnerId]);
            return (
              <div key={partnerId}>
                <span>{name}</span>
                <strong>{templateText(summary, partnerId)}</strong>
                {hasTemplates && (
                  <button className="text-button danger-text" disabled={busyPartner === partnerId} onClick={() => void clearPartner(partnerId)}>
                    <Trash2 size={15} /> מחיקת הזיהוי
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <p className="desktop-foundation-note">
          הזיהוי מתבצע במחשב הזה בלבד. כשלא נהיה בטוחים, לא ננחש.
        </p>
      </details>
      {error && <p className="error-text">{error}</p>}
      {wizardOpen && (
        <BiometricEnrollmentWizard
          profile={profile}
          initialPartnerId={targetPartner}
          singlePartner={Boolean(targetPartner)}
          onProfilePhotoCaptured={onProfilePhotoCaptured}
          onClose={() => setWizardOpen(false)}
          onSaved={refresh}
          onComplete={onEnrollmentComplete}
          completionActionLabel={completionActionLabel}
        />
      )}
    </section>
  );
}
