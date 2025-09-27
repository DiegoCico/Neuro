import React, { useEffect, useState } from "react";
import NeuroLogo from "./NeuroLogo";
// import Avatar from "./Avatar"; // no longer needed here
import ProfileDropdown from "./ProfileDropdown";
import { fetchUserNames } from "../userProfile";
import { initThemeFromCache /* , toggleTheme */ } from "../utils/theme";
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
    <path d="M4 10.5 12 4l8 6.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
    <path d="M9 22v-6h6v6" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);
const IconPeople = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7"/>
    <path d="M14.5 9.5a3 3 0 1 0 0-6" stroke="currentColor" strokeWidth="1.7" />
    <path d="M3.5 19.5c0-3 3-5 6.5-5s6.5 2 6.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>
);
const IconBriefcase = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.7"/>
    <path d="M8 7V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.7"/>
    <path d="M3 12h18" stroke="currentColor" strokeWidth="1.7"/>
  </svg>
);
const IconBell = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" stroke="currentColor" strokeWidth="1.7"/>
    <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
  </svg>
);
const IconChat = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden {...p}>
    <path d="M20 14.5c0 1.1-.9 2-2 2H9l-4 3V6.5c0-1.1.9-2 2-2h11c1.1 0 2 .9 2 2v8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
  </svg>
);

/* ---------- Badged icon wrapper ---------- */
function BadgedIcon({
  children,
  count,
  label,
}: {
  children: React.ReactNode;
  count?: number;
  label: string;
}) {
  return (
    <button className="icon-btn" aria-label={label} type="button">
      {children}
      {typeof count === "number" && count > 0 && (
        <span className="badge" aria-hidden>
          {count}
        </span>
      )}
    </button>
  );
}

/* ---------- Props ---------- */
type Props = { onSearch: (q: string) => void };

/* ---------- Header ---------- */
export default function Header({ onSearch }: Props) {
  const [q, setQ] = useState("");
  const [firstName, setFirstName] = useState("U");
  const [fullName, setFullName] = useState("User");
  const [bio, setBio] = useState("");

  useEffect(() => {
    initThemeFromCache();
    fetchUserNames().then(({ firstName }) => setFirstName(firstName));
    fetchUserNames().then(({ bio }) => setBio(bio));
    fetchUserNames().then(({ fullName }) => setFullName(fullName));
  }, []);

  return (
    <header className="header" role="banner">
      {/* Left: brand */}
      <div className="header-left">
        <div className="brand-wrap">
          <NeuroLogo size={26} />
          <span className="brand">Neuro</span>
        </div>
      </div>

      {/* Center: search (centered) */}
      <div className="header-center">
        <div className="search">
          <IconSearch className="search-icon" />
          <input
            className="search-input"
            value={q}
            onChange={(e) => {
              const v = e.target.value;
              setQ(v);
              onSearch(v);
            }}
            placeholder="Search people, companies, events…"
            aria-label="Search"
          />
        </div>
      </div>

      {/* Right: icon+label nav + alerts + profile dropdown */}
      <div className="header-right">
        <nav className="nav-links" aria-label="Primary">
          <button className="nav-link is-active" type="button">
            <IconHome className="nav-ico" />
            <span>Home</span>
          </button>
        </nav>

        <nav className="nav-links" aria-label="Secondary">
          <button className="nav-link" type="button">
            <IconPeople className="nav-ico" />
            <span>Network</span>
          </button>
          <button className="nav-link" type="button">
            <IconBriefcase className="nav-ico" />
            <span>Jobs</span>
          </button>
        </nav>

        <BadgedIcon label="Notifications" count={3}><IconBell /></BadgedIcon>
        <BadgedIcon label="Messages" count={2}><IconChat /></BadgedIcon>
        <div className="divider" aria-hidden />

        {/* Modern profile dropdown */}
        <ProfileDropdown
          name={fullName}
          subtitle={bio}
          onViewProfile={() => (window.location.href = "/profile")}
          onSettings={() => (window.location.href = "/settings")}
          onSignOut={() => alert("Signed out")}
        />

        {/* Optional theme toggle for debugging: */}
        {/* <button className="toggle" onClick={toggleTheme} aria-label="Toggle theme">◑</button> */}
      </div>
    </header>
  );
}
