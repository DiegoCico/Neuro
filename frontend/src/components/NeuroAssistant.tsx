// src/components/NeuroAssistant.tsx
import React, { useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { API_URL } from "../config";
import "../css/NeuroAssistant.css";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type Follower = {
  uid: string;
  fullName: string;
  slug: string;
  avatarUrl?: string | null;
  occupation?: string | null;
  interests?: string[] | null;
  skills?: string[] | null;
  tags?: string[] | null;
  topics?: string[] | null;
  headline?: string | null;
  bio?: string | null;
};

type GeminiSearchResponse = {
  occupation?: string | null;
  interest?: string | null;
  reason?: string;
  candidates?: Array<{ label: string; score?: number }>;
};

type Props = {
  followers: Follower[];
  onFocusOccupation: (occ: string | null) => void;
  onSelectInterest: (interest: string | null) => void;
  /** Start closed by default */
  defaultCollapsed?: boolean;
  /** Layer above canvas controls */
  zIndex?: number;
  /** Optional prefill (e.g., pasted recruiter JD) */
  recruiterText?: string;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const OCC_DEFAULT = "Other";

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

/** Derive interests from various fields for robust fallback matching */
function deriveInterests(f: Follower): string[] {
  const out: string[] = [];
  const pushArr = (arr?: unknown) => {
    if (Array.isArray(arr)) for (const it of arr) {
      const s = String(it || "").trim();
      if (s) out.push(s);
    }
  };
  pushArr(f.interests);
  pushArr(f.skills);
  pushArr(f.tags);
  pushArr(f.topics);

  const txt = [f.headline, f.bio, f.occupation].filter(Boolean).join(" ").toLowerCase();
  const kw = [
    "react","next.js","vue","angular",
    "node","express","django","flask",
    "python","typescript","javascript","go","rust","java","kotlin",
    "aws","gcp","azure","kubernetes","docker","terraform",
    "postgres","mysql","mongodb","redis",
    "ml","ai","llm","pytorch","tensorflow","sklearn","nlp",
    "figma","ux","ui",
    "security","sre","devops","platform",
    "product","pm"
  ];
  for (const k of kw) if (txt.includes(k)) out.push(k);

  if (out.length === 0 && f.occupation) {
    const bits = f.occupation.split(/[,/|•·\-]+/).map((s) => s.trim()).filter(Boolean);
    out.push(...bits.slice(0, 3));
  }

  return Array.from(new Set(out.map(titleCase))).slice(0, 40);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s+.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Light synonym net to catch “similar not exact” matches */
const SYN: Record<string, string[]> = {
  backend: ["server", "api", "microservices", "distributed", "scalable", "rest", "grpc"],
  frontend: ["react", "next", "ui", "ux", "javascript", "typescript"],
  devops: ["kubernetes", "docker", "terraform", "cicd", "sre", "platform", "infrastructure"],
  data: ["ml", "ai", "analytics", "etl", "pipeline", "pytorch", "tensorflow", "sklearn", "nlp"],
  cloud: ["aws", "gcp", "azure"],
  product: ["pm", "roadmap", "discovery", "requirements", "spec"],
  security: ["infosec", "iam", "oauth", "owasp", "threat", "detection"],
};

function expandTokens(tokens: string[]): string[] {
  const out = new Set<string>(tokens);
  for (const t of tokens) {
    for (const [k, vals] of Object.entries(SYN)) {
      if (t === k || vals.includes(t)) {
        out.add(k);
        vals.forEach((v) => out.add(v));
      }
    }
  }
  return Array.from(out);
}

function scoreText(qTokens: string[], target: string): number {
  const targetTokens = expandTokens(tokenize(target));
  let score = 0;
  for (const qt of qTokens) {
    if (targetTokens.includes(qt)) score += 2; // direct hit
    else if (targetTokens.some((t) => t.includes(qt) || qt.includes(t))) score += 1; // fuzzy
  }
  return score;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function NeuroAssistant({
  followers,
  onFocusOccupation,
  onSelectInterest,
  defaultCollapsed = true,
  zIndex = 24,
  recruiterText = "",
}: Props) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const [prompt, setPrompt] = useState("");
  const [notes, setNotes] = useState(recruiterText);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Build occupations + interest tallies (for local fallback and optional context)
  const { occs, interestsByOcc } = useMemo(() => {
    const byOcc: Record<string, Follower[]> = {};
    for (const f of followers) {
      const occ = normalizeOcc(f.occupation);
      (byOcc[occ] ||= []).push(f);
    }
    const occs = Object.keys(byOcc).sort();

    const interestsByOcc: Record<string, { label: string; count: number }[]> = {};
    for (const o of occs) {
      const tally: Record<string, number> = {};
      for (const f of byOcc[o]) {
        for (const lbl of deriveInterests(f)) {
          tally[lbl] = (tally[lbl] || 0) + 1;
        }
      }
      let list = Object.entries(tally)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      if (list.length === 0) list = [{ label: "General", count: byOcc[o].length || 1 }];
      interestsByOcc[o] = list.slice(0, 64);
    }
    return { occs, interestsByOcc };
  }, [followers]);

  /* ----------------------------- Backend (Gemini) ---------------------------- */
  async function runGeminiSearch() {
    setErr(null);
    const q = prompt.trim();
    const extra = notes.trim();
    if (!q && !extra) {
      setErr("Describe the person you’re looking for, or paste the recruiter’s note.");
      return;
    }
    setRunning(true);
    try {
      const token = await getAuth().currentUser?.getIdToken?.();
      const res = await fetch(`${API_URL}/api/ai/gemini/neuro-search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: q,
          recruiterText: extra,
          // Helpful grounding (optional for your backend):
          context: { occupations: occs, interestsByOcc },
        }),
      });

      if (res.ok) {
        const data: GeminiSearchResponse = await res.json();
        if (data?.occupation) {
          onFocusOccupation(data.occupation || null);
          onSelectInterest(data.interest || null);
          setOpen(false);
          setRunning(false);
          return;
        }
      }

      // Fallback if backend doesn’t provide a usable answer
      localFallback(q, extra);
    } catch (e: any) {
      // Network/server error → fallback
      localFallback(q, extra);
    } finally {
      setRunning(false);
    }
  }

  /* -------------------------------- Fallback -------------------------------- */
  function localFallback(q: string, extra: string) {
    const best = localSemanticMatch(q, extra, occs, interestsByOcc);
    if (best) {
      onFocusOccupation(best.occ);
      onSelectInterest(best.interest ?? null);
      setOpen(false);
    } else {
      setErr("No strong matches found. Add 2–3 skills or responsibilities and try again.");
    }
  }

  function localSemanticMatch(
    userPrompt: string,
    recruiter: string,
    occsList: string[],
    interestsMap: Record<string, { label: string; count: number }[]>
  ): { occ: string; interest?: string } | null {
    const qTokens = expandTokens(tokenize(`${userPrompt}\n${recruiter}`));
    if (!qTokens.length || !occsList.length) return null;

    // Choose best occupation by combined score of name + popular interests
    let bestOcc = occsList[0];
    let bestOccScore = -1;
    for (const o of occsList) {
      let s = scoreText(qTokens, o);
      for (const it of (interestsMap[o] || []).slice(0, 24)) {
        s += scoreText(qTokens, it.label) * Math.max(1, Math.log2(1 + it.count));
      }
      if (s > bestOccScore) {
        bestOccScore = s;
        bestOcc = o;
      }
    }

    // Pick closest interest within the chosen occupation
    const list = interestsMap[bestOcc] || [];
    let bestInterest = list[0]?.label;
    let bestI = -1;
    for (const it of list) {
      const s = scoreText(qTokens, it.label) * Math.max(1, Math.log2(1 + it.count));
      if (s > bestI) {
        bestI = s;
        bestInterest = it.label;
      }
    }
    return { occ: bestOcc, interest: bestInterest || undefined };
  }

  /* --------------------------------- Render --------------------------------- */
  return (
    <div
      className="na-scope"
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        zIndex,
        display: "grid",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {/* Panel */}
      <div className={`na-panel ${open ? "is-open" : ""}`} style={{ pointerEvents: open ? "auto" : "none" }} role="dialog" aria-label="Neuro Assistant">
        <div className="na-head">
          <div className="na-title">Neuro Assistant</div>
          <button className="na-x" onClick={() => setOpen(false)} aria-label="Close assistant">×</button>
        </div>

        <div className="na-body">
          <label className="na-label">Describe the person/character</label>
          <textarea
            className="na-input"
            placeholder='e.g., "Backend SWE, Go/Java, AWS, microservices, high-scale"'
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
          />
          <label className="na-label" style={{ marginTop: 8 }}>Recruiter’s note (optional)</label>
          <textarea
            className="na-input ghost"
            placeholder="Paste the JD blurb or recruiter message here…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
          {err && <div className="na-err">{err}</div>}

          <div className="na-actions">
            <button className="na-btn solid" onClick={runGeminiSearch} disabled={running} aria-busy={running}>
              {running ? "Asking Gemini…" : "Ask Gemini"}
            </button>
            <button
              className="na-btn ghost"
              onClick={() => {
                setPrompt("Backend engineer with Go or Java, AWS, microservices, distributed systems, Kubernetes.");
                setNotes("Owns scalable services, CI/CD, SRE collaboration, IaC a plus.");
              }}
              disabled={running}
            >
              Example
            </button>
          </div>
        </div>
      </div>

      {/* Floating AI FAB */}
      <button
        className={`na-fab ${open ? "is-open" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="Open Neuro Assistant"
        title="Neuro Assistant"
        style={{ pointerEvents: "auto" }}
      >
        <span className="na-fab-icon">AI</span>
      </button>
    </div>
  );
}
