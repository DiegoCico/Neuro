// src/pages/Home.tsx
import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import "../css/Home.css";
import Header from "../components/Header";
import { fetchMe, type ProfileData } from "../userProfile";
import NewPostPopUp from "../components/NewPostPopUp";

export type Post = {
  id: string;
  author: string;
  timestamp: string;
  text?: string;
  imageUrl?: string; // reserved for future (Storage)
  likes: number;
  comments: number;
};

export default function Home() {
  const [query, setQuery] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("User");
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(true);
  const [newPost, setNewPost] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const data: ProfileData = await fetchMe();
        if (data?.firstName) setFirstName(data.firstName);
        setAuthorized(true);
      } catch {
        setAuthorized(false); // not logged in → redirect
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handlePopUp = (close:boolean) => {
    setNewPost(close)
  }

  if (loading) {
    return (
      <div className="home-root">
        <p>Loading…</p>
      </div>
    );
  }

  if (!authorized) {
    return <Navigate to="/auth" replace />;
  }

  return (
  <div className="home-root">
    <Header onSearch={(q: string) => setQuery(q)} />
    <main className="home-main">
      {query && <p className="home-query">Searching for: “{query}”</p>}

      {/* Post creation card */}
      <div className="create-post-card">
        <div className="create-post-header">
          <img
            src="/img/avatar-placeholder.png"
            alt="Your avatar"
            className="create-post-avatar"
          />
          <button
            className="create-post-trigger"
            onClick={() => handlePopUp(true)}
          >
            Start a post
          </button>
        </div>
      </div>
    </main>
    {newPost && (
      <NewPostPopUp handlePopUp={handlePopUp} />
    )}
  </div>
)
}
