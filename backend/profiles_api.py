# profiles.py
from __future__ import annotations

import os
import re
from typing import Any, Dict, Optional, Tuple, Iterable

import firebase_admin
from firebase_admin import credentials, firestore, auth

from google.cloud.firestore_v1 import Transaction


SERVICE_ACCOUNT_PATH = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "neru-b3128-firebase-adminsdk-fbsvc-11110f3ad3.json",
)

def _get_user_doc(uid: str):
    return db.collection("users").document(uid)

def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return default

def is_following(viewer_uid: str, target_uid: str) -> bool:
    if not viewer_uid or not target_uid:
        return False
    viewer = get_user_by_uid(viewer_uid)
    if not viewer:
        return False
    following = set(viewer.get("following") or [])
    return target_uid in following

@firestore.transactional
def _tx_follow(transaction: Transaction, viewer_uid: str, target_uid: str) -> Dict[str, Any]:
    viewer_ref = _get_user_doc(viewer_uid)
    target_ref = _get_user_doc(target_uid)

    viewer_snap = viewer_ref.get(transaction=transaction)
    target_snap = target_ref.get(transaction=transaction)
    if not viewer_snap.exists or not target_snap.exists:
        raise ValueError("user not found")

    viewer = viewer_snap.to_dict() or {}
    target = target_snap.to_dict() or {}

    viewer_following = set(viewer.get("following") or [])
    target_followers = set(target.get("followers") or [])
    followers_count = _safe_int(target.get("followersCount") or target.get("stats", {}).get("followers") or 0)

    if target_uid not in viewer_following:
        viewer_following.add(target_uid)
        target_followers.add(viewer_uid)
        followers_count += 1

        transaction.update(viewer_ref, {"following": list(viewer_following)})
        # Store both list and a denormalized count for quick reads
        transaction.update(target_ref, {
            "followers": list(target_followers),
            "followersCount": followers_count
        })

    # return minimal payload for client
    return {"isFollowing": True, "followersCount": followers_count}

@firestore.transactional
def _tx_unfollow(transaction: Transaction, viewer_uid: str, target_uid: str) -> Dict[str, Any]:
    viewer_ref = _get_user_doc(viewer_uid)
    target_ref = _get_user_doc(target_uid)

    viewer_snap = viewer_ref.get(transaction=transaction)
    target_snap = target_ref.get(transaction=transaction)
    if not viewer_snap.exists or not target_snap.exists:
        raise ValueError("user not found")

    viewer = viewer_snap.to_dict() or {}
    target = target_snap.to_dict() or {}

    viewer_following = set(viewer.get("following") or [])
    target_followers = set(target.get("followers") or [])
    followers_count = _safe_int(target.get("followersCount") or target.get("stats", {}).get("followers") or 0)

    if target_uid in viewer_following:
        viewer_following.remove(target_uid)
        if viewer_uid in target_followers:
            target_followers.remove(viewer_uid)
        followers_count = max(0, followers_count - 1)

        transaction.update(viewer_ref, {"following": list(viewer_following)})
        transaction.update(target_ref, {
            "followers": list(target_followers),
            "followersCount": followers_count
        })

    return {"isFollowing": False, "followersCount": followers_count}

def follow_user(viewer_uid: str, target_slug: str) -> Dict[str, Any]:
    if not viewer_uid:
        raise PermissionError("unauthorized")
    target = get_user_by_slug(target_slug)
    if not target:
        raise LookupError("target not found")
    target_uid = target["id"]
    if target_uid == viewer_uid:
        raise ValueError("cannot follow yourself")
    tx = db.transaction()
    return _tx_follow(tx, viewer_uid, target_uid)

def unfollow_user(viewer_uid: str, target_slug: str) -> Dict[str, Any]:
    if not viewer_uid:
        raise PermissionError("unauthorized")
    target = get_user_by_slug(target_slug)
    if not target:
        raise LookupError("target not found")
    target_uid = target["id"]
    if target_uid == viewer_uid:
        raise ValueError("cannot unfollow yourself")
    tx = db.transaction()
    return _tx_unfollow(tx, viewer_uid, target_uid)


def _ensure_firebase() -> None:
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)

def _get_db():
    _ensure_firebase()
    return firestore.client()

db = _get_db()

# ------------------------------------------------------------------
# Slug helpers (pure functions)
# ------------------------------------------------------------------

_slug_strip_re = re.compile(r"[^a-zA-Z0-9\s-]")
_spaces_re = re.compile(r"\s+")
_dashes_re = re.compile(r"-+")

def kebab_any(s: str) -> str:
    s = _slug_strip_re.sub("", s or "").lower()
    s = _spaces_re.sub("-", s)
    s = _dashes_re.sub("-", s)
    return s.strip("-")

def kebab_name(first: Optional[str], last: Optional[str] = None) -> str:
    full = " ".join([p for p in [(first or "").strip(), (last or "").strip()] if p]).strip()
    return kebab_any(full)

