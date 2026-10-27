/**
 * "Screen down" from the accelerometer, with hysteresis so a wobble on the
 * sofa does not pause the clock. Gravity reads about +9.8 on z when the phone
 * lies face up and about −9.8 face down.
 */
export interface MotionSample {
  x: number;
  y: number;
  z: number;
  t: number;
}

export type Orientation = "down" | "up";

export interface FaceDownOptions {
  /** z at or below this counts as face down. */
  downZ?: number;
  /** z above this counts as no longer face down. */
  upZ?: number;
  /** Face down must hold this long before it counts (placing the phone takes a moment). */
  holdDownMs?: number;
  /** Lifting must hold this long before the clock pauses. */
  holdUpMs?: number;
}

export class FaceDownDetector {
  private readonly downZ: number;
  private readonly upZ: number;
  private readonly holdDownMs: number;
  private readonly holdUpMs: number;
  private state: Orientation = "up";
  private candidateSince?: number;

  constructor({ downZ = -8, upZ = -5, holdDownMs = 1200, holdUpMs = 500 }: FaceDownOptions = {}) {
    this.downZ = downZ;
    this.upZ = upZ;
    this.holdDownMs = holdDownMs;
    this.holdUpMs = holdUpMs;
  }

  get orientation() {
    return this.state;
  }

  /** Feed one sample; returns the new orientation when it changes, otherwise null. */
  push({ x, y, z, t }: MotionSample): Orientation | null {
    const flat = Math.abs(x) < 3.5 && Math.abs(y) < 3.5;
    const looksDown = z <= this.downZ && flat;
    const looksUp = z > this.upZ;
    const wants: Orientation | null = this.state === "up" ? (looksDown ? "down" : null) : looksUp ? "up" : null;
    if (!wants) {
      this.candidateSince = undefined;
      return null;
    }
    this.candidateSince ??= t;
    const hold = wants === "down" ? this.holdDownMs : this.holdUpMs;
    if (t - this.candidateSince < hold) return null;
    this.state = wants;
    this.candidateSince = undefined;
    return wants;
  }
}
