// src/pages/MessagesScreen.tsx
import React, { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/Header";
import { getAuth } from "firebase/auth";
import { getFirestore, collection, doc, onSnapshot, query, orderBy } from "firebase/firestore";
import { API_URL } from "../config";
import "../css/MessagesScreen.css";

type SearchItem = { id: string; fullName: string; slug: string; avatarUrl?: string | null };
type Msg = {
  id: string;
  from: string;
  to: string;
  text: string;
  createdAt?: any;
  createdAtMs?: number;
};
type PartnerProfile = { uid: string; fullName: string; avatarUrl?: string | null; slug?: string };

function convIdFor(a: string, b: string) {
  return [a, b].sort().join("__");
}

export default function MessagesScreen() {
  const loc = useLocation();
  const auth = getAuth();
  const user = auth.currentUser;
  const myUid = user?.uid ?? null;

  // Left pane
  const [partners, setPartners] = useState<string[]>([]);
  const [partnerProfiles, setPartnerProfiles] = useState<PartnerProfile[]>([]);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [partnersErr, setPartnersErr] = useState<string | null>(null);

  // Search (same logic as Header)
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  // Right pane
  const [peer, setPeer] = useState<string>("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState(false); // NEW: AI button state

  // Thread ref for auto-scroll
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Deep link ?peer=<uid>
  useEffect(() => {
    const s = new URLSearchParams(loc.search);
    const p = (s.get("peer") || "").trim();
    if (p) setPeer(p);
  }, [loc.search]);

  // Load partners
  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!myUid) return;
      setLoadingPartners(true);
      setPartnersErr(null);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error("Not authenticated");
        const res = await fetch(`${API_URL}/api/messages/partners`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to load partners");
        if (isMounted) {
          const list: string[] = data.partners || [];
          setPartners(list);
          hydratePartners(list);
        }
      } catch (e: any) {
        if (isMounted) setPartnersErr(e?.message || "Failed to load partners");
      } finally {
        if (isMounted) setLoadingPartners(false);
      }
    }
    load();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid]);

  // Hydrate partner UIDs => full profile (parallelized)
  async function hydratePartners(uids: string[]) {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token || !uids.length) return;

      const results = await Promise.all(
        uids.map(async (uid) => {
          try {
            const r = await fetch(`${API_URL}/api/profile/by-uid/${uid}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!r.ok) return null;
            const data = await r.json();
            const p = data?.profile;
            if (!data?.ok || !p) return null;
            const fullName =
              p.fullName ||
              [p.firstName, p.lastName].filter(Boolean).join(" ").trim() ||
              uid;
            return {
              uid,
              fullName,
              avatarUrl: p.avatarUrl || null,
              slug: p.slug,
            } as PartnerProfile;
          } catch {
            return null;
          }
        })
      );

      setPartnerProfiles(results.filter(Boolean) as PartnerProfile[]);
    } catch (e) {
      console.error("hydratePartners error:", e);
    }
  }

  // Live subscribe to current conversation (ordered by time)
  useEffect(() => {
    if (!myUid || !peer) {
      setMsgs([]);
      return;
    }
    const db = getFirestore();
    const convRef = doc(collection(db, "conversations"), convIdFor(myUid, peer));
    const msgsCol = collection(convRef, "messages");

    const q = query(msgsCol, orderBy("createdAt", "asc"));

    const unsub = onSnapshot(q, (snap) => {
      const next: Msg[] = [];
      snap.forEach((d) => next.push({ id: d.id, ...(d.data() as any) }));
      setMsgs(next);
    });
    return () => unsub();
  }, [myUid, peer]);

  // Auto-scroll to bottom whenever messages change or peer switches
  useEffect(() => {
    if (!threadRef.current) return;
    requestAnimationFrame(() => {
      if (threadRef.current) {
        threadRef.current.scrollTop = threadRef.current.scrollHeight;
      }
    });
  }, [msgs, peer]);

  // Debounced user search
  useEffect(() => {
    if (!searchQ || searchQ.trim().length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const url = `${API_URL}/api/search/users?q=${encodeURIComponent(searchQ)}&limit=10`;
        const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
        if (!res.ok) throw new Error("search failed");
        const data = await res.json();
        const list: SearchItem[] = Array.isArray(data?.items) ? data.items : [];
        setSearchResults(list);
        setActiveIdx(0);
        setSearchOpen(list.length > 0);
      } catch {
        setSearchResults([]);
        setSearchOpen(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [searchQ]);

  function startChatWith(item: SearchItem) {
    setPeer(item.id);
    if (!partners.includes(item.id)) {
      const nextPartners = [item.id, ...partners];
      setPartners(nextPartners);
      // hydrate this one immediately for nicer UX
      setPartnerProfiles((cur) => [
        {
          uid: item.id,
          fullName: item.fullName || item.slug || item.id,
          avatarUrl: item.avatarUrl || null,
          slug: item.slug,
        },
        ...cur.filter((x) => x.uid !== item.id),
      ]);
    }
    setSearchQ("");
    setSearchResults([]);
    setSearchOpen(false);
  }

  async function handleSend() {
    if (!peer || !text.trim()) return;
    setSending(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/api/messages/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: peer, text }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to send");
      setText("");
      if (!partners.includes(peer)) {
        setPartners((p) => [peer, ...p]);
        hydratePartners([peer]);
      }
      // onSnapshot will render it; scroll effect will run after msgs updates
    } catch (e) {
      console.error("send error:", e);
    } finally {
      setSending(false);
    }
  }

  // NEW: one-click AI suggestion (fills input but does NOT send)
  async function handleAISuggest() {
    if (!peer || aiBusy) return;
    setAiBusy(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      const res = await fetch(`${API_URL}/api/ai/suggest-reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ partnerUid: peer }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "AI failed");
      const suggestion = (data.reply || "").trim();
      if (suggestion) {
        // If user already typed something, append with a space.
        setText((prev) => (prev && prev.trim().length ? `${prev.trim()} ${suggestion}` : suggestion));
      }
    } catch (e) {
      console.error("AI suggest error:", e);
    } finally {
      setAiBusy(false);
    }
  }

  const peerProfile = partnerProfiles.find((p) => p.uid === peer);

  return (
    <div className="messages-page">
      <Header />
      <div className="messages-wrap">
        {/* Left: conversations + search */}
        <aside className="msg-left">
          <div className="left-header">
            <strong>Messages</strong>
          </div>

          {/* Search users */}
          <div className="left-search">
            <input
              className="left-search-input"
              placeholder="Search people by name…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onFocus={() => setSearchOpen(searchResults.length > 0)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
              aria-label="Search users"
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="left-search-pop" role="listbox" aria-label="Search results">
                {searchResults.map((it, i) => (
                  <button
                    key={it.id}
                    className={`left-search-item ${i === activeIdx ? "is-active" : ""}`}
                    role="option"
                    aria-selected={i === activeIdx}
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => startChatWith(it)}
                    type="button"
                  >
                    <img
                      className="left-search-avatar"
                      src={it.avatarUrl || "/img/avatar-placeholder.png"}
                      alt=""
                      aria-hidden
                      onError={(e) => ((e.target as HTMLImageElement).src = "/img/avatar-placeholder.png")}
                    />
                    <div className="left-search-meta">
                      <div className="left-search-name">{it.fullName}</div>
                      <div className="left-search-sub">@{it.slug}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Partner list */}
          <div className="left-body">
            {loadingPartners ? (
              <div className="muted">Loading…</div>
            ) : partnersErr ? (
              <div className="muted err">{partnersErr}</div>
            ) : partnerProfiles.length === 0 ? (
              <div className="muted">No conversations yet. Search someone to start.</div>
            ) : (
              partnerProfiles.map((p) => (
                <button
                  key={p.uid}
                  type="button"
                  onClick={() => setPeer(p.uid)}
                  className={`partner-item ${peer === p.uid ? "is-active" : ""}`}
                >
                  <img
                    className="avatar"
                    src={p.avatarUrl || "/img/avatar-placeholder.png"}
                    alt=""
                    onError={(e) => ((e.target as HTMLImageElement).src = "/img/avatar-placeholder.png")}
                  />
                  <div className="partner-text">
                    <div className="partner-name">{p.fullName}</div>
                    <div className="partner-sub">@{p.slug || p.uid}</div>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="left-footer">
            <div className="subtle">Signed in as</div>
            <div className="me-uid">{myUid || "—"}</div>
          </div>
        </aside>

        {/* Right: thread */}
        <main className="msg-right">
          <div className="right-header">
            <div className="right-peer">
              <img
                className="avatar"
                src={peerProfile?.avatarUrl || "/img/avatar-placeholder.png"}
                alt=""
                onError={(e) => ((e.target as HTMLImageElement).src = "/img/avatar-placeholder.png")}
              />
              <div>
                <div className="right-title">
                  {peer ? peerProfile?.fullName || peer : "Start a new conversation"}
                </div>
                <div className="subtle">
                  {peer ? "Live thread" : "Search someone on the left to begin"}
                </div>
              </div>
            </div>
          </div>

          {!peer ? (
            <div className="new-chat-empty">Pick someone from search to start chatting.</div>
          ) : (
            <>
              <div className="thread" id="thread" ref={threadRef}>
                {msgs.length === 0 ? (
                  <div className="muted">No messages yet.</div>
                ) : (
                  msgs.map((m) => {
                    const mine = m.from === myUid;
                    return (
                      <div
                        key={m.id}
                        className={`bubble-row ${mine ? "mine" : "theirs"}`}
                      >
                        <div className={`bubble ${mine ? "bubble-mine" : "bubble-theirs"}`}>
                          {m.text}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="composer">
                <input
                  className="composer-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && text.trim() && !sending) handleSend();
                  }}
                  placeholder="Write a message…"
                  disabled={!peer || sending}
                />
                {/* NEW: AI button (inserts suggestion, does not send) */}
                <button
                  className="ai-btn"
                  type="button"
                  onClick={handleAISuggest}
                  disabled={!peer || aiBusy || sending}
                  title="Suggest a reply"
                >
                  {aiBusy ? "AI…" : "AI"}
                </button>

                <button
                  className="send-btn"
                  onClick={handleSend}
                  disabled={!peer || !text.trim() || sending}
                >
                  Send
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
