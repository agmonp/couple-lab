import { useEffect, useRef, useState } from "react";
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
import { PairScreen } from "./screens/Pair";
import { RemoteBreak } from "./screens/Break";
import { isNative, vibrate } from "./native/device";

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
  | { name: "safety" }
  | { name: "pair"; link?: string }
  /** The other phone called a break during a date. */
  | { name: "remote-break"; returnAt: number };

export type Go = (route: Route) => void;

const TABS: { route: Route["name"]; label: string }[] = [
  { route: "home", label: "הערב שלנו" },
  { route: "ours", label: "שלנו" },
  { route: "more", label: "עוד" }
];

const PAIR_LINK = /^couplelab:\/\/pair\?/;

export function App() {
  const store = useStore();
  const [route, setRoute] = useState<Route>({ name: "home" });
  const routeRef = useRef(route);
  routeRef.current = route;
  const go: Go = (next) => {
    setRoute(next);
    window.scrollTo(0, 0);
  };

  // Android back: go home from anywhere, leave the app from home.
  useEffect(() => {
    if (!isNative) return;
    const sub = CapApp.addListener("backButton", () => {
      if (route.name === "home") void CapApp.minimizeApp();
      else if (route.name === "names" || route.name === "privacy" || route.name === "safety" || route.name === "practice" || route.name === "pair") go({ name: "more" });
      else if (route.name === "remote-break") return;
      else go({ name: "home" });
    });
    return () => void sub.then((s) => s.remove());
  }, [route.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // A pairing QR read by the phone's camera opens the app with the link.
  useEffect(() => {
    if (!isNative) return;
    void CapApp.getLaunchUrl().then((launch) => {
      if (launch?.url && PAIR_LINK.test(launch.url)) go({ name: "pair", link: launch.url });
    });
    const sub = CapApp.addListener("appUrlOpen", ({ url }) => {
      if (PAIR_LINK.test(url)) go({ name: "pair", link: url });
    });
    return () => void sub.then((s) => s.remove());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A break called on the other phone reaches this one wherever it is (the date screen handles its own).
  useEffect(
    () =>
      store.onSignal((signal) => {
        if (signal.name !== "break" || routeRef.current.name === "date" || routeRef.current.name === "remote-break") return;
        void vibrate("breakStart");
        go({ name: "remote-break", returnAt: Number(signal.data.returnAt) || Date.now() + 20 * 60 * 1000 });
      }),
    [store.onSignal] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!store.ready) return null;
  if (!store.state.couple) {
    if (route.name === "pair" || store.link.paired) return <PairScreen onBack={() => go({ name: "home" })} initialLink={route.name === "pair" ? route.link : undefined} />;
    return <Onboarding onJoin={isNative ? () => go({ name: "pair" }) : undefined} />;
  }

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
    case "pair": screen = <PairScreen onBack={() => go({ name: "more" })} initialLink={route.link} />; break;
    case "remote-break": screen = <RemoteBreak returnAt={route.returnAt} onDone={() => go({ name: "home" })} />; break;
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
