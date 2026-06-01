"use client";

import { useEffect, useState } from "react";
import { IconMoonStars, IconSun } from "@tabler/icons-react";

type Theme = "light" | "dark";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current =
      (document.documentElement.getAttribute("data-theme") as Theme) || "light";
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("plain-theme", next);
    } catch {}
    setTheme(next);
  }

  const isDark = theme === "dark";

  return (
    <button
      className="glyph"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      type="button"
    >
      {theme === null ? null : isDark ? (
        <IconMoonStars aria-hidden="true" />
      ) : (
        <IconSun aria-hidden="true" />
      )}
    </button>
  );
}
