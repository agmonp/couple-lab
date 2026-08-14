import { FaceLandmarker, FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { CoupleProfile, PartnerId, VisualObservation } from "../types";
import { partnerName } from "./partners";
import { average, clamp, nowId } from "./utils";

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

/** How far back the sustained-pattern pass looks when deriving window observations. */
const DERIVED_WINDOW_SECONDS = 14;

export interface VisionModels {
  face: FaceLandmarker;
  pose: PoseLandmarker;
}

/** Loads the face and pose models, preferring GPU and falling back to CPU. */
export async function loadVisionModels(): Promise<VisionModels> {
  const vision = await FilesetResolver.forVisionTasks(WASM_PATH);

  const createFace = (delegate: "GPU" | "CPU") =>
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: { delegate, modelAssetPath: FACE_MODEL },
      runningMode: "VIDEO",
      numFaces: 2,
      outputFaceBlendshapes: true
    });

  const createPose = (delegate: "GPU" | "CPU") =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { delegate, modelAssetPath: POSE_MODEL },
      runningMode: "VIDEO",
      numPoses: 2
    });

  try {
    return { face: await createFace("GPU"), pose: await createPose("GPU") };
  } catch {
    return { face: await createFace("CPU"), pose: await createPose("CPU") };
  }
}

function readBlendshape(categories: Array<{ categoryName?: string; score?: number }>, name: string) {
  return categories.find((category) => category.categoryName === name)?.score ?? 0;
}

function faceSlot(landmarks: Array<{ x?: number }>): "left" | "right" {
  const xs = landmarks.map((landmark) => landmark.x ?? 0.5);
  return average(xs) < 0.5 ? "left" : "right";
}

/** Which partner sits in a given half of the frame, per the saved calibration. */
export function subjectForSlot(profile: CoupleProfile, slot: "left" | "right"): PartnerId {
  if (profile.visualCalibration) {
    return profile.visualCalibration.A === slot ? "A" : "B";
  }
  return slot === "left" ? "A" : "B";
}

/**
 * Second pass over a rolling window: single frames are noisy, so warmth, tension,
 * and withdrawal only become observations once several cues stack up.
 */
export function deriveVisualWindowObservations(
  current: VisualObservation[],
  batch: VisualObservation[],
  sampleSeconds: number
): VisualObservation[] {
  const windowItems = [...current.slice(-50), ...batch].filter(
    (item) => sampleSeconds - item.seconds <= DERIVED_WINDOW_SECONDS
  );
  const derived: VisualObservation[] = [];
  const count = (labels: VisualObservation["label"][], subject?: PartnerId) =>
    windowItems.filter((item) => labels.includes(item.label) && (!subject || item.subject === subject)).length;

  const push = (
    label: VisualObservation["label"],
    cueCount: number,
    score: number,
    evidence: string,
    subject?: PartnerId
  ) => {
    derived.push({
      id: nowId("visual-derived"),
      seconds: sampleSeconds,
      label,
      subject,
      score,
      evidence,
      provider: "derived",
      metadata: { windowSeconds: DERIVED_WINDOW_SECONDS, cueCount }
    });
  };

  (["A", "B"] as PartnerId[]).forEach((subject) => {
    const warmth = count(["warm-expression", "partner-gaze"], subject);
    const stress = count(["brow-tension", "mouth-tension", "closed-posture", "leaning-away", "head-turned-away"], subject);
    const withdrawal = count(["looking-away", "leaning-away", "head-turned-away", "closed-posture"], subject);

    if (warmth >= 2) {
      push(
        "sustained-warmth",
        warmth,
        clamp(0.52 + warmth * 0.08, 0.52, 0.86),
        `${warmth} warmth/partner-gaze cues in the last ${DERIVED_WINDOW_SECONDS} seconds`,
        subject
      );
    }
    if (stress >= 3) {
      push(
        "sustained-tension",
        stress,
        clamp(0.5 + stress * 0.07, 0.5, 0.84),
        `${stress} tension/posture cues in the last ${DERIVED_WINDOW_SECONDS} seconds`,
        subject
      );
    }
    if (withdrawal >= 3) {
      push(
        "possible-withdrawal",
        withdrawal,
        clamp(0.48 + withdrawal * 0.07, 0.48, 0.82),
        `${withdrawal} look-away/lean-away cues in the last ${DERIVED_WINDOW_SECONDS} seconds`,
        subject
      );
    }
  });

  const engagement = count(["warm-expression", "partner-gaze", "mutual-attention", "shared-frame", "sustained-warmth"]);
  if (engagement >= 4) {
    push(
      "possible-engagement",
      engagement,
      clamp(0.5 + engagement * 0.05, 0.5, 0.84),
      `${engagement} warmth/gaze/shared-frame cues in the last ${DERIVED_WINDOW_SECONDS} seconds`
    );
  }

  return derived;
}

/**
 * Runs both landmarkers over one video frame and turns the raw blendshapes and pose
 * landmarks into observations. Every cue is deliberately hedged — these are weak
 * signals meant to prompt a conversation, not to prove an emotion.
 */
