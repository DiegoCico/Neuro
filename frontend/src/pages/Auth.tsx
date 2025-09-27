// src/pages/Auth.tsx
import React, { useEffect, useState } from "react";
import "../css/Auth.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faShareNodes } from "@fortawesome/free-solid-svg-icons";
import { auth, googleProvider, githubProvider } from "../firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { useNavigate } from "react-router-dom";

const THEME_KEY = "neuro.theme";

function getInitialDark(): boolean {
  if (typeof window === "undefined") return false;
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark") return true;
  if (saved === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export default function Auth() {
  const navigate = useNavigate();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dark, setDark] = useState<boolean>(getInitialDark);

  // Apply & persist theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {}
  }, [dark]);

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        navigate("/home");
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
        // Optionally keep a local success state (useful if you also show it on /onboarding)
        setSuccess("Account created — finish setting up your profile.");
        // Go straight to onboarding. Keep the session active.
        navigate("/onboarding", { state: { email: email.trim() } });
      }
    } catch (err: any) {
      setError(err?.message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function withProvider(provider: "google" | "github") {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await signInWithPopup(auth, provider === "google" ? googleProvider : githubProvider);
      navigate("/home");
    } catch (err: any) {
      setError(err?.message ?? "Provider sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      {/* Theme toggle */}
      <button
        className={`theme-toggle ${dark ? "dark" : "light"}`}
        onClick={() => setDark((d) => !d)}
        type="button"
        aria-label="Toggle color theme"
      >
        <div className="toggle-icon" />
      </button>

      <div className="card">
        {/* Brand */}
        <div className="brand">
          <div className="logo-wrap">
            <FontAwesomeIcon icon={faShareNodes} className="brand-icon" />
          </div>
          <h1 className="brand-title">Neuro</h1>
          <p className="subtitle">Connect smarter.</p>
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={mode === "signin" ? "tab active" : "tab"}
            onClick={() => {
              setMode("signin");
              setError(null);
              setSuccess(null);
            }}
            type="button"
          >
            Sign in
          </button>
          <button
            className={mode === "signup" ? "tab active" : "tab"}
            onClick={() => {
              setMode("signup");
              setError(null);
              setSuccess(null);
            }}
            type="button"
          >
            Create account
          </button>
        </div>

        {/* Messages */}
        {success && (
          <div className="success" role="status">
            {success}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleEmailAuth} className="form">
          <label>
            <span>Email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@neuro.dev"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              required
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
            />
          </label>

          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        {/* Divider */}
        <div className="divider">
          <span>or</span>
        </div>

        {/* Providers */}
        <div className="providers">
          <button
            className="provider"
            onClick={() => withProvider("google")}
            disabled={busy}
            type="button"
          >
            Continue with Google
          </button>
          <button
            className="provider"
            onClick={() => withProvider("github")}
            disabled={busy}
            type="button"
          >
            Continue with GitHub
          </button>
        </div>

        <p className="fineprint">
          By continuing, you agree to Neuro’s Terms &amp; Privacy.
        </p>
      </div>
    </div>
  );
}
