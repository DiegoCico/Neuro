# backend/network.py
from __future__ import annotations

import json
import math
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set, Tuple

import firebase_admin
from firebase_admin import auth as fb_auth, credentials, firestore
from flask import Blueprint, jsonify, request

# ------------------------------------------------------------------------------
# Firebase init (lazy)
# ------------------------------------------------------------------------------
SERVICE_ACCOUNT_PATH = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "neru-b3128-firebase-adminsdk-fbsvc-11110f3ad3.json",
)

def _ensure_firebase() -> None:
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)

def _db() -> firestore.Client:
    _ensure_firebase()
    return firestore.client()

# ------------------------------------------------------------------------------
# Auth helpers
# ------------------------------------------------------------------------------
def _extract_bearer_token(req) -> Optional[str]:
    h = req.headers.get("Authorization") or ""
    m = re.match(r"^Bearer\s+(.+)$", h.strip(), flags=re.I)
    return m.group(1) if m else None

def verify_token(req) -> Tuple[str, dict]:
    _ensure_firebase()
    token = _extract_bearer_token(req)
    if not token:
        raise ValueError("Missing Authorization Bearer token")
    decoded = fb_auth.verify_id_token(token)
    uid = decoded.get("uid")
    if not uid:
        raise ValueError("Token missing uid")
    return uid, decoded

# ------------------------------------------------------------------------------
# Slug / display helpers
# ------------------------------------------------------------------------------
def kebab_name(first: Optional[str], last: Optional[str], full: Optional[str]) -> str:
    base = full.strip() if full and full.strip() else " ".join([first or "", last or ""]).strip() or "user"
    s = base.lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "user"

# ------------------------------------------------------------------------------
# Followers fetch (supports multiple possible schemas)
# ------------------------------------------------------------------------------
def _fetch_followers_array_field(uid: str) -> List[str]:
    try:
        db = _db()
        snap = db.collection("users").document(uid).get()
        if not snap.exists:
            return []
        data = snap.to_dict() or {}
        arr = data.get("followers") or []
        out: List[str] = []
        if isinstance(arr, list):
            for v in arr:
                if isinstance(v, str) and v.strip():
                    out.append(v.strip())
        return out
    except Exception:
        return []

def _fetch_followers_subcollection(uid: str) -> List[str]:
    out: Set[str] = set()
    try:
        db = _db()
        coll = db.collection("users").document(uid).collection("followers")
        for doc in coll.stream():
            data = doc.to_dict() or {}
            follower_uid = data.get("uid") or doc.id
            if follower_uid:
                out.add(follower_uid)
    except Exception:
        pass
    return list(out)

def _fetch_followers_relations(uid: str) -> List[str]:
    out: Set[str] = set()
    try:
        db = _db()
        q = db.collection("relations").where("followee", "==", uid)
        for doc in q.stream():
            data = doc.to_dict() or {}
            follower_uid = data.get("follower")
            if follower_uid:
                out.add(follower_uid)
    except Exception:
        pass
    try:
        db = _db()
        q2 = db.collection("relations").where("to", "==", uid)
        for doc in q2.stream():
            data = doc.to_dict() or {}
            follower_uid = data.get("from")
            if follower_uid:
                out.add(follower_uid)
    except Exception:
        pass
    return list(out)

def _fetch_follower_uids(uid: str) -> List[str]:
    prim = _fetch_followers_array_field(uid)
    subc = _fetch_followers_subcollection(uid)
    rels = _fetch_followers_relations(uid)
    dedup: Set[str] = set(prim) | set(subc) | set(rels)
    return sorted(dedup)

def _chunk(lst: List[str], n: int) -> List[List[str]]:
    return [lst[i:i+n] for i in range(0, len(lst), n)]

def _load_profiles(uids: List[str]) -> Dict[str, dict]:
    profiles: Dict[str, dict] = {}
    if not uids:
        return profiles
    db = _db()
    for batch in _chunk(uids, 10):
        try:
            q = db.collection("users").where(firestore.FieldPath.document_id(), "in", batch)
            for doc in q.stream():
                data = doc.to_dict() or {}
                data["uid"] = doc.id
                profiles[doc.id] = data
        except Exception:
            for u in batch:
                try:
                    d = db.collection("users").document(u).get()
                    if d.exists:
                        data = d.to_dict() or {}
                        data["uid"] = d.id
                        profiles[u] = data
                except Exception:
                    pass
    return profiles

