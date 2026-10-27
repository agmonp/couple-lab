import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AddressForm } from "@shared/deckForms";
import type { DepthLevel, PartnerId } from "@shared/types";
import { EventLog, type LogEvent, newDeviceId } from "./core/events";
import {
  type AppState,
  type DateFinished,
  type DatePrivateReflection,
  type StructuredFinished,
  dayKey,
  derive,
  isWelcomeBack
} from "./core/model";
import { pickDailyQuestion } from "./core/questions";
import { DAILY_ID, WEEKLY_ID, dailyNotificationText, weeklyStepText, weeklyStepTime } from "./core/reminders";
import { clearAll, loadValue, saveValue, scheduleDaily, scheduleOnce } from "./native/device";

/**
 * The app's one store: the event log (what happened), a few device settings
 * (how this phone behaves), and the state derived from the log. Every change
 * appends an event, saves, and re-derives. Nothing is sent anywhere.
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

const KEYS = { device: "cl.device", events: "cl.events", settings: "cl.settings" };

export interface Store {
  ready: boolean;
  state: AppState;
  settings: Settings;
  welcomeBack: boolean;
  setCouple(a: { name: string; form: AddressForm }, b: { name: string; form: AddressForm }): void;
  ensureToday(): void;
  chooseLighterToday(): void;
  lockAnswer(partner: PartnerId, text: string): void;
  revealToday(): void;
  finishDate(record: DateFinished, privateReflections: Partial<Record<PartnerId, DatePrivateReflection["reflection"]>>): void;
  finishStructured(record: StructuredFinished): void;
  writeJar(from: PartnerId, to: PartnerId, text: string): void;
  openJar(id: string, by: PartnerId): void;
  consentLayer(level: DepthLevel, partner: PartnerId): void;
  setWeeklyStep(text: string): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  eraseEverything(): Promise<void>;
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [log, setLog] = useState<EventLog | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [version, setVersion] = useState(0);
  const [welcomeBack, setWelcomeBack] = useState(false);
  const choseFor = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      let deviceId = await loadValue(KEYS.device);
      if (!deviceId) {
        deviceId = newDeviceId();
        await saveValue(KEYS.device, deviceId);
      }
      let events: LogEvent[] = [];
      try {
        events = JSON.parse((await loadValue(KEYS.events)) ?? "[]");
      } catch {
        events = [];
      }
      let saved: Partial<Settings> = {};
      try {
        saved = JSON.parse((await loadValue(KEYS.settings)) ?? "{}");
      } catch {
        saved = {};
      }
      const loaded = new EventLog(deviceId, events);
      setWelcomeBack(isWelcomeBack(derive(loaded)));
      setSettings({ ...DEFAULT_SETTINGS, ...saved });
      setLog(loaded);
    })();
  }, []);

  const state = useMemo(() => (log ? derive(log) : derive(new EventLog("loading"))), [log, version]);

  const store = useMemo<Store>(() => {
    const commit = (fn: (log: EventLog) => void) => {
      if (!log) return;
      fn(log);
      void saveValue(KEYS.events, JSON.stringify(log.toJSON()));
      setVersion((v) => v + 1);
      if (settings.notifyOn) {
        const { hour, minute } = parseTime(settings.notifyTime);
        void scheduleDaily(DAILY_ID, hour, minute, dailyNotificationText(derive(log))).catch(() => {});
      }
    };
    const today = () => dayKey();

    return {
      ready: log !== null,
      state,
      settings,
      welcomeBack,
      setCouple(a, b) {
        commit((l) => l.append({ layer: "shared", author: "A", type: "couple-set", payload: { A: a, B: b } }));
      },
      ensureToday() {
        if (state.days[today()]?.question || choseFor.current === today()) return;
        choseFor.current = today();
        const ref = pickDailyQuestion(state, { light: welcomeBack });
        commit((l) => l.append({ layer: "shared", author: "A", type: "daily-chosen", payload: { day: today(), ...ref } }));
      },
      chooseLighterToday() {
        const ref = pickDailyQuestion(state, { light: true });
        commit((l) => l.append({ layer: "shared", author: "A", type: "daily-chosen", payload: { day: today(), ...ref } }));
      },
      lockAnswer(partner, text) {
        commit((l) => l.append({ layer: "private", author: partner, type: "answer-locked", payload: { day: today(), text } }));
      },
      revealToday() {
        const d = state.days[today()];
        if (!d) return;
        commit((l) => {
          for (const partner of ["A", "B"] as PartnerId[]) {
            const text = d.locked[partner];
            if (text !== undefined && d.revealed[partner] === undefined) {
              l.append({ layer: "shared", author: partner, type: "answer-revealed", payload: { day: today(), text } });
            }
          }
        });
      },
      finishDate(record, privateReflections) {
        commit((l) => {
          for (const partner of ["A", "B"] as PartnerId[]) {
            const reflection = privateReflections[partner];
            if (reflection && (reflection.good || reflection.learned)) {
              l.append({ layer: "private", author: partner, type: "date-private-reflection", payload: { dateId: record.id, reflection } });
            }
          }
          l.append({ layer: "shared", author: "A", type: "date-finished", payload: record });
        });
      },
      finishStructured(record) {
        commit((l) => l.append({ layer: "shared", author: "A", type: "structured-finished", payload: record }));
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
      async setWeeklyStep(text) {
        const at = weeklyStepTime();
        commit((l) => l.append({ layer: "shared", author: "A", type: "weekly-step", payload: { text, remindAt: at.toISOString() } }));
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
      }
    };
  }, [log, state, settings, welcomeBack]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
