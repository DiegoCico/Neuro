// src/userProfile.ts
import { getAuth } from "firebase/auth";
import { API_URL } from "./config";

const API = API_URL;

export type FollowersDetail = {
  uid: string;
  fullName: string;
  slug?: string;
};

/** What the backend returns for a user profile */
export type ProfileData = {
  id: string;
  firstName: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  location?: string;
  avatarUrl?: string;
  bio?: string;
  slug?: string;
  stats?: { followers: number; views: number };
  followersCount?: number;
  following?: string[];
  followersDetails?: FollowersDetail[];
};

export type FollowResponse = {
  isFollowing: boolean;
  followersCount: number;
};

/** Experience items under users/{uid}/experience */
export type Experience = {
  id: string;
  title: string;
  company: string;
  employmentType?: string;
  location?: string;
  startDate: string;   // "YYYY-MM" or "YYYY-MM-DD"
  endDate?: string;
  current?: boolean;
  description?: string;

  /** NEW canonical field */
  skills?: string[];

  /** Deprecated: kept for backward-compat reading only */
  technologies?: string[];

  logoUrl?: string;
  createdAt?: string;
  updatedAt?: string;
};

/* ---------------- helpers ---------------- */

async function authHeaders(extra?: Record<string, string>) {
  const auth = getAuth();
  const user = auth.currentUser;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(extra ?? {}),
  };
  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/* ---------------- queries ---------------- */

/** Fetch the currently logged-in user's profile */
export async function fetchMe(): Promise<ProfileData> {
  const headers = await authHeaders();
  const r = await fetch(`${API}/api/me`, { headers });
  if (!r.ok) throw new Error("Failed to fetch me");
  return r.json();
}

/** Fetch another user's profile by their slug (e.g., "diego-cicotoste") */
export async function fetchUserBySlug(slug: string): Promise<ProfileData> {
  const normalized = slug.toLowerCase();
  const r = await fetch(`${API}/api/users/${encodeURIComponent(normalized)}`);
  if (r.status === 404) throw new Error("User not found");
  if (!r.ok) throw new Error("Failed to fetch user");
  return r.json();
}

/** Normalize incoming experience items to always have `skills` populated */
function normalizeExperienceItem(raw: any): Experience {
  const skills: string[] | undefined =
    Array.isArray(raw?.skills) ? raw.skills :
    (Array.isArray(raw?.technologies) ? raw.technologies : undefined);

  return {
    id: String(raw.id),
    title: raw.title,
    company: raw.company,
    employmentType: raw.employmentType ?? undefined,
    location: raw.location ?? undefined,
    startDate: raw.startDate,
    endDate: raw.endDate ?? undefined,
    current: raw.current ?? undefined,
    description: raw.description ?? undefined,
    skills,                             // canonical
    technologies: raw.technologies,     // deprecated (read-only)
    logoUrl: raw.logoUrl ?? undefined,
    createdAt: raw.createdAt ?? undefined,
    updatedAt: raw.updatedAt ?? undefined,
  };
}

/** Fetch a user's experience by slug (reads users/{uid}/experience) */
export async function fetchExperienceBySlug(slug: string): Promise<Experience[]> {
  const normalized = slug.toLowerCase();
  const headers = await authHeaders(); // optional auth ok
  const r = await fetch(`${API}/api/users/${encodeURIComponent(normalized)}/experience`, {
    headers,
  });
  if (r.status === 404) return []; // treat as no experience if user not found
  if (!r.ok) throw new Error("Failed to fetch experience");
  const data = await r.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map(normalizeExperienceItem);
}

/* ---------------- mutations ---------------- */

export async function followBySlug(slug: string): Promise<FollowResponse> {
  const headers = await authHeaders();
  const r = await fetch(`${API}/api/users/${encodeURIComponent(slug.toLowerCase())}/follow`, {
    method: "POST",
    headers,
  });
  if (!r.ok) throw new Error("follow failed");
  return r.json();
}

export async function unfollowBySlug(slug: string): Promise<FollowResponse> {
  const headers = await authHeaders();
  const r = await fetch(`${API}/api/users/${encodeURIComponent(slug.toLowerCase())}/unfollow`, {
    method: "POST",
    headers,
  });
  if (!r.ok) throw new Error("unfollow failed");
  return r.json();
}
