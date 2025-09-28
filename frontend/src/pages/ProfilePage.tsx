// src/pages/ProfilePage.tsx
import React, { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { useNavigate, useParams, Navigate, Link } from "react-router-dom";
import Header from "../components/Header";
import "../css/ProfilePage.css";
import {
  fetchMe,
  fetchUserBySlug,
  followBySlug,
  fetchExperienceBySlug,
  unfollowBySlug,
  type ProfileData,
  type FollowersDetail,
} from "../userProfile";
import { API_URL } from "../config";
// import { getAuth } from "firebase/auth";
import { getAuth } from "firebase/auth";
import PostMini from "../components/PostMini";

// Lazy-load Experience so it only bundles & fetches after user clicks the tab
const ExperienceSection = lazy(() => import("../components/ExperienceSection"));

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
  onReconcileFollowers,
}: {
  slug: string;
  isFollowing: boolean | null; // null => not authenticated yet
  setIsFollowing: (v: boolean) => void;
  followersCount: number;
  setFollowersCount: (n: number) => void;
  onNeedAuth?: () => void;
  onReconcileFollowers?: (serverCount: number) => void;
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
        onReconcileFollowers?.(res.followersCount);
      } else {
        setIsFollowing(true);
        setFollowersCount(followersCount + 1);
        const res = await followBySlug(slug);
        setIsFollowing(res.isFollowing);
        setFollowersCount(res.followersCount);
        onReconcileFollowers?.(res.followersCount);
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

export type PostData = {
  id: string;
  userId: string;
  userFullName: string;
  text?: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  createdAt: string;
  likes: string[];
  commentsCount: number;
};  

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
  const [followersDetails, setFollowersDetails] = useState<FollowersDetail[]>([]);

  const [title, setTitle] = useState('')
  const [bio, setBio] = useState('')
  const [currentFocus, setCurrentFocus] = useState('')
  const [beyondWork, setBeyondWork] = useState('')
  const [about, setAbout] = useState<any>({})

  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [hideMessage, setHideMessage] = useState(false)

  const [isEditing, setIsEditing] = useState(false)
  const [posts, setPosts] = useState<PostData[]>([])

  // Tabs: render Experience only when tab === "Experience"
  const [tab, setTab] = useState<"About" | "Activity" | "Experience" | "Projects">("About");

  useEffect(() => {
    async function fetchPosts() {
      try {
        if (profile) {
          const res = await fetch(`${API_URL}/api/posts?userId=${profile.id}`)
          const data = await res.json()
          if (data.ok) {
            console.log(data)
            setPosts(data.posts)
          } else {
            console.error('Failed to fetch', data.error)
          }
        } else {
          console.log('Profile not found')
          return
        }
      } catch (error) {
        console.error("Error fetching posts:", error);
      }
    }

    fetchPosts()
  }, [profile])

  // Initial load: fetch viewer & target profile
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
            if (alive) {
              setProfile(u)
              setTitle(u.occupation || "")
              setBio(u.bio || "")
            }

            const res = await fetch(`${API_URL}/api/profile/about/${slug}`);
            if (res.ok) {
              const data = await res.json();
              if (alive) setAbout(data.about || {});
              setCurrentFocus(data.about?.currentFocus || "")
              setBeyondWork(data.about?.beyondWork || "")
            }
          } catch {
            if (alive) setNotFound(true);
          }
        } else {
          if (!me) {
            if (alive) setAuthRequired(true);
          } else {
            if (alive) {
              setProfile(me);

              const auth = getAuth();
              const user = auth.currentUser;
              if (user) {
                const token = await user.getIdToken();
                const res = await fetch(`${API_URL}/api/profile/about/${me.slug}`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  const data = await res.json();
                  if (alive) setAbout(data.about || {});
                }
              }
            } 
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

  // Initialize follow-related UI state whenever viewer/profile changes
  useEffect(() => {
    if (!profile) {
      setFollowersCount(0);
      setFollowersDetails([]);
      setIsFollowing(null);
      return;
    }

    const initFollowers = (profile.followersCount ?? profile.stats?.followers ?? 0) || 0;
    setFollowersCount(initFollowers);

    setFollowersDetails(Array.isArray(profile.followersDetails) ? profile.followersDetails : []);

    const followingList: string[] = (viewer?.following as string[] | undefined) ?? [];
    const targetId: string | undefined = profile.id;
    if (viewer && targetId) {
      setIsFollowing(Array.isArray(followingList) ? followingList.includes(targetId) : false);
    } else {
      setIsFollowing(null);
    }
  }, [viewer, profile]);

  // Render branches
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

  // Use backend slug if present; otherwise derive
  const profileSlug = (profile.slug && profile.slug.trim().length > 0)
    ? profile.slug.toLowerCase()
    : makeProfileSlug(profile.firstName, profile.lastName);

  // Decide "mine" by id equality (robust vs name/slug collisions)
  const isMine = Boolean(viewer?.id && profile?.id && viewer!.id === profile!.id);

  const initialViews = profile.stats?.views ?? 0;

  // Optional: reconcile followers list when server returns a count that differs (refetch lightweight)
  async function reconcileFollowersIfNeeded(serverCount: number) {
    if (!slug) return;
    if (serverCount !== followersDetails.length) {
      try {
        const u = await fetchUserBySlug(profileSlug);
        setFollowersDetails(Array.isArray(u.followersDetails) ? u.followersDetails : []);
        setFollowersCount(u.followersCount ?? u.stats?.followers ?? serverCount);
      } catch {
        // ignore
      }
    }
  }

  const handleEdit = () => {
    setIsEditing(true)
    setDirty(true)
    setTab('About')
  }

  const updateProfile = async (
      title: string,
      bio: string,
      currentFocus: string,
      beyondWork: string
    ): Promise<boolean> => {
      try {
        const auth = getAuth();
        const user = auth.currentUser;
        if (!user) {
          console.error("Not logged in");
          return false;
        }

        const token = await user.getIdToken();

        const res = await fetch(`${API_URL}/api/profile/about`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title,
            bio,
            currentFocus,
            beyondWork,
          }),
        });

        if (!res.ok) {
          console.error("Failed to update profile:", await res.text());
          return false;
        }

        const data = await res.json();
        console.log("Profile update response:", data);

        return data.ok === true;
      } catch (err) {
        console.error("Error updating profile:", err);
        return false;
      }
    }

  return (
    <>
      <Header onSearch={() => {}} />

      <main className="vp-root">
        {/* top cover */}
        <section className="vp-cover">
          <div className="vp-cover-gradient" />
        </section>

        {/* 2-col shell */}
        <section className="vp-shell">
          {/* Left: sticky sidebar card */}
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
                    <button className="vp-btn primary" onClick={() => handleEdit()}>
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
                      onReconcileFollowers={reconcileFollowersIfNeeded}
                    />
                    <button className="vp-btn" onClick={() => alert("Message opened")}>
                      Message
                    </button>
                  </>
                )}
              </div>

              {/* Followers preview */}
              {followersDetails.length > 0 && (
                <div className="vp-aside-followers">
                  <div className="vp-aside-sub" style={{ marginBottom: 6 }}>Recent followers</div>
                  <ul className="vp-followers-list">
                    {followersDetails.slice(0, 6).map((f) => {
                      const link = f.slug ? `/u/${f.slug}` : undefined;
                      return (
                        <li key={f.uid} className="vp-follower-row">
                          <div className="vp-follower-avatar" aria-hidden>
                            <div className="vp-avatar small">
                              {(f.fullName?.[0] || "U").toUpperCase()}
                            </div>
                          </div>
                          <div className="vp-follower-name">
                            {link ? <Link to={link}>{f.fullName}</Link> : f.fullName}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {followersCount > followersDetails.length && (
                    <div className="vp-followers-more">
                      and {followersCount - followersDetails.length} more…
                    </div>
                  )}
                </div>
              )}

              {/* Tabs */}
              <nav className="vp-aside-nav" aria-label="Profile sections">
                <button
                  className={`vp-aside-link ${tab === "About" ? "is-active" : ""}`}
                  onClick={() => setTab("About")}
                >
                  About
                </button>
                <button
                  className={`vp-aside-link ${tab === "Activity" ? "is-active" : ""}`}
                  onClick={() => setTab("Activity")}
                >
                  Activity
                </button>
                <button
                  className={`vp-aside-link ${tab === "Experience" ? "is-active" : ""}`}
                  onClick={() => setTab("Experience")}
                >
                  Experience
                </button>
                <button
                  className={`vp-aside-link ${tab === "Projects" ? "is-active" : ""}`}
                  onClick={() => setTab("Projects")}
                >
                  Projects
                </button>
              </nav>

              <div className="vp-aside-links">
                <a href="https://github.com/DiegoCico" target="_blank" rel="noreferrer">GitHub</a>
              </div>
            </div>
          </aside>

          {/* Right: content */}
          <section className="vp-main">
            {tab === "About" && (
              <>
                {isMine && isEditing ? (
                  <h1
                    className="vp-hero-title"
                    contentEditable
                    suppressContentEditableWarning
                    onFocus={(e) => {
                      if (!title) e.currentTarget.textContent = "";
                    }}
                    onBlur={(e) => {
                      const val = e.currentTarget.textContent?.trim() || "";
                      setTitle(val);
                      setDirty(true)
                      if (!val) e.currentTarget.textContent = "Add your title...";
                    }}
                  >
                    {title || "Add your title..."}
                  </h1>
                    
                ) : (
                  <h1 className="vp-hero-title">{title}</h1>
                )}

                {isMine && isEditing ? (
                  <p
                    className="vp-hero-sub editable"
                    contentEditable
                    suppressContentEditableWarning
                    onFocus={(e) => {
                      if (!bio) e.currentTarget.textContent = "";
                    }}
                    onBlur={(e) => {
                      const val = e.currentTarget.textContent?.trim() || "";
                      setBio(val);
                      setDirty(true)
                      if (!val) e.currentTarget.textContent = "Add your bio...";
                    }}
                  >
                    {bio || "Add your bio..."}
                  </p>
                ) : (
                  <p className="vp-hero-sub">{bio}</p>
                )}

                <div className="vp-section">
                  <h2 className="vp-h2">Current Focus</h2>
                  {isMine && isEditing ? (
                    <p
                      className="vp-copy editable"
                      contentEditable
                      suppressContentEditableWarning
                      onFocus={(e) => {
                        if (!currentFocus) e.currentTarget.textContent = "";
                      }}
                      onBlur={(e) => {
                        const val = e.currentTarget.textContent?.trim() || "";
                        setCurrentFocus(val);
                        setDirty(true)
                        if (!val) e.currentTarget.textContent = "Add your current focus...";
                      }}
                    >
                      {currentFocus || "Add your current focus..."}
                    </p>
                  ) : (
                    <p className="vp-copy">{currentFocus}</p>
                  )}
                </div>

                <div className="vp-section">
                  <h2 className="vp-h2">Beyond Work</h2>
                  {isMine && isEditing ? (
                    <p
                      className="vp-copy editable"
                      contentEditable
                      suppressContentEditableWarning
                      onFocus={(e) => {
                        if (!beyondWork) e.currentTarget.textContent = "";
                      }}
                      onBlur={(e) => {
                        const val = e.currentTarget.textContent?.trim() || "";
                        setBeyondWork(val);
                        setDirty(true)
                        if (!val) e.currentTarget.textContent = "Add your beyond work...";
                      }}
                    >
                      {beyondWork || "Add your beyond work..."}
                    </p>
                  ) : (
                    <p className="vp-copy">{beyondWork}</p>
                  )}
                </div>

                <div className="vp-section">
                  <h2 className="vp-h2">Recent Highlights</h2>

                  {/* <div className="vp-highlight">
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
                  </div> */}
                </div>

                {dirty && (
                <div style={{ marginTop: "1rem" }}>
                  {!saved ? (
                    <button
                      className="primary"
                      onClick={async () => {
                        const ok = await updateProfile(title, bio, currentFocus, beyondWork);
                        if (ok) {
                          setSaved(true);
                          setDirty(false);

                          setTimeout(() => setHideMessage(true), 2200);
                          setTimeout(() => {
                            setSaved(false);
                            setHideMessage(false);
                          }, 3000);
                        }
                      }}
                    >
                      Save
                    </button>
                  ) : (
                    <button
                      className={`primary ${hideMessage ? "fade-out" : ""}`}
                      disabled
                    >
                      Profile updated
                    </button>
                  )}
                </div>
              )}

                {saved && (
                  <div style={{ marginTop: "1rem" }} className={`fade-message ${hideMessage ? "hidden" : ""}`}>
                    <button className="primary" disabled>
                      Profile updated
                    </button>
                  </div>
                )}
              </>
            )}

            {tab === "Activity" && (
              <div className="vp-section">
                <h2 className="vp-h2">Activity</h2>
                {posts.map((post) => (
                  <PostMini
                    key={post.id}
                    id={post.id}
                    userId={post.userId}
                    userFullName={post.userFullName}
                    text={post.text}
                    mediaUrl={post.mediaUrl}
                    createdAt={post.createdAt}
                    likes={post.likes}
                    commentsCount={post.commentsCount}
                  />
                ))}
              </div>
            )}

            {tab === "Experience" && (
              <Suspense
                fallback={
                    <div className="vp-section">
                      <h2 className="vp-h2">Experience</h2>
                      <div className="vp-skel-line" style={{ width: "60%" }} />
                      <div className="vp-skel-line" style={{ width: "50%" }} />
                      <div className="vp-skel-line" style={{ width: "40%" }} />
                    </div>
                }
              >
                <ExperienceSection
                    profileSlug={profileSlug}
                    isMine={isMine}
                  />

              </Suspense>
            )}

            {tab === "Projects" && (
              <div className="vp-section">
                <h2 className="vp-h2">Projects</h2>
                <p className="vp-copy">Coming soon.</p>
              </div>
            )}
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
        const slug = (me.slug && me.slug.trim().length > 0)
          ? me.slug.toLowerCase()
          : makeProfileSlug(me.firstName, me.lastName);
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
