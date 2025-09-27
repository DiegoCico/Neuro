# backend/network.py
from __future__ import annotations

import os
import re
from typing import Dict, List, Optional, Set, Tuple

import firebase_admin
from firebase_admin import auth as fb_auth, credentials, firestore
from flask import request

# --------------------------------------------------------------------------
# Config (as requested)
# --------------------------------------------------------------------------
SERVICE_ACCOUNT_PATH = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "neru-b3128-firebase-adminsdk-fbsvc-11110f3ad3.json",
)

# --------------------------------------------------------------------------
# Firebase init (lazy) + Firestore accessor
# --------------------------------------------------------------------------
def _ensure_firebase() -> None:
    """Initialize the default Firebase app once (lazy)."""
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)

def _db() -> firestore.Client:
    """Get a Firestore client (after ensuring the app exists)."""
    _ensure_firebase()
    return firestore.client()

# -------------------------- helpers: auth & utils --------------------------- #

def _extract_bearer_token(req) -> Optional[str]:
    h = req.headers.get("Authorization") or ""
    m = re.match(r"^Bearer\s+(.+)$", h.strip(), flags=re.I)
    return m.group(1) if m else None

def verify_token(req) -> Tuple[str, dict]:
    """
    Verifies Firebase ID token and returns (uid, decoded_token).
    """
    _ensure_firebase()  # make sure auth is initialized too
    token = _extract_bearer_token(req)
    if not token:
        raise ValueError("Missing Authorization Bearer token")
    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception as e:
        raise ValueError(f"Invalid token: {e}")
    uid = decoded.get("uid")
    if not uid:
        raise ValueError("Token missing uid")
    return uid, decoded

def kebab_name(first: Optional[str], last: Optional[str], full: Optional[str]) -> str:
    base = ""
    if full and full.strip():
        base = full.strip()
    else:
        parts = [first or "", last or ""]
        base = " ".join([p for p in parts if p]).strip() or "user"
    s = base.lower()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "user"

# ----------------------------- followers lookup ---------------------------- #

def _fetch_followers_array_field(uid: str) -> List[str]:
    """
    Your schema:
      users/{uid} doc contains array field:
        followers: [ "<uid1>", "<uid2>", ... ]
    """
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
    """
    Optional alternate schema:
      users/{uid}/followers/{followerUid} -> { uid: <followerUid>, ... }
    """
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
    """
    Optional alternate schema:
      relations/{docId} -> { follower: <uidA>, followee: <uidB> }
      (also supports { from: <uidA>, to: <uidB> })
    """
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
    """
    Combines all strategies; primary is the array field on users/{uid}.
    """
    prim = _fetch_followers_array_field(uid)
    subc = _fetch_followers_subcollection(uid)
    rels = _fetch_followers_relations(uid)
    dedup: Set[str] = set(prim) | set(subc) | set(rels)
    return sorted(dedup)

# ----------------------------- profile hydration --------------------------- #

def _chunk(lst: List[str], n: int) -> List[List[str]]:
    return [lst[i:i+n] for i in range(0, len(lst), n)]

def _load_profiles(uids: List[str]) -> Dict[str, dict]:
    """
    Loads profiles from users/{uid} docs. Uses batched 'in' (max 10).
    """
    profiles: Dict[str, dict] = {}
    if not uids:
        return profiles

    db = _db()
    for batch in _chunk(uids, 10):
        try:
            q = db.collection("users").where(
                firestore.FieldPath.document_id(), "in", batch
            )
            for doc in q.stream():
                data = doc.to_dict() or {}
                data["uid"] = doc.id
                profiles[doc.id] = data
        except Exception:
            # fallback: individual gets
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
    }
