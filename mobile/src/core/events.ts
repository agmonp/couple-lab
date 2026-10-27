import type { PartnerId } from "@shared/types";

/**
 * The data model the two-phone version will sync (docs/ANDROID_APP_PLAN.md §3.3–3.4).
 *
 * Every device keeps its own append-only log. An event is never edited, so two
 * devices can never conflict: syncing is "send what the other is missing".
 *
 * Layers:
 * - "private" (שלי): an answer before reveal, a reflection kept to oneself.
 *   Never leaves the device; `missingFor` and `merge` both enforce it.
 * - "shared"  (שלנו): only after an explicit act (reveal, send, finish together).
 * Personalisation (which question to suggest, when to remind) is computed on the
 * device from these events and is not an event itself.
 */

export type Layer = "private" | "shared";

export interface LogEvent<P = unknown> {
  /** `${deviceId}:${seq}` — unique across both devices. */
  id: string;
  deviceId: string;
  /** 1, 2, 3… per device, in the order that device wrote them. */
  seq: number;
  /** ISO time on the writing device; used for display order only. */
  at: string;
  layer: Layer;
  /** Which partner the event belongs to (one phone holds both). */
  author: PartnerId;
  type: string;
  payload: P;
}

export type VersionVector = Record<string, number>;

export interface NewEvent<P = unknown> {
  layer: Layer;
  author: PartnerId;
  type: string;
  payload: P;
  at?: string;
}

export class EventLog {
  readonly deviceId: string;
  private events: LogEvent[] = [];
  private ids = new Set<string>();

  constructor(deviceId: string, events: LogEvent[] = []) {
    this.deviceId = deviceId;
    for (const event of events) this.insert(event);
  }

  private insert(event: LogEvent) {
    if (this.ids.has(event.id)) return false;
    this.ids.add(event.id);
    this.events.push(event);
    return true;
  }

  private nextSeq() {
    let max = 0;
    for (const event of this.events) if (event.deviceId === this.deviceId && event.seq > max) max = event.seq;
    return max + 1;
  }

  append<P>(input: NewEvent<P>): LogEvent<P> {
    const seq = this.nextSeq();
    const event: LogEvent<P> = {
      id: `${this.deviceId}:${seq}`,
      deviceId: this.deviceId,
      seq,
      at: input.at ?? new Date().toISOString(),
      layer: input.layer,
      author: input.author,
      type: input.type,
      payload: input.payload
    };
    this.insert(event);
    return event;
  }

  /** All events in a stable display order (time, then device, then seq). */
  all(): LogEvent[] {
    return [...this.events].sort((a, b) =>
      a.at === b.at ? (a.deviceId === b.deviceId ? a.seq - b.seq : a.deviceId < b.deviceId ? -1 : 1) : a.at < b.at ? -1 : 1
    );
  }

  ofType<P>(type: string): LogEvent<P>[] {
    return this.all().filter((event) => event.type === type) as LogEvent<P>[];
  }

  /** The highest seq this log holds from each device. */
  vector(): VersionVector {
    const vector: VersionVector = {};
    for (const event of this.events) vector[event.deviceId] = Math.max(vector[event.deviceId] ?? 0, event.seq);
    return vector;
  }

  /** Shared events the holder of `remote` has not seen. Private events never qualify. */
  missingFor(remote: VersionVector): LogEvent[] {
    return this.all().filter((event) => event.layer === "shared" && event.seq > (remote[event.deviceId] ?? 0));
  }

  /**
   * Take in events from the other device. Ignores duplicates, anything claiming
   * to be written by this device, and anything private (which must never arrive).
   * Returns how many were new.
   */
  merge(incoming: LogEvent[]): number {
    let added = 0;
    for (const event of incoming) {
      if (event.deviceId === this.deviceId || event.layer !== "shared") continue;
      if (this.insert(event)) added++;
    }
    return added;
  }

  toJSON(): LogEvent[] {
    return this.all();
  }
}

export function newDeviceId(random = Math.random) {
  return Array.from({ length: 12 }, () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(random() * 32)]).join("");
}
