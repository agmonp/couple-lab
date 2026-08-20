import type { Metadata } from "next";
import { headers } from "next/headers";
import "../../src/styles.css";
import "../../src/design-overrides.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "Couple Lab — מרחב לשיחה זוגית",
    description: "מרחב פרטי לתרגול שיחה זוגית, התבוננות משותפת ודוח מסכם לא-קליני.",
    manifest: "/manifest.webmanifest",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Couple Lab",
      description: "מתרגלים שיחה. לומדים יחד.",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Couple Lab" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Couple Lab",
      description: "מתרגלים שיחה. לומדים יחד.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
