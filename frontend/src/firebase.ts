// src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider } from "firebase/auth";
// Optional analytics (guarded so it won't break in unsupported envs)
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyBqZKpHbH6X5oSkj1RKLpP9TXADvouEuCI",
  authDomain: "neru-b3128.firebaseapp.com",
  projectId: "neru-b3128",
  storageBucket: "neru-b3128.firebasestorage.app",
  messagingSenderId: "193050329519",
  appId: "1:193050329519:web:ab4e8451d615fe76ad6f5a",
  measurementId: "G-TDRDCQ4TSF",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Providers
export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

// (Optional) Analytics
isSupported()
  .then((ok) => {
    if (ok) getAnalytics(app);
  })
  .catch(() => {});
