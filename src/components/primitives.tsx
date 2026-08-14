import { Check } from "lucide-react";
import { clamp } from "../lib/utils";

export function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className="progress">
      <span>
        {label}
        <b>{value}%</b>
      </span>
      <div>
        <i style={{ width: `${clamp(value, 0, 100)}%` }} />
      </div>
    </div>
  );
}

export function MiniMetric({
  label,
  value,
  invert,
  raw
}: {
  label: string;
  value: number;
  invert?: boolean;
  raw?: boolean;
}) {
  const colorValue = raw ? Math.min(100, value * 10) : value;
  return (
    <div className="mini-metric">
      <span>{label}</span>
      <strong>{raw ? value : `${value}%`}</strong>
      <div className={invert ? "invert" : ""}>
        <i style={{ width: `${clamp(colorValue, 3, 100)}%` }} />
      </div>
    </div>
  );
}

export function InsightList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        <Check size={18} />
      </div>
      <ul className="plain-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
