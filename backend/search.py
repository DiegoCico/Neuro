# search.py
from __future__ import annotations

import os
import re
from typing import Dict, List, Any

import firebase_admin
from firebase_admin import credentials, firestore

# --------------------------------------------------------------------
# Firebase Admin init (idempotent)
# --------------------------------------------------------------------
SERVICE_ACCOUNT_PATH = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "neru-b3128-firebase-adminsdk-fbsvc-11110f3ad3.json",
)
if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# --------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------
def _slugify(full_name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9\s-]", "", full_name or "").strip().lower()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-{2,}", "-", s)
    return s

def _name_tokens(full_name: str) -> List[str]:
    """
    Break a name into lowercased tokens plus progressive prefixes for quick search.
    e.g. "Diego Cicotoste" -> ["diego","di","die","dieg","cicotoste","ci","cic","cico",...]
    """
    clean = re.sub(r"[^a-zA-Z0-9\s-]", " ", full_name or "").strip().lower()
    parts = [p for p in re.split(r"\s+", clean) if p]
    toks: List[str] = []
    for p in parts:
        toks.append(p)
        for k in range(2, min(len(p), 6) + 1):
            toks.append(p[:k])
    # de-dupe while preserving order
    seen = set()
    out: List[str] = []
    for t in toks:
        if t not in seen:
            out.append(t)
            seen.add(t)
    return out

def ensure_user_search_fields(user: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns a copy of user with 'fullNameLower' and 'nameTokens' computed if missing.
    """
    u = dict(user)
    full = u.get("fullName") or " ".join([u.get("firstName", "") or "", u.get("lastName", "") or ""]).strip()
    u["fullName"] = full
    u["fullNameLower"] = (full or "").lower()
    u["nameTokens"] = u.get("nameTokens") or _name_tokens(full)
    u["slug"] = u.get("slug") or _slugify(full)
    return u

# --------------------------------------------------------------------
# Admin/maintenance (optional)
# --------------------------------------------------------------------
def backfill_search_fields(limit: int = 500):
    """
    Backfill 'fullNameLower' and 'nameTokens' into user docs (dev helper).
    """
    users_ref = db.collection("users")
    docs = users_ref.limit(limit).stream()
    count = 0
    for d in docs:
        u = d.to_dict() or {}
        updated = ensure_user_search_fields(u)
        if (u.get("fullNameLower") != updated["fullNameLower"]) or (u.get("nameTokens") != updated["nameTokens"]) or (u.get("slug") != updated["slug"]):
            users_ref.document(d.id).update({
                "fullName": updated["fullName"],
                "fullNameLower": updated["fullNameLower"],
                "nameTokens": updated["nameTokens"],
                "slug": updated["slug"],
            })
            count += 1
    return {"updated": count}

# --------------------------------------------------------------------
# Search
# --------------------------------------------------------------------
def search_users(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    """
    Search users by name. Tries indexed search first:
      - array-contains on 'nameTokens' for the first token/prefix
      - (optional) 'fullNameLower' prefix search if indexed (best effort)
    Falls back to in-Python filtering of up to 400 docs for dev.
    Returns minimal cards: id, fullName, slug, avatarUrl
    """
    q = (query or "").strip().lower()
    if len(q) < 2:
        return []

    users_ref = db.collection("users")
    results: List[Dict[str, Any]] = []

    # Try fast path: nameTokens array-contains
    try:
        docs = list(users_ref.where("nameTokens", "array_contains", q[:6]).limit(limit * 2).stream())
        for d in docs:
            u = ensure_user_search_fields(d.to_dict() or {})
            if q in u["fullNameLower"]:
                results.append({
                    "id": d.id,
                    "fullName": u["fullName"],
                    "slug": u.get("slug") or _slugify(u["fullName"]),
                    "avatarUrl": u.get("avatarUrl") or None,
                })
            if len(results) >= limit:
                break
        if results:
            return results[:limit]
    except Exception:
        # Index might not exist; ignore and try other strategies
        pass

    # Try prefix on fullNameLower (requires composite index). Best effort.
    try:
        qry = (users_ref
               .order_by("fullNameLower")
               .start_at({u"fullNameLower": q})
               .end_at({u"fullNameLower": q + u"\uf8ff"})
               .limit(limit))
        docs = list(qry.stream())
        for d in docs:
            u = ensure_user_search_fields(d.to_dict() or {})
            results.append({
                "id": d.id,
                "fullName": u["fullName"],
                "slug": u.get("slug") or _slugify(u["fullName"]),
                "avatarUrl": u.get("avatarUrl") or None,
            })
        if results:
            return results[:limit]
    except Exception:
        pass

    # Fallback: small in-memory scan (dev)
    try:
        docs = list(users_ref.limit(400).stream())
        basket: List[Dict[str, Any]] = []
        for d in docs:
            u = ensure_user_search_fields(d.to_dict() or {})
            if q in u["fullNameLower"]:
                basket.append({
                    "id": d.id,
                    "fullName": u["fullName"],
                    "slug": u.get("slug") or _slugify(u["fullName"]),
                    "avatarUrl": u.get("avatarUrl") or None,
                })
        # light ranking: startswith first, then substring
        starts = [r for r in basket if r["fullName"].lower().startswith(q)]
        subs = [r for r in basket if r not in starts]
        ranked = starts + subs
        return ranked[:limit]
    except Exception:
        return []
