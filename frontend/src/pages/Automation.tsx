// src/pages/automation.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuth } from "firebase/auth";
import { API_URL } from "../config";
import Header from "../components/Header";
import "../css/Automation.css";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type Point = { x: number; y: number };

type BlockType =
  | "audience"      // pick people to contact
  | "message"       // send message template
  | "wait"          // wait N hours/days
  | "branch"        // branch by reply (yes/no/keyword/LLM sentiment)
  | "meet"          // create a Google Meet and send invite
  | "parallel"      // split into parallel subflows (Agent2Agent style)
  | "loop"          // continuous loop (polling/cron-like)
  | "agent"         // dispatch to sub-agent (A2A)
  | "end";

type Block = {
  id: string;
  kind: BlockType;
  title: string;
  pos: Point;
  config?: Record<string, any>;
};

type Edge = { from: string; to: string; label?: string };

type AudiencePerson = {
  uid: string;
  fullName: string;
  slug?: string;
  avatarUrl?: string | null;
  occupation?: string | null;
  email?: string | null;
};

type RunContext = {
  token?: string | null;
  log: (m: string) => void;
  cancelledRef: React.MutableRefObject<boolean>;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const genId = () => Math.random().toString(36).slice(2, 10);

function blockDefaults(kind: BlockType): Partial<Block["config"]> {
  switch (kind) {
    case "audience":
      return { source: "followers", filter: { occupation: null, interest: null }, sample: 50 };
    case "message":
      return { channel: "neuro_dm", subject: "Quick hello 👋", body: "Hi {{name}}, I loved your work on {{interest}}…" };
    case "wait":
      return { unit: "hours", amount: 24 };
    case "branch":
      return {
        mode: "keyword", // "keyword" | "yesno" | "llm"
        cases: [
          { label: "Interested", match: "yes, interested", toLabel: "yes" },
          { label: "Not now", match: "later|busy", toLabel: "later" },
          { label: "No", match: "no|not interested", toLabel: "no" },
        ],
        defaultToLabel: "default",
      };
    case "meet":
      return { title: "Intro chat", durationMins: 30, timezone: "America/New_York", when: "auto", startAtISO: null };
    case "parallel":
      return { branches: 2 };
    case "agent":
      return { name: "lead-qualifier", goal: "Summarize profile and suggest next best action." };
    case "loop":
      return { everyMins: 10, maxIterations: 100 };
    default:
      return {};
  }
}

function within(p: Point, q: Point, r = 16) {
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  return dx * dx + dy * dy <= r * r;
}

/* -------------------------------------------------------------------------- */
/* Minimal “ADK/A2A” Facade (stubs to your backend)                           */
/* -------------------------------------------------------------------------- */

async function adkAnalyzeReply(ctx: RunContext, messageText: string) {
  try {
    const res = await fetch(`${API_URL}/api/agents/adk/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      },
      body: JSON.stringify({ text: messageText }),
    });
    if (!res.ok) throw new Error(`ADK analyze ${res.status}`);
    return await res.json(); // { sentiment, intent }
  } catch (e) {
    ctx.log(`ADK analyze failed: ${(e as Error).message}`);
    return { sentiment: "neutral", intent: "unknown" };
  }
}

async function a2aDispatch(ctx: RunContext, name: string, payload: any) {
  try {
    const res = await fetch(`${API_URL}/api/agents/a2a/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      },
      body: JSON.stringify({ agent: name, payload }),
    });
    if (!res.ok) throw new Error(`A2A ${res.status}`);
    return await res.json(); // { result }
  } catch (e) {
    ctx.log(`A2A dispatch failed: ${(e as Error).message}`);
    return { result: null };
  }
}

async function scheduleGoogleMeet(ctx: RunContext, opts: { title: string; startAtISO: string; durationMins: number; attendees: string[] }) {
  try {
    const res = await fetch(`${API_URL}/api/google/meet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      },
      body: JSON.stringify(opts),
    });
    if (!res.ok) throw new Error(`Meet ${res.status}`);
    return await res.json(); // { meetUrl, calendarId, eventId }
  } catch (e) {
    ctx.log(`Google Meet scheduling failed: ${(e as Error).message}`);
    return { meetUrl: null };
  }
}

async function sendOutreach(ctx: RunContext, channel: string, toUid: string, subject: string, body: string) {
  try {
    const res = await fetch(`${API_URL}/api/agents/outreach/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      },
      body: JSON.stringify({ channel, toUid, subject, body }),
    });
    if (!res.ok) throw new Error(`Send ${res.status}`);
    return await res.json(); // { ok: true }
  } catch (e) {
    ctx.log(`Send failed: ${(e as Error).message}`);
    return { ok: false };
  }
}

