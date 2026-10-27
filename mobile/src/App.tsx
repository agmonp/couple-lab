import { useEffect, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import type { StructuredSessionKind } from "@shared/types";
import { useStore } from "./store";
import { Onboarding } from "./screens/Onboarding";
import { Home } from "./screens/Home";
import { Daily } from "./screens/Daily";
import { DateMode } from "./screens/DateMode";
import { Structured } from "./screens/Structured";
import { Ours } from "./screens/Ours";
import { More, NamesScreen, PracticeScreen, PrivacyScreen, SafetyScreen } from "./screens/More";
import { isNative } from "./native/device";

export type Route =
  | { name: "home" }
  | { name: "daily" }
  | { name: "date" }
  | { name: "structured"; kind: StructuredSessionKind }
  | { name: "ours" }
  | { name: "more" }
  | { name: "practice" }
  | { name: "names" }
  | { name: "privacy" }
  | { name: "safety" };

export type Go = (route: Route) => void;

const TABS: { route: Route["name"]; label: string }[] = [
  { route: "home", label: "הערב שלנו" },
  { route: "ours", label: "שלנו" },
  { route: "more", label: "עוד" }
];

export function App() {
  const store = useStore();
  const [route, setRoute] = useState<Route>({ name: "home" });
  const go: Go = (next) => {
    setRoute(next);
    window.scrollTo(0, 0);
  };

  // Android back: go home from anywhere, leave the app from home.
  useEffect(() => {
    if (!isNative) return;
    const sub = CapApp.addListener("backButton", () => {
      if (route.name === "home") void CapApp.minimizeApp();
      else if (route.name === "names" || route.name === "privacy" || route.name === "safety" || route.name === "practice") go({ name: "more" });
      else go({ name: "home" });
    });
    return () => void sub.then((s) => s.remove());
  }, [route.name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!store.ready) return null;
  if (!store.state.couple) return <Onboarding />;

  const tabbed = route.name === "home" || route.name === "ours" || route.name === "more";
  let screen;
  switch (route.name) {
    case "home": screen = <Home go={go} />; break;
    case "daily": screen = <Daily go={go} />; break;
    case "date": screen = <DateMode go={go} />; break;
    case "structured": screen = <Structured go={go} kind={route.kind} />; break;
    case "ours": screen = <Ours go={go} />; break;
    case "more": screen = <More go={go} />; break;
    case "practice": screen = <PracticeScreen go={go} />; break;
    case "names": screen = <NamesScreen go={go} />; break;
    case "privacy": screen = <PrivacyScreen go={go} />; break;
    case "safety": screen = <SafetyScreen go={go} />; break;
  }

  return (
    <div className="app-shell">
      <main>{screen}</main>
      {tabbed && (
        <nav className="tabs" aria-label="ניווט">
          {TABS.map((tab) => (
            <button key={tab.route} aria-current={route.name === tab.route ? "page" : undefined} onClick={() => go({ name: tab.route } as Route)}>
              {tab.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
