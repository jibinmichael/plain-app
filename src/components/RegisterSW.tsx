"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker — production only, so dev never serves stale
 * cached assets. Failures are swallowed; the app works fine without it.
 */
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
