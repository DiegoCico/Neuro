// src/components/ProfileDropdown.tsx
import React, { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";

type Props = {
  name: string;
  subtitle?: string;
  onViewProfile: () => void;           // keep required
  onSettings?: () => void;
  onSignOut?: () => void;
  onTrigger?: () => void;            
};

type ThemeMode = "light" | "dark";

function getInitialTheme(): ThemeMode {
  try {
    const cached = localStorage.getItem("theme") as ThemeMode | null;
    if (cached === "light" || cached === "dark") return cached;
  } catch {}
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function applyTheme(t: ThemeMode) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem("theme", t);
  } catch {}
}

export default function ProfileDropdown({
  name,
  subtitle,
  onViewProfile,
  onSettings,
  onSignOut,
  onTrigger,                       // <-- NEW
}: Props) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme());
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t) && btnRef.current && !btnRef.current.contains(t)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function chooseTheme(next: ThemeMode) {
    setTheme(next);
    applyTheme(next);
  }

  return (
    <div className="pd-wrap" ref={menuRef}>
      <button
        ref={btnRef}
        type="button"
        className="pd-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          // 🔊 Fire the hook so Header can log token + user
          onTrigger?.();
          setOpen((v) => !v);
        }}
      >
        <Avatar name={name} size={32} />
      </button>

      {open && (
        <div className="pd-menu" role="menu" aria-label="Profile">
          <div className="pd-header">
            <div className="pd-name">{name}</div>
            {subtitle ? <div className="pd-subtitle">{subtitle}</div> : null}
            <button className="pd-primary" role="menuitem" onClick={onViewProfile}>
              View Profile
            </button>
          </div>

          <div className="pd-section">
            <div className="pd-title">Account</div>
            <button className="pd-item" role="menuitem" onClick={onSettings ?? (() => (window.location.href = "/settings"))}>
              Settings &amp; Privacy
            </button>
            <button className="pd-item" role="menuitem" onClick={() => alert("Help center")}>
              Help
            </button>
            <button className="pd-item" role="menuitem" onClick={() => alert("Language picker")}>
              Language
            </button>
          </div>

          <div className="pd-section">
            <div className="pd-title">Appearance</div>
            <div className="pd-appearance">
              <label className={`pd-chip ${theme === "light" ? "is-active" : ""}`}>
                <input
                  type="radio"
                  name="appearance"
                  value="light"
                  checked={theme === "light"}
                  onChange={() => chooseTheme("light")}
                />
                <span>Light</span>
              </label>
              <label className={`pd-chip ${theme === "dark" ? "is-active" : ""}`}>
                <input
                  type="radio"
                  name="appearance"
                  value="dark"
                  checked={theme === "dark"}
                  onChange={() => chooseTheme("dark")}
                />
                <span>Dark</span>
              </label>
            </div>
          </div>

          <div className="pd-section">
            <div className="pd-title">Manage</div>
            <button className="pd-item" role="menuitem" onClick={() => (window.location.href = "/posts")}>
              Posts &amp; Activity
            </button>
            <button className="pd-item" role="menuitem" onClick={() => (window.location.href = "/jobs/account")}>
              Job Posting Account
            </button>
          </div>

          <button className="pd-signout" role="menuitem" onClick={onSignOut ?? (() => alert("Sign out"))}>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
