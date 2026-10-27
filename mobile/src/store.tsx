import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App as CapApp } from "@capacitor/app";
import type { AddressForm } from "@shared/deckForms";
import type { DepthLevel, PartnerId } from "@shared/types";
import { EventLog, type LogEvent, newDeviceId } from "./core/events";
import {
  type AppState,
  type DateFinished,
  type DatePrivateReflection,
  type StructuredFinished,
  answered,
  dayKey,
  derive,
  isWelcomeBack
} from "./core/model";
import { pickDailyQuestion, seededRandom } from "./core/questions";
import { type MapScores, activeRound, mapDone } from "./core/relationshipMap";
import { DAILY_ID, WEEKLY_ID, dailyNotificationText, weeklyStepText, weeklyStepTime } from "./core/reminders";
import { clearAll, loadEvents, loadValue, saveEvents, saveValue, scheduleDaily, scheduleOnce } from "./native/device";
import { type LinkStatus, type Signal, NO_LINK, Pair, drainInbox, linkAvailable, linkStatus } from "./native/pair";

/**
 * The app's one store: the event log (what happened), a few device settings
 * (how this phone behaves), and the state derived from the log. Every change
 * appends an event, saves, and re-derives.
 *
 * With two paired phones (stage 2) each phone writes only for its own person
 * (`me`). Shared events go to the other phone when the two are close; private
 * ones never leave. Arrivals come through the native inbox and are merged with
 * `EventLog.merge`, which refuses anything private or claiming to be ours.
 */
export interface Settings {
  notifyOn: boolean;
  /** "HH:MM" */
  notifyTime: string;
  dndOnDates: boolean;
  hapticsPracticed: boolean;
  /** Day on which the "go deeper?" offer was put off. */
  deeperLaterOn?: string;
}

const DEFAULT_SETTINGS: Settings = { notifyOn: false, notifyTime: "20:30", dndOnDates: false, hapticsPracticed: false };

const KEYS = { device: "cl.device", settings: "cl.settings" };

export interface Store {
  ready: boolean;
  state: AppState;
  settings: Settings;
  welcomeBack: boolean;
  /** The two-phone link; `paired` false on a single phone. */
  link: LinkStatus;
  /** Who holds this phone, once paired. Undefined on a shared single phone. */
  me?: PartnerId;
  /** The other phone is running a date right now. */
  peerDateOn: boolean;
  setCouple(a: { name: string; form: AddressForm }, b: { name: string; form: AddressForm }): void;
  ensureToday(): void;
  chooseLighterToday(): void;
  lockAnswer(partner: PartnerId, text: string, guess?: string): void;
  /** One phone: both said yes on this screen. */
  revealToday(): void;
  /** Two phones: this phone's person agrees; the answers open once both did. */
  consentReveal(): void;
  finishDate(record: DateFinished, privateReflections: Partial<Record<PartnerId, DatePrivateReflection["reflection"]>>): void;
  finishStructured(record: StructuredFinished): void;
  writeJar(from: PartnerId, to: PartnerId, text: string): void;
  openJar(id: string, by: PartnerId): void;
  consentLayer(level: DepthLevel, partner: PartnerId): void;
  /** Saves one partner's relationship map, closed. `safety` (private) are the ticked safety concerns. */
  lockMap(partner: PartnerId, scores: MapScores, safety: string[]): void;
  /** One phone: both said yes on this screen. */
  revealMap(): void;
  /** Two phones: this phone's person agrees; the maps open once both did. */
  consentMap(): void;
  setWeeklyStep(text: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  eraseEverything(): Promise<void>;
  // Two phones
  askNearby(): Promise<boolean>;
  hostPairing(me: PartnerId): Promise<{ link: string; qr: string }>;
  /** Starts joining from a scanned link. A phone joining a pair starts from the inviter's history. */
  joinPairing(link: string): Promise<boolean>;
  confirmSas(same: boolean): Promise<void>;
  cancelPairing(): Promise<void>;
  unpair(): Promise<void>;
  syncNow(): Promise<void>;
  onSignal(handler: (signal: Signal) => void): () => void;
}

const StoreContext = createContext<Store | null>(null);

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore outside StoreProvider");
  return store;
}

function parseTime(time: string) {
  const [h, m] = time.split(":").map((n) => Number(n));
  return { hour: Number.isFinite(h) ? h : 20, minute: Number.isFinite(m) ? m : 30 };
}

