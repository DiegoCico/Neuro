// src/pages/ProfilePage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Navigate, Link } from "react-router-dom";
import Header from "../components/Header";
import "../css/ProfilePage.css";
import {
  fetchMe,
  fetchUserBySlug,
  followBySlug,
  unfollowBySlug,
  type ProfileData,
} from "../userProfile";

/* ---------- slug utils ---------- */
function kebabName(first?: string, last?: string) {
  const full = [first ?? "", last ?? ""].filter(Boolean).join(" ").trim();
  return full
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
function makeProfileSlug(first?: string, last?: string) {
  return kebabName(first, last);
}

/* ---------- avatar ---------- */
function AvatarCircle({ name, src, size = 80 }: { name: string; src?: string; size?: number }) {
  const initials = useMemo(() => {
    const parts = (name || "").trim().split(/\s+/);
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

/* ---------- follow toggle ---------- */
function FollowToggle({
  slug,
  isFollowing,
  setIsFollowing,
  followersCount,
  setFollowersCount,
  onNeedAuth,
}: {
  slug: string;
  isFollowing: boolean | null;
  setIsFollowing: (v: boolean) => void;
  followersCount: number;
  setFollowersCount: (n: number) => void;
  onNeedAuth?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    if (isFollowing === null) {
      onNeedAuth?.();
      return;
    }
    setBusy(true);
    try {
      if (isFollowing) {
        setIsFollowing(false);
        setFollowersCount(Math.max(0, followersCount - 1));
        const res = await unfollowBySlug(slug);
        setIsFollowing(res.isFollowing);
        setFollowersCount(res.followersCount);
      } else {
        setIsFollowing(true);
        setFollowersCount(followersCount + 1);
        const res = await followBySlug(slug);
        setIsFollowing(res.isFollowing);
        setFollowersCount(res.followersCount);
      }
    } catch {
      alert("Sorry, that didn’t work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const label = isFollowing ? "Unfollow" : "Follow";
  const cls = isFollowing ? "vp-btn" : "vp-btn primary";

  return (
    <button className={cls} onClick={handleClick} disabled={busy}>
      {busy ? "…" : label}
    </button>
  );
}

/* ---------- page ---------- */
export default function ProfilePage() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();

  const [viewer, setViewer] = useState<ProfileData | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [isFollowing, setIsFollowing] = useState<boolean | null>(null);
  const [followersCount, setFollowersCount] = useState<number>(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setAuthRequired(false);
      setNotFound(false);
      try {
        const me = await fetchMe().catch(() => null);
        if (alive) setViewer(me);
        if (slug) {
          try {
            const u = await fetchUserBySlug(slug.toLowerCase());
            if (alive) setProfile(u);
          } catch {
            if (alive) setNotFound(true);
          }
        } else {
          if (!me) {
            if (alive) setAuthRequired(true);
          } else {
            if (alive) setProfile(me);
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  /* init follow state (must be above returns) */
  useEffect(() => {
    if (!profile) {
      setFollowersCount(0);
      setIsFollowing(null);
      return;
    }
    const initFollowers =
      (profile as any).followersCount ??
      (profile.stats?.followers ?? 0);
    setFollowersCount(typeof initFollowers === "number" ? initFollowers : 0);

    const followingList: string[] = (viewer as any)?.following ?? [];
    const targetId: string | undefined = (profile as any).id;
    if (viewer && targetId) {
      setIsFollowing(Array.isArray(followingList) ? followingList.includes(targetId) : false);
    } else {
      setIsFollowing(null); // null => viewer unknown/unauthenticated
    }
  }, [viewer, profile]);

  if (loading) {
    return (
      <>
        <Header onSearch={() => {}} />
        <div className="vp-loading">
          <div className="vp-spinner" aria-hidden />
        </div>
      </>
    );
  }

  if (authRequired) return <Navigate to="/auth" replace />;

  if (notFound) {
    return (
      <>
        <Header onSearch={() => {}} />
        <main className="vp-root">
          <section className="vp-shell">
            <div className="vp-main">
              <h1 className="vp-h2">User not found</h1>
              <p className="vp-copy">We couldn’t find that profile.</p>
              <div style={{ marginTop: 12 }}>
                <Link className="vp-btn" to="/home">Go Home</Link>
              </div>
            </div>
          </section>
        </main>
      </>
    );
  }

  if (!profile) return <Navigate to="/auth" replace />;

  const fullName =
    profile.fullName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
    (profile.firstName ?? "User");

  const profileSlug = makeProfileSlug(profile.firstName, profile.lastName);

  /* CRITICAL FIX: decide "isMine" by ID, not slug/names */
  const viewerId = (viewer as any)?.id ?? null;
  const profileId = (profile as any)?.id ?? null;
  const isMine = Boolean(viewerId && profileId && viewerId === profileId);

  const initialViews = profile.stats?.views ?? 0;

  return (
    <>
      <Header onSearch={() => {}} />

      <main className="vp-root">
        <section className="vp-cover">
          <div className="vp-cover-gradient" />
        </section>

        <section className="vp-shell">
          <aside className="vp-aside">
            <div className="vp-aside-card">
              <div className="vp-aside-head">
                <AvatarCircle name={fullName} src={profile.avatarUrl} size={80} />
                <div className="vp-aside-name">{fullName}</div>
                {profile.headline && <div className="vp-aside-sub">{profile.headline}</div>}
                <div className="vp-aside-loc">
                  <span className="vp-pin" aria-hidden>📍</span>
                  <span>{profile.location || "—"}</span>
                </div>
              </div>

              <div className="vp-aside-stats">
                <div className="vp-aside-stat">
                  <div className="vp-aside-num">{followersCount.toLocaleString()}</div>
                  <div className="vp-aside-label">Followers</div>
                </div>
                <div className="vp-aside-stat">
                  <div className="vp-aside-num">{initialViews.toLocaleString()}</div>
                  <div className="vp-aside-label">Views</div>
                </div>
              </div>

              <div className="vp-aside-actions">
                {isMine ? (
                  <>
                    <button className="vp-btn primary" onClick={() => navigate("/settings/profile")}>
                      Edit Profile
                    </button>
                    <button
                      className="vp-btn"
                      onClick={async () => {
                        const url = window.location.href;
                        if ((navigator as any).share) await (navigator as any).share({ url });
                        else {
                          await navigator.clipboard.writeText(url);
                          alert("Link copied");
                        }
                      }}
                    >
                      Share
                    </button>
                  </>
                ) : (
                  <>
                    <FollowToggle
                      slug={profileSlug}
                      isFollowing={isFollowing}
                      setIsFollowing={setIsFollowing}
                      followersCount={followersCount}
                      setFollowersCount={setFollowersCount}
                      onNeedAuth={() => navigate("/auth")}
                    />
                    <button className="vp-btn" onClick={() => alert("Message opened")}>
                      Message
                    </button>
                  </>
                )}
              </div>

              <nav className="vp-aside-nav" aria-label="Profile sections">
                <button className="vp-aside-link is-active">About</button>
                <button className="vp-aside-link">Activity</button>
                <button className="vp-aside-link">Experience</button>
                <button className="vp-aside-link">Projects</button>
              </nav>

              <div className="vp-aside-links">
                <a href="https://www.linkedin.com/in/diego-cicotoste/" target="_blank" rel="noreferrer">LinkedIn</a>
                <a href="https://github.com/DiegoCico" target="_blank" rel="noreferrer">GitHub</a>
              </div>
            </div>
          </aside>

          <section className="vp-main">
            <h1 className="vp-hero-title">Builder of scalable systems and clean UIs</h1>
            {profile.bio ? (
              <p className="vp-hero-sub">{profile.bio}</p>
            ) : (
              <p className="vp-hero-sub">
                I like shipping fast, validating with users, and polishing the edges. My interests span GenAI × Data,
                product velocity, and developer experience.
              </p>
            )}

            <div className="vp-section">
              <h2 className="vp-h2">Current Focus</h2>
              <p className="vp-copy">
                Currently working on GenAI contract pipeline optimization using Bedrock, Glue, S3, and DynamoDB. I&apos;ve
                successfully cut ETL latency by 50% across multi-million row datasets while maintaining data integrity
                and system reliability.
              </p>
            </div>

            <div className="vp-section">
              <h2 className="vp-h2">Beyond Work</h2>
              <p className="vp-copy">
                Hackathon regular, UI/UX enthusiast, and coffee fueled. I enjoy exploring the intersection of design and
                engineering, always looking for ways to create more intuitive and performant user experiences.
              </p>
            </div>

            <div className="vp-section">
              <h2 className="vp-h2">Recent Highlights</h2>

              <div className="vp-highlight">
                <div className="vp-highlight-title">GenAI Pipeline Optimization</div>
                <div className="vp-highlight-sub">
                  Architected and implemented a scalable contract processing pipeline using AWS services, reducing
                  processing time by 50% and improving system reliability.
                </div>
              </div>

              <div className="vp-highlight">
                <div className="vp-highlight-title">Multi-Million Row ETL</div>
                <div className="vp-highlight-sub">
                  Designed efficient data transformation processes handling massive datasets while maintaining sub-second
                  query response times.
                </div>
              </div>

              <div className="vp-highlight">
                <div className="vp-highlight-title">UI/UX Innovation</div>
                <div className="vp-highlight-sub">
                  Regular hackathon participant focused on creating intuitive interfaces that bridge the gap between
                  complex backend systems and user-friendly experiences.
                </div>
              </div>
            </div>
          </section>
        </section>
      </main>
    </>
  );
}

/* ---------- redirect helper ---------- */
export function RedirectToMyProfile() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = await fetchMe();
        const slug = makeProfileSlug(me.firstName, me.lastName);
        navigate(`/u/${slug}`, { replace: true });
      } catch {
        navigate("/auth", { replace: true });
      } finally {
        setReady(true);
      }
    })();
  }, [navigate]);

  return ready ? null : (
    <div className="vp-loading">
      <div className="vp-spinner" aria-hidden />
    </div>
  );
}
