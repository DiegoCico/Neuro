import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { auth } from "../firebase"; // adjust path if needed
import { onAuthStateChanged, User } from "firebase/auth";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const loc = useLocation();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
        <div>Loading…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: loc }} replace />;
  }

  return <>{children}</>;
}
