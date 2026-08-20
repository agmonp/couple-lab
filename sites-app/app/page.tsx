"use client";

import { useEffect } from "react";
import App from "../../src/App";

export default function Home() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // The app remains usable online if service-worker registration is blocked.
      });
    }
  }, []);

  return <App />;
}
