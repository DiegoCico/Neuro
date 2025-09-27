// src/components/Header.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import NeuroLogo from "./NeuroLogo";
import ProfileDropdown from "./ProfileDropdown";
import { fetchMe, type ProfileData } from "../userProfile";
import { initThemeFromCache /*, toggleTheme*/ } from "../utils/theme";
import { getAuth, signOut } from "firebase/auth";
import { API_URL } from "../config";
import "../css/Header.css";
import "../css/ProfileDropdown.css";

/* ---------- Inline icons ---------- */
const IconSearch = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
    <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const IconHome = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path
      d="M4 10.5 12 4l8 6.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9.5Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path d="M9 22v-6h6v6" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);
const IconPeople = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M14.5 9.5a3 3 0 1 0 0-6" stroke="currentColor" strokeWidth="1.7" />
    <path d="M3.5 19.5c0-3 3-5 6.5-5s6.5 2 6.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
const IconBriefcase = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M8 7V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.7" />
    <path d="M3 12h18" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);
const IconBell = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" stroke="currentColor" strokeWidth="1.7" />
    <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);
const IconChat = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path
      d="M20 14.5c0 1.1-.9 2-2 2H9l-4 3V6.5c0-1.1.9-2 2-2h11c1.1 0 2 .9 2 2v8Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  </svg>
);

type SearchItem = { id: string; fullName: string; slug: string; avatarUrl?: string | null };

/* ---------- utils ---------- */
function kebabName(first?: string, last?: string) {
  const full = [first ?? "", last ?? ""].filter(Boolean).join(" ").trim();
  return full
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/* ---------- Props ---------- */
type Props = { onSearch?: (q: string) => void };

/* ---------- Header ---------- */
export default function Header({ onSearch }: Props) {
  const [q, setQ] = useState("");
  const [fullName, setFullName] = useState("User");
  const [bio, setBio] = useState("");
  const [profile, setProfile] = useState<ProfileData | null>(null);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [networkOpen, setNetworkOpen] = useState(false)
  const networkRef = useRef<HTMLDivElement | null>(null)

  const loc = useLocation();


  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (networkRef.current && !networkRef.current.contains(e.target as Node)) {
        setNetworkOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    initThemeFromCache();

    (async () => {
      try {
        const u = await fetchMe(); // uses Firebase ID token under the hood
        setProfile(u);
        setFullName(u.fullName || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.firstName);
        setBio(u.bio || "");
      } catch {
        // not logged in; Header stays neutral (pages handle redirects)
      }
    })();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced fetch
  useEffect(() => {
    if (!q || q.trim().length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const url = `${API_URL}/api/search/users?q=${encodeURIComponent(q)}&limit=8`;
        const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
        if (!res.ok) throw new Error("search failed");
        const data = await res.json();
        const list: SearchItem[] = Array.isArray(data?.items) ? data.items : [];
        setItems(list);
        setActiveIdx(0);
        setOpen(list.length > 0);
      } catch {
        setItems([]);
        setOpen(false);
      }
      if (onSearch) onSearch(q);
    }, 200);
    return () => clearTimeout(t);
  }, [q, onSearch]);

  /** Fired whenever the avatar (profile dropdown trigger) is pressed. */
  const logAuthDebug = async () => {
    const auth = getAuth();
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : null;

    console.log("[ProfileDropdown Trigger]");
    console.log("FirebaseUser:", user
      ? {
          uid: user.uid,
          email: user.email ?? null,
          displayName: user.displayName ?? null,
          providerData:
            user.providerData?.map((p) => ({
              providerId: p.providerId,
              uid: p.uid,
              email: p.email ?? null,
            })) ?? [],
        }
      : null);
    console.log("ID Token:", token);
    console.log("ProfileData:", profile);
  };

  const goToMyProfile = () => {
    if (!profile) return navigate("/auth");
    const parts = profile.fullName?.trim().split(" ") || [];
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";
    const slug = kebabName(firstName, lastName);
    navigate(`/u/${slug}`);
  };

  const handleSignOut = async () => {
    try {
      await signOut(getAuth());
    } finally {
      navigate("/auth", { replace: true });
    }
  };

  const goToItem = (idx: number) => {
    const item = items[idx];
    if (!item) return;
    setOpen(false);
    setQ("");
    navigate(`/u/${item.slug}`);
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      goToItem(activeIdx);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <header className="header" role="banner">
      {/* Left: brand */}
      <div className="header-left">
        <div className="brand-wrap" onClick={() => navigate("/home")} style={{ cursor: "pointer" }}>
          <NeuroLogo size={26} />
          <span className="brand">Neuro</span>
        </div>
      </div>

      {/* Center: search */}
      <div className="header-center" ref={boxRef}>
        <div className="search">
          <IconSearch className="search-icon" />
          <input
            ref={inputRef}
            className="search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search people by name…"
            aria-label="Search"
          />
          {open && items.length > 0 && (
            <div className="search-pop" role="listbox" aria-label="Search results">
              {items.map((it, i) => (
                <button
                  key={it.id}
                  type="button"
                  className={`search-item ${i === activeIdx ? "is-active" : ""}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => goToItem(i)}
                >
                  <img
                    className="search-avatar"
                    src={it.avatarUrl || "/img/avatar-placeholder.png"}
                    alt=""
                    aria-hidden
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "/img/avatar-placeholder.png";
                    }}
                  />
                  <div className="search-meta">
                    <div className="search-name">{it.fullName}</div>
                    <div className="search-sub">@{it.slug}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: nav + actions + profile */}
      <div className="header-right">
        <nav className="nav-links" aria-label="Primary">
          <button className="nav-link is-active" type="button" onClick={() => navigate("/home")}>
            <IconHome className="nav-ico" />
            <span>Home</span>
          </button>
        </nav>

        <nav className="nav-links" aria-label="Secondary">
          {/* <button className="nav-link" type="button">
            <IconPeople className="nav-ico" />
            <span>Network</span>
          </button> */}
          <div className="dropdown-wrap" ref={networkRef}>
            <button
              className="nav-link"
              type="button"
              onClick={() => setNetworkOpen((o) => !o)}
            >
              <IconPeople className="nav-ico" />
              <span>Network</span>
            </button>

            {networkOpen && (
              <div className="dropdown-pop" role="menu">
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    setNetworkOpen(false);
                    navigate("/live-connect");
                  }}
                >
                  Live connect
                </button>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => {
                    setNetworkOpen(false);
                    navigate("/your-network");
                  }}
                >
                  Your network
                </button>
              </div>
            )}
          </div>
          <button className="nav-link" type="button">
            <IconBriefcase className="nav-ico" />
            <span>Jobs</span>
          </button>
        </nav>

        <button className="icon-btn" aria-label="Notifications" type="button">
          <IconBell />
          <span className="badge" aria-hidden>3</span>
        </button>
        <button
          className={`icon-btn ${loc.pathname.startsWith("/messages") ? "is-active" : ""}`}
          aria-label="Messages"
          type="button"
          onClick={() => navigate("/messages")}
        >
          <IconChat />
          <span className="badge" aria-hidden>2</span>
        </button>

        <div className="divider" aria-hidden />

        <ProfileDropdown
          name={fullName}
          subtitle={bio}
          onTrigger={logAuthDebug}
          onViewProfile={goToMyProfile}
          onSettings={() => navigate("/settings")}
          onSignOut={handleSignOut}
        />
      </div>
    </header>
  );
}
