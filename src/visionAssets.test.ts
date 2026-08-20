import { describe, expect, it } from "vitest";
import { resolveVisionAssetUrls } from "./visionAssets";

describe("local MediaPipe asset URLs", () => {
  it("resolves packaged assets next to the Electron entry page", () => {
    expect(resolveVisionAssetUrls("couple-lab://app/index.html", "./")).toEqual({
      wasmRoot: "couple-lab://app/mediapipe/wasm",
      faceModel: "couple-lab://app/models/face_landmarker.task",
      poseModel: "couple-lab://app/models/pose_landmarker_lite.task"
    });
  });

  it("resolves the same assets from the Vite development server", () => {
    expect(resolveVisionAssetUrls("http://127.0.0.1:5173/", "./").faceModel).toBe(
      "http://127.0.0.1:5173/models/face_landmarker.task"
    );
  });
});
