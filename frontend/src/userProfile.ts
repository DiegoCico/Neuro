// src/userProfile.ts
import { getAuth } from "firebase/auth";
import { API_URL } from "./config";

const API = API_URL;

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

  /** Existing stats shape used by the UI */
  stats?: { followers: number; views: number };

  /**
   * Optional fields that may be present if your backend denormalizes them.
   * - followersCount is preferred by the UI when present.
   * - following is useful on the *viewer* object for client-side isFollowing calc.
   */
  followersCount?: number;
  following?: string[];
};

export type FollowResponse = {
  isFollowing: boolean;
  followersCount: number;
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
  const r = await fetch(`${API}/api/users/${encodeURIComponent(slug)}`);
  if (r.status === 404) throw new Error("User not found");
  if (!r.ok) throw new Error("Failed to fetch user");
  return r.json();
}

/* ---------------- mutations ---------------- */

export async function followBySlug(slug: string): Promise<FollowResponse> {
  const headers = await authHeaders();
  const r = await fetch(`${API}/api/users/${encodeURIComponent(slug)}/follow`, {
    method: "POST",
    headers,
  });
  if (!r.ok) throw new Error("follow failed");
  return r.json();
}

export async function unfollowBySlug(slug: string): Promise<FollowResponse> {
  const headers = await authHeaders();
  const r = await fetch(`${API}/api/users/${encodeURIComponent(slug)}/unfollow`, {
    method: "POST",
    headers,
  });
  if (!r.ok) throw new Error("unfollow failed");
  return r.json();
}