/* -------------------------------------------------------------------------- */
/* Autonomous Runner (supports loop + parallel)                                */
/* -------------------------------------------------------------------------- */

function useRunner(blocks: Block[], edges: Edge[]) {
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, [blocks, edges]);

  const run = useCallback(
    async (audience: AudiencePerson[], log: (m: string) => void) => {
      const token = await getAuth().currentUser?.getIdToken?.();
      const ctx: RunContext = { token, log, cancelledRef };

      const incomingMap = new Map<string, number>();
      edges.forEach((e) => incomingMap.set(e.to, (incomingMap.get(e.to) || 0) + 1));
      const start =
        blocks.find((b) => b.kind === "audience") ||
        blocks.find((b) => (incomingMap.get(b.id) || 0) === 0) ||
        blocks[0];

      if (!start) {
        log("No blocks to run.");
        return;
      }

      const hasLoop = blocks.some((b) => b.kind === "loop");
      const loopCfg = blocks.find((b) => b.kind === "loop")?.config as any;
      const everyMins = loopCfg?.everyMins ?? 10;
      const maxIter = loopCfg?.maxIterations ?? 100;

      let iter = 0;
      do {
        iter++;
        log(`— Run iteration ${iter}${hasLoop ? " (loop)" : ""} —`);
        await executeFrom(start, audience, ctx, blocks, edges);
        if (!hasLoop || iter >= maxIter || cancelledRef.current) break;
        log(`Sleeping ${everyMins} minute(s) before next iteration…`);
        await sleepMinutes(everyMins, cancelledRef);
      } while (!cancelledRef.current);

      log("Runner finished.");
    },
    [blocks, edges]
  );

  const stop = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  return { run, stop };
}

async function sleepMinutes(mins: number, cancelledRef: React.MutableRefObject<boolean>) {
  const ms = mins * 60 * 1000;
  const step = 500;
  let t = 0;
  while (t < ms && !cancelledRef.current) {
    await new Promise((r) => setTimeout(r, step));
    t += step;
  }
}

function successors(edges: Edge[], id: string) {
  return edges.filter((e) => e.from === id).map((e) => e.to);
}

