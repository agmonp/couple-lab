import { useEffect, useRef, useState } from "react";
import { FaceDownDetector, type Orientation } from "./core/faceDown";

/**
 * Face-down detection while `enabled`. `sensor` turns false when no motion
 * event arrives within two seconds (a desktop browser, a phone without an
 * accelerometer), so the screen can offer a manual start instead.
 */
export function useFaceDown(enabled: boolean, onChange: (orientation: Orientation) => void) {
  const [sensor, setSensor] = useState<boolean | null>(null);
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const detector = new FaceDownDetector();
    let seen = false;
    const onMotion = (event: DeviceMotionEvent) => {
      const g = event.accelerationIncludingGravity;
      if (!g || g.z === null || g.x === null || g.y === null) return;
      if (!seen) {
        seen = true;
        setSensor(true);
      }
      const change = detector.push({ x: g.x, y: g.y, z: g.z, t: performance.now() });
      if (change) handler.current(change);
    };
    window.addEventListener("devicemotion", onMotion);
    const timeout = window.setTimeout(() => {
      if (!seen) setSensor(false);
    }, 2000);
    return () => {
      window.removeEventListener("devicemotion", onMotion);
      window.clearTimeout(timeout);
    };
  }, [enabled]);

  return sensor;
}

/** Re-render every `ms` while `on`, for clocks. */
export function useNow(on: boolean, ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [on, ms]);
  return now;
}
