import { auth, db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * Fetch the user's full name from Firestore at users/{uid}.fullName.
 * Falls back to auth.currentUser.displayName, then "User".
 */
export async function fetchUserNames() {
  const u = auth.currentUser;
  let fullName = "User";
  let bio = "";
  if (u?.uid) {
    const snap = await getDoc(doc(db, "users", u.uid));
    const data = snap.exists() ? snap.data() as any : null;
    fullName = (data?.fullName || u.displayName || "User").trim();
    bio = (data?.bio || "").trim(); 
  }
  const firstName = fullName.split(/\s+/)[0] || fullName;
  return { fullName, firstName, bio };
}
