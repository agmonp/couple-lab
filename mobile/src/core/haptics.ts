/**
 * Vibration as a language (plan §3.6). The patterns are plain data so the
 * practice screen, the date and the tests all read the same thing.
 *
 * `timings` alternate off/on in milliseconds, starting with "off" (Android
 * waveform convention). `amplitudes` (0–255) are used where the motor supports
 * them; otherwise the native side falls back to on/off.
 */
export type HapticName = "turnEnd" | "breakStart" | "breatheIn" | "dateEnd";

export interface HapticPattern {
  timings: number[];
  amplitudes: number[];
  /** For the practice screen. */
  label: string;
  meaning: string;
}

function ramp(totalMs: number, steps: number, from: number, to: number) {
  const timings: number[] = [];
  const amplitudes: number[] = [];
  for (let i = 0; i < steps; i++) {
    timings.push(Math.round(totalMs / steps));
    amplitudes.push(Math.round(from + ((to - from) * i) / (steps - 1)));
  }
  return { timings, amplitudes };
}

const inhale = ramp(4000, 8, 30, 170);

export const HAPTICS: Record<HapticName, HapticPattern> = {
  turnEnd: {
    timings: [0, 900],
    amplitudes: [0, 255],
    label: "רטט אחד ארוך",
    meaning: "סוף התור (2 דקות)"
  },
  breakStart: {
    timings: [0, 140, 160, 140],
    amplitudes: [0, 255, 0, 255],
    label: "שניים קצרים",
    meaning: "הפסקה התחילה"
  },
  breatheIn: {
    // Rising while breathing in for 4 seconds; the 6 seconds out are quiet.
    timings: [0, ...inhale.timings],
    amplitudes: [0, ...inhale.amplitudes],
    label: "פעימה איטית חוזרת",
    meaning: "נשימה: שואפים כשרוטט (4), נושפים בשקט (6)"
  },
  dateEnd: {
    timings: [0, 130, 130, 130, 130, 130],
    amplitudes: [0, 255, 0, 255, 0, 255],
    label: "שלושה קצרים",
    meaning: "הדייט נגמר"
  }
};

/** One breathing cycle: 4 seconds in, 6 out. */
export const BREATH_CYCLE_MS = 10_000;
export const BREATH_IN_MS = 4_000;

export function patternDuration(name: HapticName) {
  return HAPTICS[name].timings.reduce((sum, t) => sum + t, 0);
}

/** The fallback when amplitudes are unavailable: keep only clear "on" blocks. */
export function onOffTimings(name: HapticName) {
  // Breathing becomes four short pulses, one per second, instead of a ramp.
  return name === "breatheIn" ? [0, 160, 840, 160, 840, 160, 840, 160] : HAPTICS[name].timings;
}
