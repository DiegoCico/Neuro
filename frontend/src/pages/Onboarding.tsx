// Adds fields the profile actually shows (headline/location/bio) and seeds stats

import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";
import { onAuthStateChanged } from "firebase/auth";

export default function Onboarding() {
  const navigate = useNavigate();
  const loc = useLocation() as any;
  const prefillEmail = loc?.state?.email ?? "";

  const [userReady, setUserReady] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [headline, setHeadline] = useState("");
  const [dob, setDob] = useState("");
  const [occupation, setOccupation] = useState("");
  const [school, setSchool] = useState("");
  const [email, setEmail] = useState(prefillEmail);
  const [locationVal, setLocationVal] = useState("");
  const [website, setWebsite] = useState("");
  const [bio, setBio] = useState("");
  const [interests, setInterests] = useState<string>("");
  const [allowConnect, setAllowConnect] = useState(true);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        navigate("/auth");
      } else {
        setUid(u.uid);
        if (!email) setEmail(u.email ?? "");
        setUserReady(true);
      }
    });
    return () => unsub();
  }, [navigate, email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid) return;
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        uid,
        email: email.trim(),
        fullName: fullName.trim(),
        headline: headline.trim() || null,              // ← used on Profile
        dateOfBirth: dob || null,
        occupation: occupation.trim() || null,
        school: school.trim() || null,
        location: locationVal.trim() || null,          // ← used on Profile
        website: website.trim() || null,
        bio: bio.trim() || null,                       // ← used on Profile
        interests: interests
          ? interests.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        allowConnect,
        onboardingCompleted: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "users", uid), payload, { merge: true });
      navigate("/home");
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  if (!userReady) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <div>Loading…</div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="card" style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Set up your profile</h2>
        <p className="subtitle" style={{ marginTop: 4 }}>
          Tell us a bit about you. You can edit this later in Settings.
        </p>

        {err && <div className="error" role="alert">{err}</div>}

        <form className="form" onSubmit={handleSubmit}>
          <label>
            <span>Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>

          <label>
            <span>Headline</span>
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="SDE Intern @ Amazon · Northeastern ’26"
            />
          </label>

          <label>
            <span>Date of birth</span>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </label>

          <label>
            <span>Occupation</span>
            <input value={occupation} onChange={(e) => setOccupation(e.target.value)} placeholder="Software Engineer" />
          </label>

          <label>
            <span>School</span>
            <input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="Northeastern University" />
          </label>

          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>

          <label>
            <span>Location</span>
            <input value={locationVal} onChange={(e) => setLocationVal(e.target.value)} placeholder="Boston, MA" />
          </label>

          <label>
            <span>Website</span>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
          </label>

          <label>
            <span>Short bio</span>
            <input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line about you" />
          </label>

          <label>
            <span>Interests (comma-separated)</span>
            <input value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="AI, Databases, Snowboarding" />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="checkbox"
              checked={allowConnect}
              onChange={(e) => setAllowConnect(e.target.checked)}
            />
            <span>Allow others to connect with me</span>
          </label>

          <button className="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
