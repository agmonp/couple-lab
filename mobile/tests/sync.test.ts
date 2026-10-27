import { describe, expect, it } from "vitest";
import { EventLog } from "../src/core/events";
import { attachSync, createInMemoryPair } from "../src/core/transport";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("EventLog", () => {
  it("numbers events per device and never reuses an id", () => {
    const log = new EventLog("dev1");
    const a = log.append({ layer: "shared", author: "A", type: "x", payload: 1 });
    const b = log.append({ layer: "private", author: "B", type: "y", payload: 2 });
    expect([a.id, b.id]).toEqual(["dev1:1", "dev1:2"]);
    const reloaded = new EventLog("dev1", log.toJSON());
    expect(reloaded.append({ layer: "shared", author: "A", type: "z", payload: 3 }).id).toBe("dev1:3");
  });

  it("offers only shared events the other side lacks", () => {
    const log = new EventLog("dev1");
    log.append({ layer: "shared", author: "A", type: "x", payload: 1 });
    log.append({ layer: "private", author: "A", type: "secret", payload: "before reveal" });
    log.append({ layer: "shared", author: "A", type: "x", payload: 2 });
    expect(log.missingFor({}).map((e) => e.seq)).toEqual([1, 3]);
    expect(log.missingFor({ dev1: 1 }).map((e) => e.seq)).toEqual([3]);
  });

  it("refuses private events and events claiming to be its own", () => {
    const log = new EventLog("dev1");
    const added = log.merge([
      { id: "dev2:1", deviceId: "dev2", seq: 1, at: "2026-01-01T00:00:00Z", layer: "private", author: "B", type: "secret", payload: "x" },
      { id: "dev1:9", deviceId: "dev1", seq: 9, at: "2026-01-01T00:00:00Z", layer: "shared", author: "A", type: "forged", payload: "x" },
      { id: "dev2:2", deviceId: "dev2", seq: 2, at: "2026-01-01T00:00:00Z", layer: "shared", author: "B", type: "ok", payload: "x" }
    ]);
    expect(added).toBe(1);
    expect(log.all().map((e) => e.type)).toEqual(["ok"]);
  });
});

describe("sync over a Transport", () => {
  it("two devices converge on the shared layer; private never crosses", async () => {
    const one = new EventLog("phone-a");
    const two = new EventLog("phone-b");
    one.append({ layer: "private", author: "A", type: "answer-locked", payload: { text: "only mine" } });
    one.append({ layer: "shared", author: "A", type: "answer-revealed", payload: { text: "ours" } });
    two.append({ layer: "shared", author: "B", type: "jar-note", payload: { text: "thanks" } });
    two.append({ layer: "private", author: "B", type: "date-private-reflection", payload: { text: "kept" } });

    const [ta, tb] = createInMemoryPair();
    const sa = attachSync(one, ta);
    const sb = attachSync(two, tb);
    await sa.announce();
    await sb.announce();
    await flush();
    await flush();

    const sharedIds = (log: EventLog) => log.all().filter((e) => e.layer === "shared").map((e) => e.id).sort();
    expect(sharedIds(one)).toEqual(sharedIds(two));
    expect(sharedIds(one)).toHaveLength(2);
    const wire = JSON.stringify([...ta.sent, ...tb.sent]);
    expect(wire).not.toContain("only mine");
    expect(wire).not.toContain("kept");

    // Syncing again sends nothing new and changes nothing.
    const before = one.all().length;
    await sa.announce();
    await sb.announce();
    await flush();
    expect(one.all().length).toBe(before);
  });

  it("a closed transport refuses to send", async () => {
    const [ta] = createInMemoryPair();
    await ta.close();
    await expect(ta.send({ kind: "hello", deviceId: "x", vector: {} })).rejects.toThrow();
  });
});
