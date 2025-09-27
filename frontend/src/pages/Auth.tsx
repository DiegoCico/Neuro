import React, { useState } from "react";
import "../css/Auth.css";
import { auth, googleProvider, githubProvider } from "../firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";

export default function Auth() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
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
    try {
      if (provider === "google") {
        await signInWithPopup(auth, googleProvider);
      } else {
        await signInWithPopup(auth, githubProvider);
      }
    } catch (err: any) {
      setError(err?.message ?? "Provider sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="card">
        <div className="brand">
          <div className="logo">N</div>
          <h1>Neuro</h1>
          <p className="subtitle">Connect smarter.</p>
        </div>

        <div className="tabs">
          <button
            className={mode === "signin" ? "tab active" : "tab"}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            className={mode === "signup" ? "tab active" : "tab"}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
        </div>

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

          {error && <div className="error">{error}</div>}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="divider">
          <span>or</span>
        </div>

        <div className="providers">
          <button className="provider" onClick={() => withProvider("google")} disabled={busy}>
            Continue with Google
          </button>
          <button className="provider" onClick={() => withProvider("github")} disabled={busy}>
            Continue with GitHub
          </button>
        </div>

        <p className="fineprint">
          By continuing, you agree to Neuro’s Terms & Privacy.
        </p>
      </div>
    </div>
  );
}
