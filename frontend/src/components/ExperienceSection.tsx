// src/components/ExperienceSection.tsx
import React, { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { API_URL } from "../config";
import { Experience, fetchExperienceBySlug } from "../userProfile";
import "../css/ProfilePage.css";

const API = API_URL;

/* ---------------- helpers: authed fetch & types ---------------- */

type ExperienceInput = {
  title: string;
  company: string;
  employmentType?: string;
  location?: string;
  startDate: string;   // "YYYY-MM" or "YYYY-MM-DD"
  endDate?: string;
  current?: boolean;
  description?: string;
  skills?: string[];   // canonical (replaces technologies)
  logoUrl?: string;
};

async function authedHeaders(extra?: Record<string, string>) {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken?.();
  return {
    "Content-Type": "application/json",
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function addMyExperience(input: ExperienceInput): Promise<Experience> {
  const headers = await authedHeaders();
  const compatPayload = {
    ...input,
    ...(input.skills ? { technologies: input.skills } : {}),
  };
  const r = await fetch(`${API}/api/me/experience`, {
    method: "POST",
    headers,
    body: JSON.stringify(compatPayload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok) {
    throw new Error(data?.error || "Failed to add experience");
  }
  return data.item as Experience;
}

async function updateMyExperience(expId: string, input: ExperienceInput): Promise<Experience> {
  const headers = await authedHeaders();
  const compatPayload = {
    ...input,
    ...(input.skills ? { technologies: input.skills } : {}),
  };
  const r = await fetch(`${API}/api/me/experience/${encodeURIComponent(expId)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(compatPayload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok) {
    throw new Error(data?.error || "Failed to update experience");
  }
  return data.item as Experience;
}

async function deleteMyExperience(expId: string): Promise<void> {
  const headers = await authedHeaders();
  const r = await fetch(`${API}/api/me/experience/${encodeURIComponent(expId)}`, {
    method: "DELETE",
    headers,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.ok) {
    throw new Error(data?.error || "Failed to delete experience");
  }
}

/* ---------------- visuals ---------------- */

function fmtRange(start?: string, end?: string, current?: boolean) {
  const pick = (s?: string) => (s ? (s.length >= 7 ? s.slice(0, 7) : s) : "—"); // yyyy-mm
  const a = pick(start);
  const b = current ? "Present" : pick(end);
  return `${a} — ${b}`;
}

function Modal({
  open,
  onClose,
  title = "Add Experience",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // lock page scroll
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="vp-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // only clicks ON backdrop
      }}
    >
      <div className="vp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vp-modal-head">
          <h3 className="vp-h3" style={{ margin: 0 }}>{title}</h3>
          <button className="vp-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="vp-modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------------- shared form (Add + Edit) ---------------- */

function ExperienceForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: Partial<Experience>;
  onCancel: () => void;
  onSaved: (saved: Experience) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [employmentType, setEmploymentType] = useState(initial?.employmentType ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ?? "");
  const [current, setCurrent] = useState(Boolean(initial?.current));
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // prefer skills; fall back to technologies
  const initialSkills =
    Array.isArray((initial as any)?.skills)
      ? (initial as any).skills as string[]
      : Array.isArray((initial as any)?.technologies)
      ? (initial as any).technologies as string[]
      : [];
  const [skills, setSkills] = useState(initialSkills.join(", "));
  const [logoUrl, setLogoUrl] = useState(initial?.logoUrl ?? "");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const normalizeList = (s: string) =>
    s
      .split(/[\n,]/g)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 20);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!title.trim() || !company.trim() || !startDate.trim()) {
      setErr("Title, company, and start date are required.");
      return;
    }
    if (!current && !endDate.trim()) {
      setErr("Either mark 'Currently work here' or provide an end date.");
      return;
    }

    const payload: ExperienceInput = {
      title: title.trim(),
      company: company.trim(),
      employmentType: employmentType.trim() || undefined,
      location: location.trim() || undefined,
      startDate: startDate.trim(),
      endDate: current ? undefined : endDate.trim() || undefined,
      current,
      description: description.trim() || undefined,
      skills: normalizeList(skills),
      logoUrl: logoUrl.trim() || undefined,
    };

    try {
      setBusy(true);
      const saved = initial?.id
        ? await updateMyExperience(initial.id, payload)
        : await addMyExperience(payload);
      onSaved(saved);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save experience.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="vp-form">
      {err && <div className="vp-alert">{err}</div>}

      <div className="vp-grid2">
        <label className="vp-field">
          <span>Title *</span>
          <input
            className="vp-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Software Engineer"
            required
          />
        </label>
        <label className="vp-field">
          <span>Company *</span>
          <input
            className="vp-input"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Amazon"
            required
          />
        </label>
      </div>

      <div className="vp-grid2">
        <label className="vp-field">
          <span>Employment Type</span>
          <input
            className="vp-input"
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value)}
            placeholder="Full-time, Intern, Contract…"
          />
        </label>
        <label className="vp-field">
          <span>Location</span>
          <input
            className="vp-input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Boston, MA"
          />
        </label>
      </div>

      <div className="vp-grid3">
        <label className="vp-field">
          <span>Start (YYYY-MM) *</span>
          <input
            className="vp-input"
            type="month"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </label>
        <label className="vp-field">
          <span>End (YYYY-MM)</span>
          <input
            className="vp-input"
            type="month"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={current}
          />
        </label>
        <label className="vp-field checkbox">
          <input
            type="checkbox"
            checked={current}
            onChange={(e) => {
              setCurrent(e.target.checked);
              if (e.target.checked) setEndDate("");
            }}
          />
          <span>Currently work here</span>
        </label>
      </div>

      <label className="vp-field">
        <span>Description</span>
        <textarea
          className="vp-textarea"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What did you build? What impact did you have?"
        />
      </label>

      <label className="vp-field">
        <span>Skills (comma or newline)</span>
        <textarea
          className="vp-textarea"
          rows={2}
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder="AWS, Lambda, DynamoDB, React"
        />
      </label>

      <div className="vp-grid2">
        <label className="vp-field">
          <span>Logo URL</span>
          <input
            className="vp-input"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…/logo.png"
          />
        </label>
        <div />
      </div>

      <div className="vp-modal-foot">
        <button type="button" className="vp-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="vp-btn primary" disabled={busy}>
          {busy ? "Saving…" : (initial?.id ? "Save changes" : "Save")}
        </button>
      </div>
    </form>
  );
}

/* ---------------- main section ---------------- */

export default function ExperienceSection({
  profileSlug,
  isMine,
}: {
  profileSlug: string;
  isMine: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Experience[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Add/Edit modal state
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Experience | null>(null);

  async function reload() {
    setError(null);
    try {
      const list = await fetchExperienceBySlug(profileSlug);
      setItems(list);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load experience");
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchExperienceBySlug(profileSlug);
        if (alive) setItems(list);
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Unable to load experience");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [profileSlug]);

  const headerRight = useMemo(() => {
    if (!isMine) return null;
    return (
      <div className="vp-section-actions">
        <button
          className="vp-btn"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          Add experience
        </button>
      </div>
    );
  }, [isMine]);

  if (loading) {
    return (
      <div className="vp-section">
        <div className="vp-section-head">
          <h2 className="vp-h2">Experience</h2>
          {headerRight}
        </div>
        <div className="vp-skel-line" style={{ width: "60%" }} />
        <div className="vp-skel-line" style={{ width: "50%" }} />
        <div className="vp-skel-line" style={{ width: "40%" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="vp-section">
        <div className="vp-section-head">
          <h2 className="vp-h2">Experience</h2>
          {headerRight}
        </div>
        <p className="vp-copy">Couldn’t load experience. Please refresh.</p>
      </div>
    );
  }

  return (
    <section className="vp-section">
      {/* Section header stays fixed; only the list/empty state scrolls */}
      <div className="vp-section-head">
        <h2 className="vp-h2">Experience</h2>
        {headerRight}
      </div>

      <div className="vp-exp-scroll">
        {items.length === 0 ? (
          isMine ? (
            <div className="vp-empty">
              <div className="vp-empty-title">No experience yet</div>
              <div className="vp-empty-sub">
                Add roles you’ve held—title, company, dates, and skills.
              </div>
              <div className="vp-empty-actions">
                <button
                  className="vp-btn primary"
                  onClick={() => { setEditing(null); setOpen(true); }}
                >
                  Add experience
                </button>
              </div>
            </div>
          ) : (
            <p className="vp-copy">This user hasn’t added experience yet.</p>
          )
        ) : (
          <ul className="vp-exp-list">
            {items.map((e) => {
              const skills: string[] | undefined =
                (e as any).skills ?? (e as any).technologies;

              return (
                <li key={e.id} className="vp-exp-item">
                  <div className="vp-exp-left">
                    {e.logoUrl ? (
                      <img className="vp-exp-logo" src={e.logoUrl} alt={e.company ?? "Company"} />
                    ) : (
                      <div className="vp-exp-logo placeholder" aria-hidden />
                    )}
                  </div>

                  <div className="vp-exp-body">
                    <div className="vp-exp-role-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <div className="vp-exp-role">{e.title ?? "Title"}</div>
                      {isMine && (
                        <div className="vp-row-actions" style={{ display: "flex", gap: 8 }}>
                          <button
                            className="vp-btn"
                            onClick={() => { setEditing(e); setOpen(true); }}
                            title="Edit"
                          >
                            Edit
                          </button>
                          <button
                            className="vp-btn"
                            onClick={async () => {
                              if (!e.id) return;
                              const ok = window.confirm("Delete this experience?");
                              if (!ok) return;
                              try {
                                await deleteMyExperience(e.id);
                                await reload();
                              } catch (err: any) {
                                alert(err?.message || "Failed to delete");
                              }
                            }}
                            title="Delete"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="vp-exp-meta">
                      <span className="vp-exp-company">{e.company ?? "Company"}</span>
                      {e.employmentType ? <span className="vp-dot">•</span> : null}
                      {e.employmentType ? <span>{e.employmentType}</span> : null}
                      {e.location ? <span className="vp-dot">•</span> : null}
                      {e.location ? <span>{e.location}</span> : null}
                      <span className="vp-dot">•</span>
                      <span className="vp-exp-dates">
                        {fmtRange(e.startDate, e.endDate, (e as any).current)}
                      </span>
                    </div>

                    {e.description ? <p className="vp-exp-desc">{e.description}</p> : null}

                    {Array.isArray(skills) && skills.length > 0 ? (
                      <div className="vp-exp-tags">
                        {skills.slice(0, 8).map((t, i) => (
                          <span key={i} className="vp-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Add / Edit Experience Modal */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Edit Experience" : "Add Experience"}
      >
        <ExperienceForm
          initial={editing ?? undefined}
          onCancel={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false);
            await reload();
          }}
        />
      </Modal>
    </section>
  );
}
