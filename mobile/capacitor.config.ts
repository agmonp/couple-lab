import type { CapacitorConfig } from "@capacitor/cli";

// The package id is still an open decision (docs/ANDROID_APP_PLAN.md §8).
const config: CapacitorConfig = {
  appId: "com.couplelab.app",
  appName: "Couple Lab",
  webDir: "dist",
  android: { backgroundColor: "#faf6ee" },
  plugins: {
    LocalNotifications: { smallIcon: "ic_stat_couple", iconColor: "#184a4c" }
  }
};

export default config;