export function detectFrameObservations(
  models: VisionModels,
  video: HTMLVideoElement,
  profile: CoupleProfile,
  sampleSeconds: number,
  calibrationText: string
): VisualObservation[] {
  const timestamp = Date.now();
  const observations: VisualObservation[] = [];
  const faceResults = models.face.detectForVideo(video, timestamp);
  const poseResults = models.pose.detectForVideo(video, timestamp);
  const faceCount = faceResults.faceLandmarks?.length ?? 0;
  const partnerGazeSubjects = new Set<PartnerId>();

  const add = (
    label: VisualObservation["label"],
    score: number,
    evidence: string,
    subject?: PartnerId,
    metadata?: VisualObservation["metadata"]
  ) => {
    observations.push({ id: nowId("visual"), seconds: sampleSeconds, label, subject, score, evidence, metadata });
  };

  if (faceCount > 0) {
    const calibratedNote = profile.visualCalibration ? `; ${calibrationText}` : "";
    add(
      "face-visible",
      Math.min(0.9, 0.45 + faceCount * 0.2),
      `${faceCount} face${faceCount > 1 ? "s" : ""} visible${calibratedNote}`
    );
  } else {
    add("looking-away", 0.55, "No face visible in sampled frame");
  }

  if (faceCount >= 2) {
    add("shared-frame", 0.82, "Both partners appeared in the same frame");
  }

  (faceResults.faceBlendshapes ?? []).forEach((blendshapeSet, faceIndex) => {
    const categories = blendshapeSet.categories ?? [];
    const landmarks = faceResults.faceLandmarks?.[faceIndex] ?? [];
    const subject = subjectForSlot(profile, faceSlot(landmarks));
    const shape = (name: string) => readBlendshape(categories, name);

    const smile = (shape("mouthSmileLeft") + shape("mouthSmileRight")) / 2;
    const brow = (shape("browDownLeft") + shape("browDownRight") + shape("browInnerUp")) / 3;
    const mouthTension =
      (shape("mouthPressLeft") + shape("mouthPressRight") + shape("mouthFrownLeft") + shape("mouthFrownRight")) / 4;
    const eyeAway = (shape("eyeLookOutLeft") + shape("eyeLookOutRight")) / 2;
    const eyeInside = (shape("eyeLookInLeft") + shape("eyeLookInRight")) / 2;

    const nose = landmarks[1];
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const eyeCenter = leftEye && rightEye ? ((leftEye.x ?? 0.5) + (rightEye.x ?? 0.5)) / 2 : 0.5;
    const headYawOffset = nose ? Math.abs((nose.x ?? 0.5) - eyeCenter) : 0;

    if (smile > 0.28) add("warm-expression", smile, "Smile-related face blendshapes rose", subject);
    if (brow > 0.24) add("brow-tension", brow, "Brow tension blendshapes rose", subject);
    if (mouthTension > 0.2) add("mouth-tension", mouthTension, "Mouth press/frown blendshapes rose", subject);
    if (eyeAway > 0.35) add("looking-away", eyeAway, "Eye-look-away blendshapes rose", subject);
    if (headYawOffset > 0.04) {
      add(
        "head-turned-away",
        clamp(headYawOffset * 9, 0.38, 0.78),
        "Head orientation shifted away from the face center",
        subject,
        { headYawOffset: Number(headYawOffset.toFixed(3)) }
      );
    }
    if (faceCount >= 2 && eyeAway < 0.22 && eyeInside < 0.42) {
      partnerGazeSubjects.add(subject);
      add("partner-gaze", 0.7, `${partnerName(profile, subject)} likely oriented toward the partner in a shared frame`, subject);
    }
  });

  if (partnerGazeSubjects.has("A") && partnerGazeSubjects.has("B")) {
    add("mutual-attention", 0.76, "Both calibrated partners were likely oriented toward each other");
  }

  const poses = poseResults.landmarks ?? [];
  if (poses.length > 0) {
    add(
      "body-visible",
      Math.min(0.9, 0.48 + poses.length * 0.18),
      `${poses.length} body pose${poses.length > 1 ? "s" : ""} visible`
    );
  }

  poses.forEach((pose) => {
    const leftShoulder = pose[11];
    const rightShoulder = pose[12];
    const leftWrist = pose[15];
    const rightWrist = pose[16];
    if (!leftShoulder || !rightShoulder) return;

    const shoulderCenter = (leftShoulder.x + rightShoulder.x) / 2;
    if (shoulderCenter < 0.28 || shoulderCenter > 0.72) {
      add("leaning-away", Math.abs(shoulderCenter - 0.5), "Pose center shifted toward the edge of frame");
    }

    if (leftWrist && rightWrist) {
      const wristsNearChest =
        Math.abs(leftWrist.x - rightShoulder.x) < 0.14 && Math.abs(rightWrist.x - leftShoulder.x) < 0.14;
      if (wristsNearChest) {
        add("closed-posture", 0.58, "Wrists crossed near opposite shoulders");
      }
    }
  });

  return observations;
}

/** Counts faces in the current frame, used to confirm a calibration is trustworthy. */
export function countVisibleFaces(models: VisionModels, video: HTMLVideoElement) {
  return models.face.detectForVideo(video, Date.now()).faceLandmarks?.length ?? 0;
}