function parseEvents(text: string | null): LogEvent[] {
  try {
    const parsed = JSON.parse(text ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [log, setLog] = useState<EventLog | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [version, setVersion] = useState(0);
  const [welcomeBack, setWelcomeBack] = useState(false);
  const [link, setLink] = useState<LinkStatus>(NO_LINK);
  const [peerDateOn, setPeerDateOn] = useState(false);
  const choseFor = useRef<string | null>(null);
  const logRef = useRef<EventLog | null>(null);
  const signalHandlers = useRef(new Set<(signal: Signal) => void>());
  logRef.current = log;

  const persist = (l: EventLog) => saveEvents(JSON.stringify(l.toJSON())).catch(() => {});

  /** Merge what the other phone sent while we were not looking. */
  const absorb = async () => {
    const l = logRef.current;
    if (!l) return;
    const incoming = await drainInbox();
    if (incoming.length && l.merge(incoming) > 0) {
      await persist(l);
      setVersion((v) => v + 1);
    }
  };

  useEffect(() => {
    void (async () => {
      let deviceId = await loadValue(KEYS.device);
      if (!deviceId) {
        deviceId = newDeviceId();
        await saveValue(KEYS.device, deviceId);
      }
      const events = parseEvents(await loadEvents().catch(() => null));
      let saved: Partial<Settings> = {};
      try {
        saved = JSON.parse((await loadValue(KEYS.settings)) ?? "{}");
      } catch {
        saved = {};
      }
      const loaded = new EventLog(deviceId, events);
      const arrived = await drainInbox();
      if (arrived.length && loaded.merge(arrived) > 0) await saveEvents(JSON.stringify(loaded.toJSON())).catch(() => {});
      setWelcomeBack(isWelcomeBack(derive(loaded)));
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
      logRef.current = loaded;
      setLog(loaded);
      const status = await linkStatus();
      setLink(status);
      if (status.paired && (await Pair.nearbyAllowed().catch(() => ({ granted: false }))).granted) await Pair.startSync().catch(() => {});
    })();
  }, []);

  useEffect(() => {
    if (!linkAvailable) return;
    const subs = [
      Pair.addListener("state", (status) => {
        setLink(status);
        if (!status.connected) setPeerDateOn(false);
      }),
      Pair.addListener("inbox", () => void absorb()),
      Pair.addListener("signal", (signal) => {
        if (signal.name === "date-on") setPeerDateOn(true);
        if (signal.name === "date-off") setPeerDateOn(false);
        signalHandlers.current.forEach((handler) => handler(signal));
      }),
      CapApp.addListener("resume", () => {
        void absorb();
        void linkStatus().then(setLink);
      })
    ];
    return () => subs.forEach((sub) => void sub.then((s) => s.remove()));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const state = useMemo(() => (log ? derive(log) : derive(new EventLog("loading"))), [log, version]);
  const me = link.paired ? link.me : undefined;

  const store = useMemo<Store>(() => {
    const commit = (fn: (log: EventLog) => void) => {
      if (!log) return;
      fn(log);
      void persist(log).then(() => {
        if (link.paired) void Pair.pushNow().catch(() => {});
      });
      setVersion((v) => v + 1);
      if (settings.notifyOn) {
        const { hour, minute } = parseTime(settings.notifyTime);
        void scheduleDaily(DAILY_ID, hour, minute, dailyNotificationText(derive(log))).catch(() => {});
      }
    };
    const today = () => dayKey();
    // Paired phones draw the same question for the same day.
    const random = (salt: string) => (link.paired ? seededRandom(`${link.pairedAt}|${today()}|${salt}`) : Math.random);

    return {
      ready: log !== null,
      state,
      settings,
      welcomeBack,
      link,
      me,
      peerDateOn,
      setCouple(a, b) {
        commit((l) => l.append({ layer: "shared", author: me ?? "A", type: "couple-set", payload: { A: a, B: b } }));
      },
      ensureToday() {
        if (state.days[today()]?.question || choseFor.current === today()) return;
        choseFor.current = today();
        const ref = pickDailyQuestion(state, { light: welcomeBack, random: random("daily") });
        commit((l) => l.append({ layer: "shared", author: me ?? "A", type: "daily-chosen", payload: { day: today(), ...ref } }));
      },
      chooseLighterToday() {
        const ref = pickDailyQuestion(state, { light: true, random: random("light") });
        commit((l) => l.append({ layer: "shared", author: me ?? "A", type: "daily-chosen", payload: { day: today(), ...ref } }));
      },
      lockAnswer(partner, text, guess) {
        const question = state.days[today()]?.question;
        commit((l) => {
          l.append({ layer: "private", author: partner, type: "answer-locked", payload: { day: today(), text, guess: guess || undefined, question } });
          // The other phone learns only that an answer exists.
          if (me) l.append({ layer: "shared", author: partner, type: "answer-ready", payload: { day: today(), question } });
        });
      },
      revealToday() {
        const d = state.days[today()];
        if (!d) return;
        commit((l) => {
          for (const partner of ["A", "B"] as PartnerId[]) {
            const text = d.locked[partner];
            if (text !== undefined && d.revealed[partner] === undefined) {
              l.append({ layer: "shared", author: partner, type: "answer-revealed", payload: { day: today(), text, guess: d.lockedGuess[partner], question: d.asked[partner] } });
            }
          }
        });
      },
      consentReveal() {
        if (!me || state.days[today()]?.consent[me]) return;
        commit((l) => l.append({ layer: "shared", author: me, type: "reveal-consent", payload: { day: today() } }));
      },
      finishDate(record, privateReflections) {
        commit((l) => {
          for (const partner of ["A", "B"] as PartnerId[]) {
            const reflection = privateReflections[partner];
            if (reflection && (reflection.good || reflection.learned)) {
              l.append({ layer: "private", author: partner, type: "date-private-reflection", payload: { dateId: record.id, reflection } });
            }
          }
          l.append({ layer: "shared", author: me ?? "A", type: "date-finished", payload: record });
        });
      },
      finishStructured(record) {
        commit((l) => l.append({ layer: "shared", author: me ?? "A", type: "structured-finished", payload: record }));
      },
      writeJar(from, to, text) {
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        commit((l) => l.append({ layer: "shared", author: from, type: "jar-note", payload: { id, to, text } }));
      },
      openJar(id, by) {
        commit((l) => l.append({ layer: "shared", author: by, type: "jar-opened", payload: { id } }));
      },
      consentLayer(level, partner) {
        commit((l) => l.append({ layer: "shared", author: partner, type: "layer-consent", payload: { level } }));
      },
      lockMap(partner, scores, safety) {
        const { round } = activeRound(state);
        commit((l) => {
          l.append({ layer: "private", author: partner, type: "map-locked", payload: { round, scores } });
          if (safety.length) l.append({ layer: "private", author: partner, type: "safety-check", payload: { round, flags: safety } });
          if (me) l.append({ layer: "shared", author: partner, type: "map-ready", payload: { round } });
        });
      },
      revealMap() {
        const r = activeRound(state);
        commit((l) => {
          for (const partner of ["A", "B"] as PartnerId[]) {
            const scores = r.locked[partner];
            if (scores && r.revealed[partner] === undefined) l.append({ layer: "shared", author: partner, type: "map-revealed", payload: { round: r.round, scores } });
          }
        });
      },
      consentMap() {
        const r = activeRound(state);
        if (!me || r.consent[me]) return;
        commit((l) => l.append({ layer: "shared", author: me, type: "map-consent", payload: { round: r.round } }));
      },
      async setWeeklyStep(text) {
        const at = weeklyStepTime();
        commit((l) => l.append({ layer: "shared", author: me ?? "A", type: "weekly-step", payload: { text, remindAt: at.toISOString() } }));
        await scheduleOnce(WEEKLY_ID, at, weeklyStepText(text)).catch(() => {});
      },
      async updateSettings(patch) {
        const next = { ...settings, ...patch };
        setSettings(next);
        await saveValue(KEYS.settings, JSON.stringify(next));
        if (next.notifyOn && log) {
          const { hour, minute } = parseTime(next.notifyTime);
          await scheduleDaily(DAILY_ID, hour, minute, dailyNotificationText(derive(log))).catch(() => {});
        }
      },
      async eraseEverything() {
        await clearAll();
        window.location.reload();
      },
      async askNearby() {
        if (!linkAvailable) return false;
        return (await Pair.askNearby()).granted;
      },
      async hostPairing(partner) {
        return Pair.startHost({ me: partner, deviceId: log!.deviceId });
      },
      async joinPairing(text) {
        if (!log) return false;
        if (log.all().length) {
          // This phone takes the inviter's history; what it held alone is cleared first.
          const fresh = new EventLog(log.deviceId, []);
          await persist(fresh);
          logRef.current = fresh;
          setLog(fresh);
        }
        return (await Pair.startJoin({ link: text, deviceId: log.deviceId })).ok;
      },
      async confirmSas(same) {
        await Pair.confirmSas({ same });
      },
      async cancelPairing() {
        await Pair.cancelPairing();
      },
      async unpair() {
        await Pair.unpair();
        setLink(await linkStatus());
      },
      async syncNow() {
        await Pair.startSync().catch(() => {});
        await Pair.pushNow().catch(() => {});
        setLink(await linkStatus());
      },
      onSignal(handler) {
        signalHandlers.current.add(handler);
        return () => signalHandlers.current.delete(handler);
      }
    };
  }, [log, state, settings, welcomeBack, link, me, peerDateOn]);

  // Two phones: once both agreed, this phone opens its own person's answer (and map). The
  // other phone does the same with its own, so the texts cross only after both said yes.
  useEffect(() => {
    if (!me || !log) return;
    const due = Object.values(state.days).filter(
      (d) => d.consent.A && d.consent.B && d.locked[me] !== undefined && d.revealed[me] === undefined && answered(d, "A") && answered(d, "B")
    );
    const dueMaps = Object.values(state.maps).filter(
      (r) => r.consent.A && r.consent.B && r.locked[me] !== undefined && r.revealed[me] === undefined && mapDone(r, "A") && mapDone(r, "B")
    );
    if (!due.length && !dueMaps.length) return;
    for (const d of due) {
      log.append({ layer: "shared", author: me, type: "answer-revealed", payload: { day: d.day, text: d.locked[me], guess: d.lockedGuess[me], question: d.asked[me] } });
    }
    for (const r of dueMaps) log.append({ layer: "shared", author: me, type: "map-revealed", payload: { round: r.round, scores: r.locked[me] } });
    void persist(log).then(() => void Pair.pushNow().catch(() => {}));
    setVersion((v) => v + 1);
  }, [state, me, log]); // eslint-disable-line react-hooks/exhaustive-deps

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
