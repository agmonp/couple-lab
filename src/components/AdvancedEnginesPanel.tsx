import { RefreshCw } from "lucide-react";
import { useState } from "react";

export const localEngineChecks = [
  {
    id: "mediapipe",
    label: "MediaPipe",
    detail: "Browser face/body",
    url: ""
  },
  {
    id: "whisper",
    label: "Whisper",
    detail: "Local transcript",
    url: "http://127.0.0.1:11435/health"
  },
  {
    id: "openface",
    label: "OpenFace",
    detail: "AU/gaze/emotion",
    url: "http://127.0.0.1:11436/health"
  },
  {
    id: "opensmile",
    label: "openSMILE",
    detail: "Voice stress",
    url: "http://127.0.0.1:11437/health"
  }
];

export function AdvancedEnginesPanel({ visualStatus }: { visualStatus: string }) {
  const [statuses, setStatuses] = useState<Record<string, "active" | "ready" | "offline" | "checking">>({
    mediapipe: "active"
  });

  const checkEngines = async () => {
    setStatuses((current) =>
      localEngineChecks.reduce<Record<string, "active" | "ready" | "offline" | "checking">>(
        (acc, engine) => ({
          ...acc,
          [engine.id]: engine.id === "mediapipe" ? "active" : "checking"
        }),
        current
      )
    );

    const results = await Promise.all(
      localEngineChecks.map(async (engine) => {
        if (!engine.url) return [engine.id, "active"] as const;
        try {
          const response = await fetch(engine.url, { method: "GET" });
          return [engine.id, response.ok ? "ready" : "offline"] as const;
        } catch {
          return [engine.id, "offline"] as const;
        }
      })
    );

    setStatuses(
      results.reduce<Record<string, "active" | "ready" | "offline" | "checking">>((acc, [id, status]) => ({ ...acc, [id]: status }), {})
    );
  };

  return (
    <div className="advanced-engines">
      <div className="mini-heading">
        <strong>Advanced signals</strong>
        <button className="text-button" onClick={checkEngines}>
          <RefreshCw size={14} />
          Check
        </button>
      </div>
      <div className="engine-grid">
        {localEngineChecks.map((engine) => {
          const status = statuses[engine.id] ?? "offline";
          return (
            <div className={`engine-card ${status}`} key={engine.id}>
              <span>{engine.label}</span>
              <small>{engine.id === "mediapipe" ? visualStatus : engine.detail}</small>
              <b>{status}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}
