import type { Metadata, Viewport } from "next";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";

// Apercu Pro (self-hosted, see @font-face in globals.css) with a system-sans
// fallback, so it renders everywhere and degrades cleanly if the font fails to
// load. Wired to --font-mono, which every surface already reads, so the whole
// app (editor, sidebar, command field, notes, graph) switches.
const fontStack =
  '"Apercu Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const metadata: Metadata = {
  title: "plain",
  description:
    "A grounded markdown note editor. The assistant only completes facts that already exist in your sources.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "plain",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff", // light is the only theme (white/ink)
};

// Light is the only theme — set it before first paint, never switch to dark.
const themeScript = `document.documentElement.setAttribute("data-theme","light");`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      style={{ ["--font-mono" as string]: fontStack }}
      suppressHydrationWarning
      translate="no"
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