def derive_slug(user: Dict[str, Any]) -> Optional[str]:
    fn = (user.get("firstName") or "").strip()
    ln = (user.get("lastName") or "").strip()
    full = (user.get("fullName") or "").strip()

    if fn or ln:
        return kebab_name(fn, ln)

    if full:
        s = kebab_any(full)
        if s:
            return s
        parts = full.split()
        if parts:
            first = parts[0]
            rest = " ".join(parts[1:]) if len(parts) > 1 else ""
            return kebab_name(first, rest or None)

    return None

# ------------------------------------------------------------------
# Auth helper (no Flask dependency)
# ------------------------------------------------------------------

def verify_bearer_uid(authorization_header: Optional[str]) -> Optional[str]:
    """
    Parse 'Authorization: Bearer <idToken>' and verify with Firebase.
    Returns UID or None.
    """
    if not authorization_header or not authorization_header.startswith("Bearer "):
        return None
    id_token = authorization_header.split("Bearer ", 1)[1].strip()
    try:
        decoded = auth.verify_id_token(id_token)
        return decoded.get("uid")
    except Exception:
        return None

# ------------------------------------------------------------------
# Data access & operations
# ------------------------------------------------------------------

def get_user_by_uid(uid: str) -> Optional[Dict[str, Any]]:
    doc = db.collection("users").document(uid).get()
    if not doc.exists:
        return None
    user = doc.to_dict() or {}
    user["id"] = uid
    return user

def ensure_user_slug(uid: str, user: Dict[str, Any]) -> Dict[str, Any]:
    """
    Ensure a 'slug' exists for this user; if missing, derive and persist it.
    Returns possibly-updated user dict (with 'slug').
    """
    if user.get("slug"):
        return user
    s = derive_slug(user)
    if s:
        db.collection("users").document(uid).update({"slug": s})
        user["slug"] = s
    return user

def upsert_user(uid: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Merge fields into users/<uid>, guaranteeing a slug.
    """
    doc_ref = db.collection("users").document(uid)
    existing = doc_ref.get().to_dict() or {}
    merged = {**existing, **(data or {})}

    if not merged.get("slug"):
        s = derive_slug(merged)
        if s:
            merged["slug"] = s

    doc_ref.set(merged, merge=True)
    merged["id"] = uid
    return merged

def _fast_lookup_by_slug(target: str) -> Optional[Tuple[str, Dict[str, Any]]]:
    """
    Fast path: where('slug' == target) using a Firestore index.
    Returns (doc_id, user_dict) or None.
    """
    users = list(db.collection("users").where("slug", "==", target).limit(1).stream())
    if not users:
        return None
    doc = users[0]
    u = doc.to_dict() or {}
    u["id"] = doc.id
    return (doc.id, u)

def _slow_scan_users() -> Iterable[Tuple[str, Dict[str, Any]]]:
    for doc in db.collection("users").stream():
        u = doc.to_dict() or {}
        u["id"] = doc.id
        yield (doc.id, u)

def get_user_by_slug(slug: str) -> Optional[Dict[str, Any]]:
    """
    Resolve a user by slug via:
      1) fast slug index
      2) scan & compute: explicit slug, first+last -> slug, fullName -> slug, split-fullName heuristic
    Returns user dict or None.
    """
    target = (slug or "").lower().strip()
    if not target:
        return None

    # Fast path
    try:
        fast = _fast_lookup_by_slug(target)
        if fast:
            return fast[1]
    except Exception:
        # Index might be missing; fall back to scan
        pass

    # Fallback scan
    for _id, u in _slow_scan_users():
        # 1) explicit slug
        s = (u.get("slug") or "").lower().strip()
        if s and s == target:
            return u

        # 2) first+last
        fn = (u.get("firstName") or "").strip()
        ln = (u.get("lastName") or "").strip()
        if fn or ln:
            if kebab_name(fn, ln) == target:
                return u

        # 3) fullName direct
        full = (u.get("fullName") or "").strip()
        if full and kebab_any(full) == target:
            return u

        # 4) fullName split heuristic if no first/last present
        if full and not (fn or ln):
            parts = full.split()
            if parts:
                first = parts[0]
                rest = " ".join(parts[1:]) if len(parts) > 1 else None
                if kebab_name(first, rest) == target:
                    return u

    return None

def backfill_all_slugs(batch_size: int = 400) -> int:
    """
    Populate 'slug' for all users that don't have one.
    Returns number of updated docs.
    """
    updated = 0
    batch = db.batch()
    ops = 0

    for doc in db.collection("users").stream():
        u = doc.to_dict() or {}
        if not u.get("slug"):
            s = derive_slug(u)
            if s:
                batch.update(doc.reference, {"slug": s})
                updated += 1
                ops += 1
                if ops >= batch_size:
                    batch.commit()
                    batch = db.batch()
                    ops = 0

    if ops:
        batch.commit()

    return updated