def _shape_follower_item(p: dict) -> dict:
    first = p.get("firstName")
    last = p.get("lastName")
    full = p.get("fullName") or " ".join([n for n in [first, last] if n]).strip()
    slug = p.get("slug") or kebab_name(first, last, full)
    return {
        "uid": p.get("uid"),
        "fullName": full or "User",
        "slug": slug,
        "avatarUrl": p.get("avatarUrl"),
        "occupation": p.get("occupation") or p.get("headline") or None,
        "interests": p.get("interests") or [],
        "skills": p.get("skills") or [],
        "tags": p.get("tags") or [],
        "topics": p.get("topics") or [],
        "headline": p.get("headline"),
        "bio": p.get("bio"),
    }

# ------------------------------------------------------------------------------
# Local interest derivation / tokenization (used for fallback & scoring)
# ------------------------------------------------------------------------------
OCC_DEFAULT = "Other"

def normalize_occ(s: Optional[str]) -> str:
    if not s:
        return OCC_DEFAULT
    t = s.strip()
    if not t:
        return OCC_DEFAULT
    low = t.lower()
    if re.search(r"(software|swe|developer|engineer|full\s*stack|backend|frontend)", low): return "Software Engineer"
    if re.search(r"(data|ml|ai|analytics|scientist|bi|machine learning)", low): return "Data / AI"
    if re.search(r"(design|ux|ui|product design)", low): return "Design"
    if re.search(r"(product\s*manager|pm|product\s*owner)", low): return "Product"
    if re.search(r"(devops|infra|platform|site reliability|sre|cloud)", low): return "DevOps / Infra"
    if re.search(r"(security|infosec)", low): return "Security"
    if re.search(r"(student|intern)", low): return "Student / Intern"
    if re.search(r"(founder|ceo|cto|coo|startup)", low): return "Founder"
    return t[:1].upper() + t[1:]

def title_case(s: str) -> str:
    return (
        s.lower()
        .replace("_", " ")
        .replace("-", " ")
        .strip()
        .replace("  ", " ")
        .title()
    )

KW = [
    "react","next.js","vue","angular",
    "node","express","django","flask",
    "python","typescript","javascript","go","rust","java","kotlin",
    "aws","gcp","azure","kubernetes","docker","terraform",
    "postgres","mysql","mongodb","redis",
    "ml","ai","llm","pytorch","tensorflow","sklearn","nlp",
    "figma","ux","ui",
    "security","sre","devops","platform",
    "product","pm"
]

def derive_interests(p: dict) -> List[str]:
    out: List[str] = []
    def push_arr(arr):
        if isinstance(arr, list):
            for it in arr:
                s = str(it or "").strip()
                if s:
                    out.append(s)
    push_arr(p.get("interests"))
    push_arr(p.get("skills"))
    push_arr(p.get("tags"))
    push_arr(p.get("topics"))
    txt = " ".join([p.get("headline") or "", p.get("bio") or "", p.get("occupation") or ""]).lower()
    for k in KW:
        if k in txt:
            out.append(k)
    if not out and p.get("occupation"):
        bits = [b.strip() for b in re.split(r"[,/|•·\-]+", p["occupation"]) if b.strip()]
        out.extend(bits[:3])
    return list(dict.fromkeys([title_case(x) for x in out]))[:40]

def tokenize(s: str) -> List[str]:
    return [t for t in re.sub(r"[^a-z0-9\s+.]", " ", s.lower()).split() if t]

SYN: Dict[str, List[str]] = {
    "backend": ["server", "api", "microservices", "distributed", "scalable", "rest", "grpc"],
    "frontend": ["react", "next", "ui", "ux", "javascript", "typescript"],
    "devops": ["kubernetes", "docker", "terraform", "cicd", "sre", "platform", "infrastructure"],
    "data": ["ml", "ai", "analytics", "etl", "pipeline", "pytorch", "tensorflow", "sklearn", "nlp"],
    "cloud": ["aws", "gcp", "azure"],
    "product": ["pm", "roadmap", "discovery", "requirements", "spec"],
    "security": ["infosec", "iam", "oauth", "owasp", "threat", "detection"],
}

def expand_tokens(tokens: List[str]) -> List[str]:
    out: Set[str] = set(tokens)
    for t in tokens:
        for k, vals in SYN.items():
            if t == k or t in vals:
                out.add(k)
                out.update(vals)
    return list(out)

