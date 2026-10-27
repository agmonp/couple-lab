import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Haptics } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";
import { HAPTICS, type HapticName, onOffTimings } from "../core/haptics";

/**
 * Everything that touches the phone, behind small functions with a browser
 * fallback, so the web preview runs the same screens.
 *
 * CoupleNative is this app's Kotlin plugin (android/app/src/main/java/com/couplelab/app):
 * waveform vibration, keep-screen-on, Do Not Disturb, and font scaling.
 */
interface CoupleNativePlugin {
  vibrate(options: { timings: number[]; amplitudes: number[] }): Promise<void>;
  cancelVibration(): Promise<void>;
  keepAwake(options: { on: boolean }): Promise<void>;
  dndStatus(): Promise<{ granted: boolean; active: boolean }>;
  openDndSettings(): Promise<void>;
  setDnd(options: { on: boolean }): Promise<{ applied: boolean }>;
}

const CoupleNative = registerPlugin<CoupleNativePlugin>("CoupleNative");
export const isNative = Capacitor.isNativePlatform();

// Storage --------------------------------------------------------------------

export async function loadValue(key: string): Promise<string | null> {
  if (isNative) return (await Preferences.get({ key })).value;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function saveValue(key: string, value: string) {
  if (isNative) return Preferences.set({ key, value });
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private window: the session still works, it just will not persist */
  }
}

/**
 * The event log. On the phone it lives in an encrypted file (key in Android
 * Keystore, plan §3.4), where the background sync can read it too. A log from
 * before that, still in Preferences, moves over once.
 */
export async function loadEvents(): Promise<string | null> {
  if (!isNative) return loadValue(EVENTS_KEY);
  const { Pair } = await import("./pair");
  const stored = (await Pair.storeRead({ key: "events" })).text;
  if (stored !== null) return stored;
  const old = (await Preferences.get({ key: EVENTS_KEY })).value;
  if (old !== null) {
    await Pair.storeWrite({ key: "events", text: old });
    await Preferences.remove({ key: EVENTS_KEY });
  }
  return old;
}

export async function saveEvents(text: string) {
  if (!isNative) return saveValue(EVENTS_KEY, text);
  const { Pair } = await import("./pair");
  await Pair.storeWrite({ key: "events", text });
}

const EVENTS_KEY = "cl.events";

export async function clearAll() {
  if (isNative) {
    const { Pair } = await import("./pair");
    await Pair.unpair().catch(() => {});
    await Pair.storeWrite({ key: "events", text: null }).catch(() => {});
    await Preferences.clear();
    await LocalNotifications.cancel({ notifications: [{ id: 1 }, { id: 2 }] }).catch(() => {});
    return;
  }
  try {
    window.localStorage.clear();
  } catch {
    /* nothing stored */
  }
}

// Haptics --------------------------------------------------------------------

export async function vibrate(name: HapticName) {
  const pattern = HAPTICS[name];
  if (isNative) {
    try {
      await CoupleNative.vibrate({ timings: pattern.timings, amplitudes: pattern.amplitudes });
      return;
    } catch {
      // Plugin missing (old build): the longest "on" block through Capacitor Haptics.
      await Haptics.vibrate({ duration: Math.max(...onOffTimings(name)) });
      return;
    }
  }
  if ("vibrate" in navigator) navigator.vibrate(onOffTimings(name));
}

export async function stopVibration() {
  if (isNative) await CoupleNative.cancelVibration().catch(() => {});
  else if ("vibrate" in navigator) navigator.vibrate(0);
}

/** Status bar icons to match the screen: dark icons on the light screens, light ones at night. */
export function setBarsForNight(night: boolean) {
  if (!isNative) return;
  SystemBars.setStyle({ style: night ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
}

let wakeLock: { release(): Promise<void> } | null = null;

/** Keep the screen on during a date, so the clock and the vibrations keep running face down. */
export async function keepAwake(on: boolean) {
  if (isNative) {
    await CoupleNative.keepAwake({ on }).catch(() => {});
    return;
  }
  try {
    if (on && !wakeLock && "wakeLock" in navigator) {
      wakeLock = await (navigator as Navigator & { wakeLock: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock.request("screen");
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* not allowed here; the date still works while the screen is on */
  }
}

// Do Not Disturb ---------------------------------------------------------------

export async function dndStatus() {
  if (!isNative) return { granted: false, active: false, available: false };
  try {
    return { ...(await CoupleNative.dndStatus()), available: true };
  } catch {
    return { granted: false, active: false, available: false };
  }
}

export async function openDndSettings() {
  if (isNative) await CoupleNative.openDndSettings().catch(() => {});
}

/** Turns DND on for the date and restores what was there before when `on` is false. */
export async function setDnd(on: boolean) {
  if (!isNative) return false;
  try {
    return (await CoupleNative.setDnd({ on })).applied;
  } catch {
    return false;
  }
}

// Notifications -----------------------------------------------------------------

export async function notificationsAllowed() {
  if (!isNative) return false;
  return (await LocalNotifications.checkPermissions()).display === "granted";
}

export async function askNotifications() {
  if (!isNative) return false;
  const result = await LocalNotifications.requestPermissions();
  return result.display === "granted";
}

export async function scheduleDaily(id: number, hour: number, minute: number, text: { title: string; body: string }) {
  if (!isNative) return;
  await LocalNotifications.cancel({ notifications: [{ id }] });
  await LocalNotifications.schedule({
    notifications: [{ id, title: text.title, body: text.body, schedule: { on: { hour, minute }, allowWhileIdle: true }, isExactNotification: false }]
  });
}

// Reminders are inexact on purpose: a few minutes either way is fine, and an exact alarm
// would send people to the "Alarms & reminders" settings screen with no explanation.
export async function scheduleOnce(id: number, at: Date, text: { title: string; body: string }) {
  if (!isNative) return;
  await LocalNotifications.cancel({ notifications: [{ id }] });
  await LocalNotifications.schedule({ notifications: [{ id, title: text.title, body: text.body, schedule: { at, allowWhileIdle: true }, isExactNotification: false }] });
}

export async function cancelNotification(id: number) {
  if (isNative) await LocalNotifications.cancel({ notifications: [{ id }] });
}

// Sharing -------------------------------------------------------------------------

/** Opens the Android share sheet with a PNG (data URL). Returns false if the person closed it. */
export async function shareImage(dataUrl: string, fileName: string, title: string) {
  const base64 = dataUrl.split(",")[1];
  if (isNative) {
    const written = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    try {
      await Share.share({ title, files: [written.uri], dialogTitle: title });
      return true;
    } catch {
      return false;
    }
  }
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], fileName, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title }).catch(() => {});
    return true;
  }
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
  return true;
}

/** Shares a text file (the weekly step as a calendar event). */
export async function shareTextFile(content: string, fileName: string, title: string) {
  if (isNative) {
    const written = await Filesystem.writeFile({ path: fileName, data: content, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title, files: [written.uri], dialogTitle: title }).catch(() => {});
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type: "text/calendar" }));
  link.download = fileName;
  link.click();
}

export function dial(number: string) {
  window.location.href = `tel:${number}`;
}