async function executeFrom(
  block: Block,
  audience: AudiencePerson[],
  ctx: RunContext,
  blocks: Block[],
  edges: Edge[]
): Promise<void> {
  if (ctx.cancelledRef.current) return;

  const getBlock = (id: string) => blocks.find((b) => b.id === id);

  switch (block.kind) {
    case "audience": {
      const cfg = (block.config || {}) as any;
      const sample = Math.max(1, Math.min(cfg.sample ?? 50, audience.length));
      const people = audience.slice(0, sample);
      ctx.log(`Audience: ${people.length} people selected.`);
      for (const toId of successors(edges, block.id)) {
        const next = getBlock(toId);
        if (next) await executeFrom(next, people, ctx, blocks, edges);
      }
      break;
    }

    case "message": {
      const cfg = (block.config || {}) as any;
      ctx.log(`Message: ${cfg.subject || "(no subject)"}`);
      await Promise.all(
        audience.map(async (p) => {
          const sub = (cfg.subject || "").replaceAll("{{name}}", p.fullName || "there");
          const body = (cfg.body || "").replaceAll("{{name}}", p.fullName || "there");
          await sendOutreach(ctx, cfg.channel || "neuro_dm", p.uid, sub, body);
        })
      );
      for (const toId of successors(edges, block.id)) {
        const next = getBlock(toId);
        if (next) await executeFrom(next, audience, ctx, blocks, edges);
      }
      break;
    }

    case "wait": {
      const cfg = (block.config || {}) as any;
      const amt = Number(cfg.amount || 24);
      const unit = String(cfg.unit || "hours");
      const mins = unit === "days" ? amt * 24 * 60 : amt * 60;
      ctx.log(`Wait: ${amt} ${unit}…`);
      await sleepMinutes(mins, ctx.cancelledRef);
      for (const toId of successors(edges, block.id)) {
        const next = getBlock(toId);
        if (next) await executeFrom(next, audience, ctx, blocks, edges);
      }
      break;
    }

    case "branch": {
      const cfg = (block.config || {}) as any;
      ctx.log(`Branch by ${cfg.mode}…`);
      const groups: Record<string, AudiencePerson[]> = {};
      for (const person of audience) {
        const fakeReply = "";
        let label = cfg.defaultToLabel || "default";
        if (cfg.mode === "keyword") {
          const hit = (cfg.cases || []).find((c: any) => new RegExp(c.match, "i").test(fakeReply));
          label = hit?.toLabel || label;
        } else if (cfg.mode === "yesno") {
          label = /yes|interested/i.test(fakeReply) ? "yes" : /no|not/i.test(fakeReply) ? "no" : "default";
        } else if (cfg.mode === "llm") {
          const res = await adkAnalyzeReply(ctx, fakeReply);
          label = res?.intent || label;
        }
        (groups[label] ||= []).push(person);
      }
      const outs = edges.filter((e) => e.from === block.id);
      for (const e of outs) {
        const subset = groups[e.label || "default"] || [];
        if (subset.length === 0) continue;
        const next = getBlock(e.to);
        if (next) await executeFrom(next, subset, ctx, blocks, edges);
      }
      break;
    }

    case "meet": {
      const cfg = (block.config || {}) as any;
      ctx.log(`Scheduling Google Meet: ${cfg.title}`);
      const startAtISO =
        cfg.when === "manual" && cfg.startAtISO
          ? cfg.startAtISO
          : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const attendees = audience.map((p) => p.email).filter(Boolean) as string[];
      const res = await scheduleGoogleMeet(ctx, {
        title: cfg.title || "Intro chat",
        durationMins: Number(cfg.durationMins || 30),
        startAtISO,
        attendees,
      });
      ctx.log(res?.meetUrl ? `Meet created: ${res.meetUrl}` : "Meet creation failed.");
      for (const toId of successors(edges, block.id)) {
        const next = getBlock(toId);
        if (next) await executeFrom(next, audience, ctx, blocks, edges);
      }
      break;
    }

    case "parallel": {
      ctx.log("Parallel: spawning branches (Agent2Agent style)...");
      const outs = successors(edges, block.id);
      await Promise.all(
        outs.map(async (toId) => {
          const next = getBlock(toId);
          if (next) await executeFrom(next, audience, ctx, blocks, edges);
        })
      );
      break;
    }

    case "agent": {
      const cfg = (block.config || {}) as any;
      ctx.log(`A2A sub-agent "${cfg.name}" running…`);
      await Promise.all(audience.map((p) => a2aDispatch(ctx, cfg.name, { person: p, goal: cfg.goal })));
      for (const toId of successors(edges, block.id)) {
        const next = getBlock(toId);
        if (next) await executeFrom(next, audience, ctx, blocks, edges);
      }
      break;
    }

    case "loop": {
      for (const toId of successors(edges, block.id)) {
        const next = getBlock(toId);
        if (next) await executeFrom(next, audience, ctx, blocks, edges);
      }
      break;
    }

    case "end":
    default:
      ctx.log("Reached End.");
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* Autonomous Builder UI                                                      */
/* -------------------------------------------------------------------------- */

type PaletteItem = { kind: BlockType; title: string };

const PALETTE: PaletteItem[] = [
  { kind: "audience", title: "Audience" },
  { kind: "message", title: "Message" },
  { kind: "wait", title: "Wait" },
  { kind: "branch", title: "Branch" },
  { kind: "meet", title: "Google Meet" },
  { kind: "parallel", title: "Parallel" },
  { kind: "agent", title: "Sub-Agent" },
  { kind: "loop", title: "Loop" },
  { kind: "end", title: "End" },
];

function AutonomousBuilder() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([
    { id: genId(), kind: "audience", title: "Audience", pos: { x: 160, y: 160 }, config: blockDefaults("audience") },
  ]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [sel, setSel] = useState<string | null>(blocks[0]?.id ?? null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const { run, stop } = useRunner(blocks, edges);

  // Load audience from followers
  const [audience, setAudience] = useState<AudiencePerson[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const token = await getAuth().currentUser?.getIdToken?.();
        const res = await fetch(`${API_URL}/api/network/followers`, {
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        setAudience(
          items.map((f: any) => ({
            uid: f.uid,
            fullName: f.fullName,
            slug: f.slug,
            avatarUrl: f.avatarUrl,
            occupation: f.occupation,
            email: f.email,
          }))
        );
      } catch {
        // ignore
      }
    })();
  }, []);

  const log = useCallback((m: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${m}`].slice(-400));
  }, []);

  const onDropPalette: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("text/plain") as BlockType;
    if (!kind) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const x = e.clientX - (rect?.left || 0);
    const y = e.clientY - (rect?.top || 0);
    const b: Block = {
      id: genId(),
      kind,
      title: PALETTE.find((p) => p.kind === kind)?.title || kind,
      pos: { x, y },
      config: blockDefaults(kind),
    };
    setBlocks((prev) => [...prev, b]);
    setSel(b.id);
  };

  const onDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
  };

  const startLink = (id: string) => setLinkFrom(linkFrom === id ? null : id);
  const endLink = (toId: string) => {
    if (!linkFrom || linkFrom === toId) return;
    setEdges((prev) => [...prev, { from: linkFrom, to: toId }]);
    setLinkFrom(null);
  };

  const moveBlock = (id: string, to: Point) =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, pos: to } : b)));

  const selected = useMemo(() => blocks.find((b) => b.id === sel) || null, [blocks, sel]);

  const updateConfig = (patch: Record<string, any>) => {
    if (!selected) return;
    setBlocks((prev) =>
      prev.map((b) => (b.id === selected.id ? { ...b, config: { ...(b.config || {}), ...patch } } : b))
    );
  };

  const updateEdgeLabel = (edgeIdx: number, label: string) => {
    setEdges((prev) => prev.map((e, i) => (i === edgeIdx ? { ...e, label } : e)));
  };

  const runFlow = async () => {
    if (running) return;
    setLogs([]);
    setRunning(true);
    try {
      await run(audience, log);
    } finally {
      setRunning(false);
    }
  };

  const stopFlow = () => {
    stop();
    setRunning(false);
  };

  const removeSelected = () => {
    if (!selected) return;
    const id = selected.id;
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    setSel(null);
  };

  /* ---------------------------- Render helpers ---------------------------- */

  const edgeLines = edges
    .map((e, idx) => {
      const a = blocks.find((b) => b.id === e.from);
      const b = blocks.find((b) => b.id === e.to);
      if (!a || !b) return null;
      return (
        <g key={`${e.from}->${e.to}-${idx}`}>
          <line
            x1={a.pos.x}
            y1={a.pos.y}
            x2={b.pos.x}
            y2={b.pos.y}
            className="auto-edge edge-core"
            markerEnd="url(#auto-arrow)"
          />
          {e.label ? (
            <text
              x={(a.pos.x + b.pos.x) / 2}
              y={(a.pos.y + b.pos.y) / 2 - 6}
              className="auto-edge-label"
              textAnchor="middle"
            >
              {e.label}
            </text>
          ) : null}
        </g>
      );
    })
    .filter(Boolean);

  return (
    <div className="auto-grid">
      {/* Canvas */}
      <div
        className="auto-canvas-wrap"
        style={{
          backgroundImage:
            "radial-gradient(#1c1c1c 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        {/* SVG defs for arrows & drawn edges */}
        <svg className="auto-svg" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <defs>
            <marker id="auto-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
              <path d="M0,0 L12,6 L0,12 z" fill="#d8d8d8" />
            </marker>
          </defs>
          {edgeLines as any}
        </svg>

        {/* Palette */}
        <div className="auto-controls" style={{ top: 12, left: 12, gap: 6 }}>
          <div className="auto-title" style={{ marginBottom: 6 }}>Blocks</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxWidth: 540 }}>
            {PALETTE.map((p) => (
              <div
                key={p.kind}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", p.kind)}
                className="auto-btn"
                title={`Drag ${p.title}`}
              >
                {p.title}
              </div>
            ))}
          </div>
        </div>

        {/* Canvas drop zone */}
        <div
          ref={canvasRef}
          onDrop={onDropPalette}
          onDragOver={onDragOver}
          className="auto-dropzone"
        >
          {blocks.map((b) => (
            <DraggableBlock
              key={b.id}
              b={b}
              selected={sel === b.id}
              onSelect={() => setSel(b.id)}
              onMove={(pt) => moveBlock(b.id, pt)}
              onStartLink={() => startLink(b.id)}
              linkingFrom={linkFrom === b.id}
              onEndLink={() => endLink(b.id)}
            />
          ))}
        </div>

        {/* Runner controls */}
        <div className="auto-controls" style={{ bottom: 12, left: 12 }}>
          <button className="auto-btn solid" onClick={runFlow} disabled={running}>
            ▶ Run
          </button>
          <button className="auto-btn ghost" onClick={stopFlow} disabled={!running}>
            ■ Stop
          </button>
          <button className="auto-btn" onClick={removeSelected} disabled={!sel}>
            🗑 Delete Selected
          </button>
        </div>
      </div>

      {/* Right sidebar */}
      <aside className="auto-aside">
        <div className="auto-aside-head">
          <div>
            <div className="auto-title">Autonomous Builder</div>
            <div className="auto-subtle">{blocks.length} blocks • {edges.length} connections</div>
          </div>
        </div>

        {/* Selected block inspector */}
        {selected ? (
          <div className="auto-panel" style={{ marginBottom: 12 }}>
            <div className="auto-panel-head">{selected.title}</div>
            <div className="auto-panel-list" style={{ gap: 8 }}>
              <BlockInspector block={selected} update={updateConfig} edges={edges} updateEdgeLabel={updateEdgeLabel} />
            </div>
          </div>
        ) : (
          <div className="auto-subtle" style={{ padding: 8 }}>Select a block to configure.</div>
        )}

        {/* Logs */}
        <div className="auto-panel">
          <div className="auto-panel-head">Run Log</div>
          <div className="auto-panel-list" style={{ maxHeight: 220, overflow: "auto", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
            {logs.map((l, i) => (
              <div key={i} className="auto-subtle">{l}</div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function DraggableBlock(props: {
  b: Block;
  selected: boolean;
  onSelect: () => void;
  onMove: (p: Point) => void;
  onStartLink: () => void;
  linkingFrom: boolean;
  onEndLink: () => void;
}) {
  const { b, selected, onSelect, onMove, onStartLink, linkingFrom, onEndLink } = props;
  const dragging = useRef(false);
  const start = useRef<Point>({ x: 0, y: 0 });
  const orig = useRef<Point>({ x: 0, y: 0 });

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if ((e.target as HTMLElement).closest("button, input, textarea, select")) return;
    dragging.current = true;
    start.current = { x: e.clientX, y: e.clientY };
    orig.current = { ...b.pos };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    onMove({ x: orig.current.x + dx, y: orig.current.y + dy });
  };
  const onPointerUp: React.PointerEventHandler<HTMLDivElement> = () => {
    dragging.current = false;
  };

  return (
    <div
      className={`auto-card ${selected ? "is-active" : ""}`}
      style={{
        left: b.pos.x - 72,
        top: b.pos.y - 28,
      }}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onEndLink}
      title="Double-click to end a connection here"
    >
      <div className="auto-card-head">
        <div className="auto-card-title">{b.title}</div>
        <button
          className={`auto-icon-btn ${linkingFrom ? "is-active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onStartLink();
          }}
          title="Start connection"
        >
          ⟶
        </button>
      </div>
      <div className="auto-card-sub">{b.kind}</div>
    </div>
  );
}

function LabeledInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label className="auto-field">
      <span>{label}</span>
      <input {...rest} className="auto-input" />
    </label>
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label className="auto-field">
      <span>{label}</span>
      <textarea {...rest} className="auto-input" rows={5} />
    </label>
  );
}

