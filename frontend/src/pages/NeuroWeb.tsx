// src/pages/NeuroWeb.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { API_URL } from "../config";
import Header from "../components/Header";
import "../css/NeuroWeb.css";
import NeuroAssistant from "../components/NeuroAssistant";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type Follower = {
  uid: string;
  fullName: string;
  slug: string;
  avatarUrl?: string | null;
  occupation?: string | null;
  // Any of these may or may not exist in your data:
  interests?: string[] | null;
  skills?: string[] | null;
  tags?: string[] | null;
  topics?: string[] | null;
  headline?: string | null;
  bio?: string | null;
};

type NetworkResponse = {
  items: Follower[];
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const OCC_DEFAULT = "Other";

/** Canonicalize occupation into a few buckets */
function normalizeOcc(s?: string | null): string {
  if (!s) return OCC_DEFAULT;
  const t = s.trim();
  if (!t) return OCC_DEFAULT;
  const low = t.toLowerCase();
  if (/(software|swe|developer|engineer|full\s*stack|backend|frontend)/.test(low)) return "Software Engineer";
  if (/(data|ml|ai|analytics|scientist|bi|machine learning)/.test(low)) return "Data / AI";
  if (/(design|ux|ui|product design)/.test(low)) return "Design";
  if (/(product\s*manager|pm|product\s*owner)/.test(low)) return "Product";
  if (/(devops|infra|platform|site reliability|sre|cloud)/.test(low)) return "DevOps / Infra";
  if (/(security|infosec)/.test(low)) return "Security";
  if (/(student|intern)/.test(low)) return "Student / Intern";
  if (/(founder|ceo|cto|coo|startup)/.test(low)) return "Founder";
  // Title case unknowns
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

/** Derive interests from many possible places (robust fallback). */
function deriveInterests(f: Follower): string[] {
  const out: string[] = [];

  const pushAll = (arr?: unknown) => {
    if (Array.isArray(arr)) {
      for (const it of arr) {
        const s = String(it || "").trim();
        if (s) out.push(s);
      }
    }
  };

  pushAll(f.interests);
  pushAll(f.skills);
  pushAll(f.tags);
  pushAll(f.topics);

  // Mine free text fields for common tech keywords
  const txt = [f.headline, f.bio, f.occupation].filter(Boolean).join(" ").toLowerCase();
  const kw = [
    "react", "next.js", "vue", "angular",
    "node", "express", "django", "flask",
    "python", "typescript", "javascript", "go", "rust", "java", "kotlin",
    "aws", "gcp", "azure", "kubernetes", "docker", "terraform",
    "postgres", "mysql", "mongodb", "redis",
    "ml", "ai", "llm", "pytorch", "tensorflow", "sklearn", "nlp",
    "figma", "ux", "ui",
    "security", "sre", "devops", "platform",
    "product", "pm"
  ];
  for (const k of kw) {
    if (txt.includes(k)) out.push(k);
  }

  // If still nothing, try splitting occupation words (lightly)
  if (out.length === 0 && f.occupation) {
    const occBits = f.occupation.split(/[,/|•·\-]+/).map((s) => s.trim()).filter(Boolean);
    out.push(...occBits.slice(0, 3));
  }

  // Normalize to Title Case & unique
  const norm = Array.from(new Set(out.map(titleCase))).slice(0, 40);
  return norm;
}

function byLabel(a: { label: string; count: number }, b: { label: string; count: number }) {
  return b.count - a.count || a.label.localeCompare(b.label);
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

type Node =
  | { id: string; kind: "internet"; x: number; y: number; r: number }
  | { id: string; kind: "occ"; x: number; y: number; r: number; occ: string }
  | { id: string; kind: "interest"; x: number; y: number; r: number; occ: string; label: string; count: number };

type Edge = { a: string; b: string; cls: "edge-core" | "edge-branch" };

function computeLayout(
  occs: string[],
  interestsByOcc: Record<string, { label: string; count: number }[]>,
  width: number,
  height: number
) {
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.32; // occupation ring radius

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({ id: "internet", kind: "internet", x: cx, y: cy, r: 48 });

  const n = Math.max(occs.length, 1);
  const occPos: Record<string, { x: number; y: number }> = {};

  occs.forEach((o, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2; // start at top
    const ox = cx + R * Math.cos(ang);
    const oy = cy + R * Math.sin(ang);
    occPos[o] = { x: ox, y: oy };
    nodes.push({ id: `occ:${o}`, kind: "occ", x: ox, y: oy, r: 30, occ: o });
    edges.push({ a: "internet", b: `occ:${o}`, cls: "edge-core" });

    const interests = interestsByOcc[o] || [];
    const perRing = 16;
    const base = 86;

    interests.forEach((it, idx) => {
      const ring = Math.floor(idx / perRing);
      const pos = idx % perRing;
      const lr = base + ring * 52; // ring radius around occupation
      const th = (pos / perRing) * Math.PI * 2 + ring * 0.35; // slight rotation per ring
      const ix = ox + lr * Math.cos(th);
      const iy = oy + lr * Math.sin(th);

      // size by popularity (min 10, max ~26)
      const r = 10 + Math.min(16, Math.round(Math.log2(1 + it.count) * 6));
      nodes.push({ id: `interest:${o}:${it.label}`, kind: "interest", x: ix, y: iy, r, occ: o, label: it.label, count: it.count });
      edges.push({ a: `occ:${o}`, b: `interest:${o}:${it.label}`, cls: "edge-branch" });
    });
  });

  return { nodes, edges, occPos, center: { x: cx, y: cy } };
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function NeuroWeb() {
  const navigate = useNavigate();

  // Data
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Viewbox / pan & zoom
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1200, h: 720 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrig = useRef({ x: 0, y: 0 });

  // Focus & filters
  const [focusOcc, setFocusOcc] = useState<string | null>(null);
  const [selectedInterest, setSelectedInterest] = useState<string | null>(null);

  // Fetch followers (requires Firebase ID token)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const token = await getAuth().currentUser?.getIdToken?.();
        const res = await fetch(`${API_URL}/api/network/followers`, {
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) throw new Error(`Network ${res.status}`);
        const data: NetworkResponse = await res.json();
        if (!cancelled) setFollowers(Array.isArray(data?.items) ? data.items : []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load network");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resize observer
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({ w: Math.max(640, e.contentRect.width), h: Math.max(420, e.contentRect.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Group by occupation and aggregate interests (with fallbacks)
  const { occs, peopleByOcc, countsByOcc, interestsByOcc } = useMemo(() => {
    const byOcc: Record<string, Follower[]> = {};
    for (const f of followers) {
      const occ = normalizeOcc(f.occupation);
      (byOcc[occ] ||= []).push(f);
    }
    const occs = Object.keys(byOcc).sort();

    const peopleByOcc: Record<string, Follower[]> = {};
    const countsByOcc: Record<string, number> = {};
    const interestsByOcc: Record<string, { label: string; count: number }[]> = {};

    for (const o of occs) {
      const people = [...byOcc[o]].sort((a, b) => a.fullName.localeCompare(b.fullName));
      peopleByOcc[o] = people;
      countsByOcc[o] = people.length;

      const tally: Record<string, number> = {};
      for (const f of people) {
        const derived = deriveInterests(f);
        for (const label of derived) {
          tally[label] = (tally[label] || 0) + 1;
        }
      }
      let list = Object.entries(tally)
        .map(([label, count]) => ({ label, count }))
        .sort(byLabel);

      // Ensure at least one node so the spoke is visible
      if (list.length === 0) list = [{ label: "General", count: people.length || 1 }];

      // Cap to keep layout tidy
      interestsByOcc[o] = list.slice(0, 64);
    }

    return { occs, peopleByOcc, countsByOcc, interestsByOcc };
  }, [followers]);

  const layout = useMemo(() => computeLayout(occs, interestsByOcc, size.w, size.h), [occs, interestsByOcc, size]);

  /* ---------------------------- Pan & zoom handlers ---------------------------- */
  const onWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    e.preventDefault();
    const delta = -e.deltaY;
    const factor = Math.exp(delta * 0.0015);
    const next = Math.min(6, Math.max(0.3, zoom * factor));

    const rect = svgRef.current?.getBoundingClientRect();
    const mx = (e.clientX - (rect?.left ?? 0) - pan.x) / zoom;
    const my = (e.clientY - (rect?.top ?? 0) - pan.y) / zoom;

    const nx = e.clientX - (rect?.left ?? 0) - mx * next;
    const ny = e.clientY - (rect?.top ?? 0) - my * next;

    setZoom(next);
    setPan({ x: nx, y: ny });
  };

  const onPointerDown: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    panOrig.current = { ...pan };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPan({ x: panOrig.current.x + dx, y: panOrig.current.y + dy });
  };
  const onPointerUp: React.PointerEventHandler<SVGSVGElement> = () => {
    isPanning.current = false;
  };

  /* ----------------------------- Focus / fly-to API ---------------------------- */
  const flyTo = useCallback(
    (x: number, y: number, scale: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const vx = (rect?.width ?? size.w) / 2;
      const vy = (rect?.height ?? size.h) / 2;
      const targetPan = { x: vx - x * scale, y: vy - y * scale };

      const startPan = { ...pan };
      const startZoom = zoom;
      const duration = 450;
      const t0 = performance.now();

      function step(t: number) {
        const k = Math.min(1, (t - t0) / duration);
        const ease = 1 - Math.pow(1 - k, 3);
        setPan({
          x: startPan.x + (targetPan.x - startPan.x) * ease,
          y: startPan.y + (targetPan.y - startPan.y) * ease,
        });
        setZoom(startZoom + (scale - startZoom) * ease);
        if (k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    },
    [pan, zoom, size]
  );

  const focusOccupation = useCallback(
    (o: string | null) => {
      setFocusOcc(o);
      setSelectedInterest(null);
      if (!o) {
        const { center } = layout;
        flyTo(center.x, center.y, 1);
      } else {
        const pos = layout.occPos[o];
        if (pos) flyTo(pos.x, pos.y, 2.6);
      }
    },
    [layout, flyTo]
  );

  /* --------------------------------- Actions --------------------------------- */
  const navigateToAutomation = () => navigate("/automation");
  const navigateToNeuroWeb = () => navigate("/neuroweb"); // adjust if this page lives on a different path
  const goToProfile = (f: Follower) => navigate(`/u/${f.slug}`);
  const messageUser = (f: Follower) => navigate(`/messages?to=${encodeURIComponent(f.uid)}`);

  /* ----------------------------------- UI ------------------------------------ */
  return (
    <div className="neuroweb-root">
      <Header />

      {/* Toolbar sits *under* the header */}
      <div className="neuroweb-toolbar" role="toolbar" aria-label="NeuroWeb mode switch">
        <div className="neuroweb-toolbar-inner">
          <div className="neuroweb-toolbar-left">
            <button
              className="nw-btn solid"
              onClick={navigateToNeuroWeb}
              aria-pressed={true}
              title="Network visualization mode"
            >
              NeuroWeb
            </button>
            <button
              className="nw-btn ghost"
              onClick={navigateToAutomation}
              aria-pressed={false}
              title="Drag-and-drop autonomous outreach builder"
            >
              Autonomous
            </button>
          </div>

          <div className="neuroweb-toolbar-right">
            {focusOcc && (
              <div className="neuroweb-subtle">
                Focused on <strong className="neuroweb-strong">{focusOcc}</strong>
                {selectedInterest ? (
                  <>
                    {" "}
                    • filtered by <strong className="neuroweb-strong">{selectedInterest}</strong>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="neuroweb-grid">
        {/* Canvas */}
        <div ref={wrapRef} className="neuroweb-canvas-wrap">
          {loading && (
            <div className="neuroweb-center">
              <div className="neuroweb-muted">Loading your NeuroWeb…</div>
            </div>
          )}
          {error && (
            <div className="neuroweb-center">
              <div className="neuroweb-error">{error}</div>
            </div>
          )}

          <svg
            ref={svgRef}
            className="neuroweb-svg"
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {/* Arrowheads + glow filter */}
            <defs>
              <marker id="arrow-core" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                <path d="M0,0 L12,6 L0,12 z" fill="#d8d8d8" />
              </marker>
              <marker id="arrow-branch" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                <path d="M0,0 L12,6 L0,12 z" fill="#6cc7ff" />
              </marker>
              <filter id="interest-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              {/* edges */}
              <g>
                {layout.edges.map((e) => {
                  const a = layout.nodes.find((n) => n.id === e.a)!;
                  const b = layout.nodes.find((n) => n.id === e.b)!;
                  return (
                    <line
                      key={`${e.a}->${e.b}`}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      className={`neuroweb-edge ${e.cls}`}
                      markerEnd={`url(#${e.cls === "edge-core" ? "arrow-core" : "arrow-branch"})`}
                    />
                  );
                })}
              </g>

              {/* internet hub */}
              {(() => {
                const hub = layout.nodes.find((n) => n.kind === "internet") as Extract<Node, { kind: "internet" }>;
                return (
                  <g transform={`translate(${hub.x},${hub.y})`}>
                    <circle r={hub.r} className="neuroweb-node-internet" />
                    <text y={6} textAnchor="middle" className="neuroweb-node-label-internet">
                      Internet
                    </text>
                  </g>
                );
              })()}

              {/* occupation hubs */}
              {layout.nodes
                .filter((n) => n.kind === "occ")
                .map((n) => {
                  const occ = n as Extract<Node, { kind: "occ" }>;
                  return (
                    <g key={occ.id} transform={`translate(${occ.x},${occ.y})`}>
                      <circle
                        r={occ.r}
                        className={`neuroweb-node-occ ${focusOcc === occ.occ ? "is-focused" : ""}`}
                        onClick={() => focusOccupation(occ.occ)}
                      />
                      <text y={occ.r + 18} textAnchor="middle" className="neuroweb-node-label-occ">
                        {occ.occ}
                      </text>
                    </g>
                  );
                })}

              {/* interest nodes (distinct fill + glow) */}
              {layout.nodes
                .filter((n) => n.kind === "interest")
                .map((n) => {
                  const it = n as Extract<Node, { kind: "interest" }>;
                  const dim = Boolean(focusOcc && it.occ !== focusOcc);
                  const active = focusOcc === it.occ && selectedInterest === it.label;
                  return (
                    <g key={it.id} transform={`translate(${it.x},${it.y})`}>
                      <circle
                        r={it.r + 3}
                        fill="#1386ff55"
                        filter="url(#interest-glow)"
                        style={{ opacity: dim ? 0.25 : 0.6 }}
                      />
                      <circle
                        r={it.r}
                        className={`neuroweb-node-interest ${dim ? "is-dim" : ""} ${active ? "is-active" : ""}`}
                        onClick={() => {
                          if (focusOcc === it.occ) {
                            setSelectedInterest((cur) => (cur === it.label ? null : it.label));
                          } else {
                            focusOccupation(it.occ);
                            setSelectedInterest(it.label);
                          }
                        }}
                      />
                      <text y={it.r + 14} textAnchor="middle" className="neuroweb-node-label-interest">
                        {it.label}
                      </text>
                    </g>
                  );
                })}
            </g>
          </svg>

          {/* Floating controls */}
          <div className="neuroweb-controls">
            {focusOcc && (
              <button onClick={() => focusOccupation(null)} className="nw-btn" aria-label="Back to all occupations">
                ⟵ All occupations
              </button>
            )}
            <div className="neuroweb-zoom">
              <button onClick={() => setZoom((z) => Math.max(0.3, z * 0.88))} className="nw-icon-btn" aria-label="Zoom out">
                −
              </button>
              <button onClick={() => setZoom((z) => Math.min(6, z * 1.14))} className="nw-icon-btn" aria-label="Zoom in">
                +
              </button>
            </div>
          </div>
        </div>

        <NeuroAssistant
          followers={followers}
          onFocusOccupation={(occ) => focusOccupation(occ)}
          onSelectInterest={(interest) => {
            if (interest) setSelectedInterest(interest);
          }}
          recruiterText=""
        />

        {/* Right sidebar */}
        <aside className="neuroweb-aside">
          <div className="neuroweb-aside-head">
            <div>
              <div className="neuroweb-title">Your NeuroWeb</div>
              <div className="neuroweb-subtle">{followers.length} connections</div>
            </div>
          </div>

          {/* Occupations */}
          <div className="neuroweb-occs">
            {occs.map((o) => (
              <button
                key={o}
                onClick={() => focusOccupation(o)}
                className={`neuroweb-occ ${focusOcc === o ? "is-active" : ""}`}
                aria-pressed={focusOcc === o}
              >
                <div className="neuroweb-occ-title">{o}</div>
                <div className="neuroweb-occ-sub">{countsByOcc[o] ?? 0} people</div>
              </button>
            ))}
          </div>

          {/* People list for focused occupation (filterable by interest) */}
          <div className="neuroweb-people">
            <div className="neuroweb-people-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>People{focusOcc ? ` in ${focusOcc}` : ""}</span>
              {selectedInterest && (
                <button className="nw-btn ghost" onClick={() => setSelectedInterest(null)} aria-label="Clear interest filter">
                  Clear filter
                </button>
              )}
            </div>
            <div className="neuroweb-people-list">
              {focusOcc ? (
                (peopleByOcc[focusOcc] || [])
                  .filter((f) => !selectedInterest || deriveInterests(f).includes(selectedInterest))
                  .map((f) => (
                    <div key={f.uid} className="neuroweb-person">
                      <img
                        src={f.avatarUrl || "/img/avatar-placeholder.png"}
                        alt=""
                        width={32}
                        height={32}
                        className="neuroweb-avatar"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "/img/avatar-placeholder.png";
                        }}
                      />
                      <div className="neuroweb-person-main">
                        <div className="neuroweb-person-name">{f.fullName}</div>
                        <div className="neuroweb-person-sub">
                          {deriveInterests(f).slice(0, 3).join(" • ")}
                        </div>
                      </div>
                      <div className="neuroweb-person-actions">
                        <button onClick={() => goToProfile(f)} className="nw-btn ghost">
                          Profile
                        </button>
                        <button onClick={() => messageUser(f)} className="nw-btn solid">
                          Message
                        </button>
                      </div>
                    </div>
                  ))
              ) : (
                <div className="neuroweb-subtle" style={{ padding: 8 }}>
                  Select an occupation circle to see the people inside it.
                </div>
              )}
            </div>
          </div>

          {/* Top interests for focused occupation */}
          {focusOcc && (
            <div className="neuroweb-people" style={{ borderTop: "1px solid #2a2a2a" }}>
              <div className="neuroweb-people-head">Top interests in {focusOcc}</div>
              <div className="neuroweb-people-list">
                {(interestsByOcc[focusOcc] || []).slice(0, 24).map((it) => (
                  <div key={it.label} className="neuroweb-person" style={{ alignItems: "center" }}>
                    <div className="neuroweb-person-main">
                      <div className="neuroweb-person-name">{it.label}</div>
                      <div className="neuroweb-person-sub">{it.count} followers</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
