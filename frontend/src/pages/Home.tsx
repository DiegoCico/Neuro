// src/pages/Home.tsx
import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import "../css/Home.css";
import Header from "../components/Header";
import { fetchMe, type ProfileData } from "../userProfile";
import NewPostPopUp from "../components/NewPostPopUp";
import Post from "../components/Post";
import { API_URL } from "../config";
import { getAuth } from "firebase/auth";
import Avatar from "../components/Avatar"

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

export default function Home() {
  const [query, setQuery] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("User");
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(true);
  const [newPost, setNewPost] = useState(false)
  const [posts, setPosts] = useState<PostData[]>([])
  const [activeTab, setActiveTab] = useState<"quickconnect" | "posts">("posts")

  useEffect(() => {
    (async () => {
      try {
        const data: ProfileData = await fetchMe();
        if (data?.fullName) setFirstName(data.fullName);
        setAuthorized(true);
      } catch {
        setAuthorized(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    async function fetchPosts() {
      try {
        const res = await fetch(`${API_URL}/api/posts`)
        const data = await res.json()
        if (data.ok) {
          console.log(data)
          setPosts(data.posts)
        } else {
          console.error('Failed to fetch', data.error)
        }
      } catch (error) {
        console.error("Error fetching posts:", error);
      }
    }

    fetchPosts()
  }, [])

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

  const handleLikePost = async(postId:string) => {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return;

    const uid = user.uid;

    setPosts((prevPosts) =>
      prevPosts.map((post) =>
        post.id === postId
          ? {
              ...post,
              likes: post.likes.includes(uid)
                ? post.likes.filter((id) => id !== uid) 
                : [...post.likes, uid],
            }
          : post
      )
    );

    try {
      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) {
        console.error("Not logged in");
        return;
      }

      const token = await user.getIdToken();

      const res = await fetch(`${API_URL}/api/posts/like`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ postId }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        console.log("Post liked:", data);
      } else {
        console.error("Failed to like post:", data.error);
      }
    } catch (error) {
      console.log("Error liking post", error);
    }
  }

  return (
    <div className="home-root">
        <Header onSearch={(q: string) => setQuery(q)} />
        <main className="home-main">
          {/* Sidebar */}
          <div className="left-col">
            <div className="sidebar">
              <button
                className={`sidebar-btn ${
                  activeTab === "quickconnect" ? "active" : ""
                }`}
                onClick={() => setActiveTab("quickconnect")}
              >
                Quick Connect
              </button>
              <button
                className={`sidebar-btn ${activeTab === "posts" ? "active" : ""}`}
                onClick={() => setActiveTab("posts")}
              >
                Posts
              </button>
            </div>
          </div>

          {/* Right content */}
          <div className="right-col">
            {activeTab === "quickconnect" && (
              <div className="quick-connect">
                <h2>Quick Connect</h2>
                
              </div>
            )}

            {activeTab === "posts" && (
              <>
                {query && (
                  <p className="home-query">Searching for: “{query}”</p>
                )}
                <div className="create-post-card">
                  <div className="create-post-header">
                    <Avatar name={firstName} size={32} />
                    <button
                      className="create-post-trigger"
                      onClick={() => handlePopUp(true)}
                    >
                      Start a post
                    </button>
                  </div>
                </div>
                {posts.map((post) => (
                  <Post
                    key={post.id}
                    id={post.id}
                    userId={post.userId}
                    userFullName={post.userFullName}
                    text={post.text}
                    mediaUrl={post.mediaUrl}
                    createdAt={post.createdAt}
                    likes={post.likes}
                    commentsCount={post.commentsCount}
                    handleLikePost={handleLikePost}
                  />
                ))}
              </>
            )}
          </div>
        </main>
        {newPost && <NewPostPopUp handlePopUp={handlePopUp} />}
      </div>
    )
}
