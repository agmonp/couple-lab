import type { EventLog, LogEvent, VersionVector } from "./events";

/**
 * How two phones talk, whatever carries the bytes. Stage 2 adds a Nearby
 * Connections transport (Kotlin plugin) and later perhaps LAN (mDNS + TCP);
 * both encrypt with the pair key before `send`. Stage 1 ships only the
 * in-memory pair below, used by tests and by nothing on the phone yet.
 */
export type SyncMessage =
  | { kind: "hello"; deviceId: string; vector: VersionVector }
  | { kind: "events"; deviceId: string; events: LogEvent[] };

export interface Transport {
  readonly name: string;
  send(message: SyncMessage): Promise<void>;
  /** Returns an unsubscribe function. */
  onMessage(handler: (message: SyncMessage) => void): () => void;
  close(): Promise<void>;
}

class InMemoryTransport implements Transport {
  readonly name = "in-memory";
  peer?: InMemoryTransport;
  private handlers = new Set<(message: SyncMessage) => void>();
  private closed = false;
  /** Every message this end sent, for tests that check what left the device. */
  readonly sent: SyncMessage[] = [];

  async send(message: SyncMessage) {
    if (this.closed || !this.peer || this.peer.closed) throw new Error("transport closed");
    // A deep copy, like a real wire: the receiver cannot touch the sender's objects.
    const copy = JSON.parse(JSON.stringify(message)) as SyncMessage;
    this.sent.push(copy);
    const peer = this.peer;
    await Promise.resolve();
    peer.handlers.forEach((handler) => handler(copy));
  }

  onMessage(handler: (message: SyncMessage) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async close() {
    this.closed = true;
    this.handlers.clear();
  }
}

export function createInMemoryPair(): [InMemoryTransport, InMemoryTransport] {
  const a = new InMemoryTransport();
  const b = new InMemoryTransport();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/**
 * Keep one log in sync over a transport: announce what we have, answer the
 * other side's announcement with what it lacks, and merge what arrives.
 * `onMerged` fires when new events came in (so the UI can re-derive state).
 */
export function attachSync(log: EventLog, transport: Transport, onMerged: (added: number) => void = () => {}) {
  const unsubscribe = transport.onMessage((message) => {
    if (message.kind === "hello") {
      const events = log.missingFor(message.vector);
      if (events.length) void transport.send({ kind: "events", deviceId: log.deviceId, events });
    } else {
      const added = log.merge(message.events);
      if (added) onMerged(added);
    }
  });
  const announce = () => transport.send({ kind: "hello", deviceId: log.deviceId, vector: log.vector() });
  return { announce, detach: unsubscribe };
}
