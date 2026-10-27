import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { PartnerId } from "@shared/types";
import type { LogEvent, VersionVector } from "../core/events";
import { isNative } from "./device";

/**
 * The two-phone link (CouplePairPlugin.kt / PairLink.kt). Pairing, sync and the
 * pair key live natively; the web layer sees a status, gets arrivals through
 * the inbox, and sends live signals. In a browser there is no link at all.
 */
export type LinkPhase = "off" | "waiting" | "searching" | "connecting" | "connected" | "sas" | "paired" | "error";

export interface LinkStatus {
  paired: boolean;
  phase: LinkPhase;
  connected: boolean;
  error?: string;
  /** The four digits during pairing. */
  sas?: string;
  /** This phone confirmed the digits; the other has not yet. */
  waitingForPeer?: boolean;
  me?: PartnerId;
  peerMe?: PartnerId;
  pairedAt?: string;
  lastSyncAt?: string;
  /** What the other phone held at the last exchange. */
  peerVector?: VersionVector;
}

export type SignalName = "date-on" | "date-off" | "break" | "break-ready" | "break-over";
export interface Signal { name: SignalName; data: Record<string, unknown> }

interface CouplePairPlugin {
  nearbyAllowed(): Promise<{ granted: boolean }>;
  askNearby(): Promise<{ granted: boolean }>;
  status(): Promise<LinkStatus>;
  startHost(options: { me: PartnerId; deviceId: string }): Promise<{ link: string; qr: string }>;
  startJoin(options: { link: string; deviceId: string }): Promise<{ ok: boolean }>;
  confirmSas(options: { same: boolean }): Promise<void>;
  cancelPairing(): Promise<void>;
  unpair(): Promise<void>;
  startSync(): Promise<{ started: boolean }>;
  stopSync(): Promise<void>;
  pushNow(): Promise<void>;
  sendSignal(options: { name: SignalName; data?: Record<string, unknown> }): Promise<{ sent: boolean }>;
  storeRead(options: { key: "events" }): Promise<{ text: string | null }>;
  storeWrite(options: { key: "events"; text: string | null }): Promise<void>;
  drainInbox(): Promise<{ events: string }>;
  scanQr(): Promise<{ text: string }>;
  openAppSettings(): Promise<void>;
  addListener(event: "state", handler: (status: LinkStatus) => void): Promise<PluginListenerHandle>;
  addListener(event: "inbox", handler: (info: { count: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: "signal", handler: (signal: Signal) => void): Promise<PluginListenerHandle>;
}

export const Pair = registerPlugin<CouplePairPlugin>("CouplePair");
export const linkAvailable = isNative;

export const NO_LINK: LinkStatus = { paired: false, phase: "off", connected: false };

export async function linkStatus(): Promise<LinkStatus> {
  if (!linkAvailable) return NO_LINK;
  try {
    return await Pair.status();
  } catch {
    return NO_LINK;
  }
}

/** Events that came from the other phone since the last call, emptied as they are read. */
export async function drainInbox(): Promise<LogEvent[]> {
  if (!linkAvailable) return [];
  try {
    const parsed = JSON.parse((await Pair.drainInbox()).events);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function sendSignal(name: SignalName, data: Record<string, unknown> = {}) {
  if (!linkAvailable) return false;
  try {
    return (await Pair.sendSignal({ name, data })).sent;
  } catch {
    return false;
  }
}

/** Whether the other phone already holds an event this phone wrote. */
export function delivered(status: LinkStatus, event: { deviceId: string; seq: number }) {
  return (status.peerVector?.[event.deviceId] ?? 0) >= event.seq;
}