function BlockInspector({
  block,
  update,
  edges,
  updateEdgeLabel,
}: {
  block: Block;
  update: (patch: Record<string, any>) => void;
  edges: Edge[];
  updateEdgeLabel: (edgeIdx: number, label: string) => void;
}) {
  const cfg = (block.config || {}) as any;

  if (block.kind === "audience") {
    return (
      <div className="auto-form">
        <LabeledInput label="Source" value={cfg.source || "followers"} onChange={(e) => update({ source: e.target.value })} />
        <LabeledInput label="Filter Occupation" value={cfg.filter?.occupation || ""} onChange={(e) => update({ filter: { ...(cfg.filter || {}), occupation: e.target.value || null } })} />
        <LabeledInput label="Filter Interest" value={cfg.filter?.interest || ""} onChange={(e) => update({ filter: { ...(cfg.filter || {}), interest: e.target.value || null } })} />
        <LabeledInput label="Sample Size" type="number" value={cfg.sample ?? 50} onChange={(e) => update({ sample: Number(e.target.value) })} />
      </div>
    );
  }

  if (block.kind === "message") {
    return (
      <div className="auto-form">
        <LabeledInput label="Channel" value={cfg.channel || "neuro_dm"} onChange={(e) => update({ channel: e.target.value })} />
        <LabeledInput label="Subject" value={cfg.subject || ""} onChange={(e) => update({ subject: e.target.value })} />
        <TextArea label="Body" value={cfg.body || ""} onChange={(e) => update({ body: e.target.value })} />
        <div className="auto-subtle">Templates support <code>{"{{name}}"}</code>.</div>
      </div>
    );
  }

  if (block.kind === "wait") {
    return (
      <div className="auto-form">
        <LabeledInput label="Amount" type="number" value={cfg.amount ?? 24} onChange={(e) => update({ amount: Number(e.target.value) })} />
        <LabeledInput label="Unit (hours/days)" value={cfg.unit || "hours"} onChange={(e) => update({ unit: e.target.value })} />
      </div>
    );
  }

  if (block.kind === "branch") {
    const outs = edges.map((e, idx) => ({ e, idx })).filter(({ e }) => e.from === block.id);
    return (
      <div className="auto-form">
        <LabeledInput label="Mode (keyword/yesno/llm)" value={cfg.mode || "keyword"} onChange={(e) => update({ mode: e.target.value })} />
        <LabeledInput label="Default Route Label" value={cfg.defaultToLabel || "default"} onChange={(e) => update({ defaultToLabel: e.target.value })} />
        <div className="auto-subtle">Outgoing edge labels (match routes):</div>
        {outs.map(({ e, idx }) => (
          <LabeledInput key={idx} label={`Edge ${idx + 1} label`} value={e.label || ""} onChange={(ev) => updateEdgeLabel(idx, ev.target.value)} />
        ))}
        <div className="auto-subtle">Use labels like <code>yes</code>, <code>no</code>, <code>later</code>, or custom keywords.</div>
      </div>
    );
  }

  if (block.kind === "meet") {
    return (
      <div className="auto-form">
        <LabeledInput label="Title" value={cfg.title || ""} onChange={(e) => update({ title: e.target.value })} />
        <LabeledInput label="Duration (mins)" type="number" value={cfg.durationMins ?? 30} onChange={(e) => update({ durationMins: Number(e.target.value) })} />
        <LabeledInput label="When (auto/manual)" value={cfg.when || "auto"} onChange={(e) => update({ when: e.target.value })} />
        {cfg.when === "manual" ? (
          <LabeledInput label="Start Time (ISO)" value={cfg.startAtISO || ""} onChange={(e) => update({ startAtISO: e.target.value })} />
        ) : null}
        <LabeledInput label="Timezone" value={cfg.timezone || "America/New_York"} onChange={(e) => update({ timezone: e.target.value })} />
      </div>
    );
  }

  if (block.kind === "parallel") {
    return (
      <div className="auto-form">
        <LabeledInput label="Branches (visual only)" type="number" value={cfg.branches ?? 2} onChange={(e) => update({ branches: Number(e.target.value) })} />
        <div className="auto-subtle">Connect multiple outgoing edges to run in parallel.</div>
      </div>
    );
  }

  if (block.kind === "agent") {
    return (
      <div className="auto-form">
        <LabeledInput label="Agent Name" value={cfg.name || ""} onChange={(e) => update({ name: e.target.value })} />
        <TextArea label="Goal" value={cfg.goal || ""} onChange={(e) => update({ goal: e.target.value })} />
      </div>
    );
  }

  if (block.kind === "loop") {
    return (
      <div className="auto-form">
        <LabeledInput label="Every (mins)" type="number" value={cfg.everyMins ?? 10} onChange={(e) => update({ everyMins: Number(e.target.value) })} />
        <LabeledInput label="Max Iterations (safety)" type="number" value={cfg.maxIterations ?? 100} onChange={(e) => update({ maxIterations: Number(e.target.value) })} />
        <div className="auto-subtle">Runner will execute continuously with this cadence.</div>
      </div>
    );
  }

  return <div className="auto-subtle">No configuration.</div>;
}

/* -------------------------------------------------------------------------- */
/* Page wrapper: header + toolbar under header                                */
/* -------------------------------------------------------------------------- */

export default function AutomationPage() {
  const navigate = useNavigate();

  return (
    <div className="auto-root">
      <Header />

      {/* Toolbar under header */}
      <div className="auto-toolbar" role="toolbar" aria-label="Mode switch">
        <div className="auto-toolbar-inner">
          <div className="auto-toolbar-left">
            <button
              className="auto-btn ghost"
              onClick={() => navigate("/neuroweb")}
              aria-pressed={false}
              title="Network visualization mode"
            >
              NeuroWeb
            </button>
            <button
              className="auto-btn solid"
              aria-pressed={true}
              title="Drag-and-drop autonomous outreach builder"
            >
              Autonomous
            </button>
          </div>
        </div>
      </div>

      {/* Builder grid */}
      <AutonomousBuilder />
    </div>
  );
}
