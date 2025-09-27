// src/userProfile.ts
import { getAuth } from "firebase/auth";
import { API_URL } from "./config";

const API = API_URL; 
export type ProfileData = {
  id: string;
  firstName: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  location?: string;
  avatarUrl?: string;
  bio?: string;
  stats?: { followers: number; views: number };
};


/**
 * Fetch the currently logged-in user's profile
 */
export async function fetchMe(): Promise<ProfileData> {
  const auth = getAuth();
  const user = auth.currentUser;

  if (!user) throw new Error("Not logged in");

  // Get a fresh Firebase ID token
  const token = await user.getIdToken();

  const r = await fetch(`${API}/api/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!r.ok) throw new Error("Failed to fetch me");
  return r.json();
}

/**
 * Fetch another user's profile by their slug
 * (e.g., "diego-cicotoste")
 */
export async function fetchUserBySlug(slug: string): Promise<ProfileData> {
  const r = await fetch(`${API}/api/users/${encodeURIComponent(slug)}`);
  if (r.status === 404) throw new Error("User not found");
  if (!r.ok) throw new Error("Failed to fetch user");
  return r.json();
}