def score_text(qtoks: List[str], target: str) -> float:
    ttoks = expand_tokens(tokenize(target))
    s = 0.0
    for q in qtoks:
        if q in ttoks:
            s += 2.0
        elif any(q in t or t in q for t in ttoks):
            s += 1.0
    return s

# ------------------------------------------------------------------------------
# Gemini (both SDKs supported)
# ------------------------------------------------------------------------------
GENAI_MODE = None  # "new" | "old" | None
NEW_GENAI = None
OLD_GENAI = None

try:
    from google import genai as _new_genai  # google-genai (new)
    NEW_GENAI = _new_genai
    GENAI_MODE = "new"
except Exception:
    try:
        import google.generativeai as _old_genai  # legacy
        OLD_GENAI = _old_genai
        GENAI_MODE = "old"
    except Exception:
        GENAI_MODE = None

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GOOGLE_API_KEY = (os.getenv("GOOGLE_API_KEY") or "").strip()

MIN_SECONDS_BETWEEN_CALLS = 0.8
_last_call_at: Dict[str, float] = {}

def _rate_limit(uid: str):
    now = time.time()
    last = _last_call_at.get(uid, 0.0)
    if now - last < MIN_SECONDS_BETWEEN_CALLS:
        raise RuntimeError("Please wait a moment before asking again.")
    _last_call_at[uid] = now

def _call_gemini_json(prompt: str) -> Optional[dict]:
    """
    Calls Gemini and tries to parse a JSON object from the response.
    Returns None on parsing failure so caller can fallback.
    """
    if not GOOGLE_API_KEY:
        raise RuntimeError("GOOGLE_API_KEY environment variable is not set")

    raw_text = None
    try:
        if GENAI_MODE == "new" and NEW_GENAI is not None:
            client = NEW_GENAI.Client(api_key=GOOGLE_API_KEY)  # type: ignore
            resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)  # type: ignore
            raw_text = getattr(resp, "text", None)
            if not raw_text and getattr(resp, "candidates", None):
                try:
                    parts = resp.candidates[0].content.parts
                    raw_text = "".join(getattr(p, "text", "") for p in parts)
                except Exception:
                    pass
        elif GENAI_MODE == "old" and OLD_GENAI is not None:
            OLD_GENAI.configure(api_key=GOOGLE_API_KEY)  # type: ignore
            model = OLD_GENAI.GenerativeModel(GEMINI_MODEL)  # type: ignore
            resp = model.generate_content(prompt)
            raw_text = getattr(resp, "text", None)
            if not raw_text and getattr(resp, "candidates", None):
                parts = getattr(resp.candidates[0].content, "parts", [])
                raw_text = "".join(getattr(p, "text", "") for p in parts)
        else:
            raise RuntimeError(
                "No Gemini SDK found. Install one of:\n"
                "  pip install google-genai        # new client (from google import genai)\n"
                "  or\n"
                "  pip install google-generativeai # legacy client"
            )
    except Exception as e:
        print(f"[network.ai] Gemini error: {type(e).__name__}: {e}")
        return None

    if not raw_text or not raw_text.strip():
        return None

    txt = raw_text.strip()
    # Extract the first JSON object from the response safely
    m = re.search(r"\{.*\}", txt, flags=re.S)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    return None

# ------------------------------------------------------------------------------
# Local semantic fallback using provided context
# ------------------------------------------------------------------------------
def _local_match(q: str, extra: str, occs: List[str], interests_by_occ: Dict[str, List[Dict[str, Any]]]) -> Optional[Tuple[str, Optional[str], Dict[str, float]]]:
    qt = expand_tokens(tokenize((q or "") + "\n" + (extra or "")))
    if not qt or not occs:
        return None

    # score occupations
    best_occ, best_occ_s = None, -1.0
    occ_scores: Dict[str, float] = {}
    for o in occs:
        s = score_text(qt, o)
        for it in (interests_by_occ.get(o) or [])[:24]:
            s += score_text(qt, it["label"]) * max(1.0, math.log2(1 + int(it.get("count", 1))))
        occ_scores[o] = s
        if s > best_occ_s:
            best_occ_s, best_occ = s, o

    if not best_occ:
        return None

    # score interests within the best occupation
    best_i, best_i_s = None, -1.0
    for it in (interests_by_occ.get(best_occ) or []):
        s = score_text(qt, it["label"]) * max(1.0, math.log2(1 + int(it.get("count", 1))))
        if s > best_i_s:
            best_i_s, best_i = s, it["label"]

    return best_occ, (best_i or None), occ_scores
