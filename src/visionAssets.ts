export interface VisionAssetUrls {
  wasmRoot: string;
  faceModel: string;
  poseModel: string;
}

export function resolveVisionAssetUrls(currentHref: string, baseUrl: string): VisionAssetUrls {
  const assetUrl = (path: string) => new URL(`${baseUrl}${path}`, currentHref).toString();

  return {
    wasmRoot: assetUrl("mediapipe/wasm").replace(/\/$/, ""),
    faceModel: assetUrl("models/face_landmarker.task"),
    poseModel: assetUrl("models/pose_landmarker_lite.task")
  };
}

export function getVisionAssetUrls(): VisionAssetUrls {
  return resolveVisionAssetUrls(window.location.href, import.meta.env.BASE_URL);
}
