// src/pages/ProfilePage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import "../css/ProfilePage.css";

/** Replace these with your real data calls */
async function fetchMe(): Promise<{
  id: string;
  firstName: string;
  lastName?: string;
  headline?: string;
  location?: string;
  avatarUrl?: string;
  stats?: { connections: number; followers: number; views: number };
}> {
  // Minimal mock. If you already have fetchUserNames(), merge here.
  return {
    id: "me-001",
    firstName: "Diego",
    lastName: "Cicotoste",
    headline: "SDE Intern @ Amazon AWS 2x / Northeastern ’26",
    location: "Boston, MA",
    avatarUrl: undefined,
    stats: { connections: 512, followers: 1_240, views: 3850 },
  };
}

/** ---- slug utils ---- */
function kebabName(first: string, last?: string) {
  const full = [first, last].filter(Boolean).join(" ").trim();
  return full
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function ensureFiveDigitCode(seedKey: string): string {
  // Stable per user: cache in localStorage. If missing, create once.
  const k = `userCode:${seedKey}`;
  try {
    const existing = localStorage.getItem(k);
    if (existing && /^\d{5}$/.test(existing)) return existing;
    const code = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
    localStorage.setItem(k, code);
    return code;
  } catch {
    // Fallback if localStorage blocked
    return String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  }
}

function makeProfileSlug(first: string, last: string | undefined, userId: string) {
  const namePart = kebabName(first, last || "");
  const code = ensureFiveDigitCode(userId || `${first}-${last || ""}`);
  return `${namePart}-${code}`;
}

function parseSlug(slug: string | undefined) {
  if (!slug) return null;
  const m = slug.match(/^(.*)-(\d{5})$/);
  if (!m) return null;
  const namePart = m[1];
  const code = m[2];
  return { namePart, code };
}

/** ---- small avatar pill ---- */
function AvatarCircle({ name, src, size = 96 }: { name: string; src?: string; size?: number }) {
  const initials = useMemo(() => {
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] || "U") + (parts[1]?.[0] || "");
  }, [name]);

  return src ? (
    <img className="vp-avatar" style={{ width: size, height: size }} src={src} alt={name} />
  ) : (
    <div className="vp-avatar" style={{ width: size, height: size }}>
      {initials.toUpperCase()}
    </div>
  );
}

/** ---- main page ---- */
export default function ProfilePage() {
  const params = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [me, setMe] = useState<Awaited<ReturnType<typeof fetchMe>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMe().then((u) => {
      setMe(u);
      setLoading(false);
    });
  }, []);

  // If user hits /profile, we’ll redirect from the wrapper route (below).
  const slug = params.slug;
  const parsed = parseSlug(slug);

  // When viewing *my* profile, normalize slug (e.g., if user typed wrong case)
  useEffect(() => {
    if (!loading && me) {
      const desired = makeProfileSlug(me.firstName, me.lastName, me.id);
      if (slug && slug !== desired) {
        // if only code differs or name differs, normalize to canonical
        // (Optional) Only normalize when this is my profile.
      }
    }
  }, [loading, me, slug]);

  if (loading) {
    return (
      <div className="vp-loading">
        <div className="vp-spinner" aria-hidden />
      </div>
    );
  }

  if (!me) {
    return <Navigate to="/" replace />;
  }

  // Minimal “ownership” check: if slug is missing, we’re in /profile redirect flow,
  // or if someone typed /u/<bad-slug>, just show my profile (alternatively 404).
  const myFullName = [me.firstName, me.lastName].filter(Boolean).join(" ").trim() || me.firstName;
  const targetSlug = makeProfileSlug(me.firstName, me.lastName, me.id);
  const isMine = !slug || slug === targetSlug;

  // If user is at /u/<anything> but not the canonical slug, you could 404 or redirect.
  // Here we tolerate and show the same data (easy path).
  const nameToShow = myFullName;
  const headline = me.headline || "";
  const location = me.location || "";
  const stats = me.stats || { connections: 0, followers: 0, views: 0 };

  return (
    <main className="vp-root">
      <section className="vp-cover" />

      <section className="vp-card">
        <div className="vp-card-inner">
          <div className="vp-top">
            <div className="vp-left">
              <div className="vp-avatar-wrap">
                <AvatarCircle name={nameToShow} src={me.avatarUrl} size={96} />
              </div>
              <div className="vp-id">
                <h1 className="vp-name">{nameToShow}</h1>
                {headline && <div className="vp-headline">{headline}</div>}
                <div className="vp-meta">
                  {location && <span>{location}</span>}
                  <span className="vp-dot" />
                  <span>Connections {stats.connections.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="vp-actions">
              {isMine ? (
                <>
                  <button className="vp-btn primary" onClick={() => alert("Edit profile")}>
                    Edit profile
                  </button>
                  <button className="vp-btn" onClick={() => alert("Share profile link")}>
                    Share
                  </button>
                </>
              ) : (
                <>
                  <button className="vp-btn primary" onClick={() => alert("Connect sent")}>
                    Connect
                  </button>
                  <button className="vp-btn" onClick={() => alert("Message opened")}>
                    Message
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="vp-stats">
            <div className="vp-stat">
              <div className="vp-stat-num">{stats.followers.toLocaleString()}</div>
              <div className="vp-stat-label">Followers</div>
            </div>
            <div className="vp-stat">
              <div className="vp-stat-num">{stats.views.toLocaleString()}</div>
              <div className="vp-stat-label">Profile views</div>
            </div>
            <div className="vp-stat">
              <div className="vp-stat-num">{stats.connections.toLocaleString()}</div>
              <div className="vp-stat-label">Connections</div>
            </div>
          </div>

          <div className="vp-tabs">
            <button className="vp-tab is-active">About</button>
            <button className="vp-tab">Activity</button>
            <button className="vp-tab">Experience</button>
            <button className="vp-tab">Projects</button>
          </div>

          <div className="vp-grid">
            <article className="vp-panel">
              <h3>About</h3>
              <p>
                Builder of scalable systems and clean UIs. I like shipping fast, validating with users,
                and polishing the edges. Interests: GenAI × Data, product velocity, and developer
                experience.
              </p>
            </article>

            <article className="vp-panel">
              <h3>Highlights</h3>
              <ul className="vp-list">
                <li>Built a GenAI contract pipeline (AWS Bedrock, Glue, S3, DynamoDB).</li>
                <li>Cut ETL latency by 50% for a multi-million-row pipeline.</li>
                <li>Hackathon regular; UI/UX enjoyer; coffee required.</li>
              </ul>
            </article>

            <article className="vp-panel">
              <h3>Links</h3>
              <ul className="vp-links">
                <li><a href="https://www.linkedin.com/in/diego-cicotoste/" target="_blank" rel="noreferrer">LinkedIn</a></li>
                <li><a href="https://github.com/DiegoCico" target="_blank" rel="noreferrer">GitHub</a></li>
              </ul>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}

/** Route helper: use this component for /profile (no slug) to redirect to canonical /u/<slug> */
export function RedirectToMyProfile() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetchMe().then((me) => {
      const slug = makeProfileSlug(me.firstName, me.lastName, me.id);
      navigate(`/u/${slug}`, { replace: true });
      setReady(true);
    });
  }, [navigate]);

  return ready ? null : (
    <div className="vp-loading">
      <div className="vp-spinner" aria-hidden />
    </div>
  );
}
