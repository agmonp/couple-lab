import { Activity, ClipboardCheck, FileText, HeartHandshake, ShieldCheck, Sparkles, Video } from "lucide-react";

export type View = "dashboard" | "assess" | "practice" | "insights" | "adviser" | "report" | "export";

export const navItems: { view: View; label: string; icon: typeof HeartHandshake }[] = [
  { view: "dashboard", label: "Dashboard", icon: HeartHandshake },
  { view: "assess", label: "Assess", icon: ClipboardCheck },
  { view: "practice", label: "Practice", icon: Video },
  { view: "insights", label: "Insights", icon: Activity },
  { view: "adviser", label: "Adviser", icon: Sparkles },
  { view: "report", label: "Report", icon: FileText },
  { view: "export", label: "Export", icon: ShieldCheck }
];

export function pageTitle(view: View) {
  const titles: Record<View, string> = {
    dashboard: "Relationship dashboard",
    assess: "Couple assessment",
    practice: "Practice Studio",
    insights: "Session insights",
    adviser: "Relationship Adviser",
    report: "Couple report",
    export: "Export & safety"
  };
  return titles[view];
}
