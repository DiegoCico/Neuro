# profiles.py
from __future__ import annotations

import os
import re
from typing import Any, Dict, Optional, Tuple, Iterable, List

import firebase_admin
from firebase_admin import credentials, firestore, auth
from google.cloud.firestore_v1 import Transaction

from datetime import datetime
from typing import TypedDict, List, Optional, Dict, Any
from typing import cast


# ------------------------------------------------------------
# Firebase / Firestore init
# ------------------------------------------------------------

SERVICE_ACCOUNT_PATH = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "neru-b3128-firebase-adminsdk-fbsvc-11110f3ad3.json",
)

def _ensure_firebase() -> None:
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
        firebase_admin.initialize_app(cred)

def _get_db():
    _ensure_firebase()
    return firestore.client()

db = _get_db()

# ------------------------------------------------------------
# Slug helpers (pure functions)
# ------------------------------------------------------------

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

# ------------------------------------------------------------
# Auth helper (no Flask dependency)
# ------------------------------------------------------------

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

# ------------------------------------------------------------
# Data access
# ------------------------------------------------------------

def _get_user_doc(uid: str):
    return db.collection("users").document(uid)

def get_user_by_uid(uid: str) -> Optional[Dict[str, Any]]:
    doc = _get_user_doc(uid).get()
    if not doc.exists:
        return None
    user = doc.to_dict() or {}
    user["id"] = uid
    return user

def _fast_lookup_by_slug(target: str) -> Optional[Tuple[str, Dict[str, Any]]]:
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
      2) scan & compute fallbacks
    """
    target = (slug or "").lower().strip()
    if not target:
        return None

    try:
        fast = _fast_lookup_by_slug(target)
        if fast:
            return fast[1]
    except Exception:
        pass

    for _id, u in _slow_scan_users():
        s = (u.get("slug") or "").lower().strip()
        if s and s == target:
            return u

        fn = (u.get("firstName") or "").strip()
        ln = (u.get("lastName") or "").strip()
        if fn or ln:
            if kebab_name(fn, ln) == target:
                return u

        full = (u.get("fullName") or "").strip()
        if full and kebab_any(full) == target:
            return u

        if full and not (fn or ln):
            parts = full.split()
            if parts:
                first = parts[0]
                rest = " ".join(parts[1:]) if len(parts) > 1 else None
                if kebab_name(first, rest) == target:
                    return u

    return None

def ensure_user_slug(uid: str, user: Dict[str, Any]) -> Dict[str, Any]:
    if user.get("slug"):
        return user
    s = derive_slug(user)
    if s:
        _get_user_doc(uid).update({"slug": s})
        user["slug"] = s
    return user

def upsert_user(uid: str, data: Dict[str, Any]) -> Dict[str, Any]:
    doc_ref = _get_user_doc(uid)
    existing = doc_ref.get().to_dict() or {}
    merged = {**existing, **(data or {})}

    if not merged.get("slug"):
        s = derive_slug(merged)
        if s:
            merged["slug"] = s

    doc_ref.set(merged, merge=True)
    merged["id"] = uid
    return merged

# ------------------------------------------------------------
# Follows: helpers
# ------------------------------------------------------------

def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except Exception:
        return default

def _best_full_name(user: Dict[str, Any]) -> str:
    fn = (user.get("firstName") or "").strip()
    ln = (user.get("lastName") or "").strip()
    if fn or ln:
        return " ".join([p for p in [fn, ln] if p]).strip()
    full = (user.get("fullName") or "").strip()
    if full:
        return full
    # last resort — something non-empty
    return fn or user.get("email") or "User"

def _ensure_slug_in_user(user: Dict[str, Any]) -> str:
    """
    Return a slug for user (using existing 'slug' or deriving on the fly).
    NOTE: does not persist unless caller decides to.
    """
    s = (user.get("slug") or "").strip()
    if s:
        return s
    # derive from available names
    return derive_slug(user) or ""

def _upsert_follower_details(
    current: List[Dict[str, Any]],
    new_entry: Dict[str, Any],
) -> List[Dict[str, Any]]:
    uid = new_entry.get("uid")
    out: List[Dict[str, Any]] = []
    seen = False
    for e in current or []:
        if e.get("uid") == uid:
            # replace with latest info (name/slug might have changed)
            out.append(new_entry)
            seen = True
        else:
            out.append(e)
    if not seen:
        out.append(new_entry)
    return out

def _remove_follower_details(
    current: List[Dict[str, Any]],
    rm_uid: str,
) -> List[Dict[str, Any]]:
    return [e for e in (current or []) if e.get("uid") != rm_uid]

def is_following(viewer_uid: str, target_uid: str) -> bool:
    if not viewer_uid or not target_uid:
        return False
    viewer = get_user_by_uid(viewer_uid)
    if not viewer:
        return False
    following = set(viewer.get("following") or [])
    return target_uid in following

# ------------------------------------------------------------
# Follows: transactional ops (adds followersDetails)
# ------------------------------------------------------------

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

    # viewer: following[]
    viewer_following = set(viewer.get("following") or [])

    # target: followers[], followersCount, followersDetails[]
    target_followers = set(target.get("followers") or [])
    followers_count = _safe_int(
        target.get("followersCount") or target.get("stats", {}).get("followers") or 0
    )
    followers_details: List[Dict[str, Any]] = list(target.get("followersDetails") or [])

    if target_uid not in viewer_following:
        viewer_following.add(target_uid)
        target_followers.add(viewer_uid)
        followers_count += 1

        # build/refresh follower detail entry from viewer's info
        follower_name = _best_full_name(viewer)
        follower_slug = _ensure_slug_in_user(viewer)
        follower_entry = {
            "uid": viewer_uid,
            "fullName": follower_name,
            "slug": follower_slug,
        }
        followers_details = _upsert_follower_details(followers_details, follower_entry)

        # Persist
        transaction.update(viewer_ref, {"following": list(viewer_following)})
        transaction.update(target_ref, {
            "followers": list(target_followers),
            "followersCount": followers_count,
            "followersDetails": followers_details,
        })

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
    followers_count = _safe_int(
        target.get("followersCount") or target.get("stats", {}).get("followers") or 0
    )
    followers_details: List[Dict[str, Any]] = list(target.get("followersDetails") or [])

    if target_uid in viewer_following:
        viewer_following.remove(target_uid)
        if viewer_uid in target_followers:
            target_followers.remove(viewer_uid)
        followers_count = max(0, followers_count - 1)

        # remove the viewer from followersDetails
        followers_details = _remove_follower_details(followers_details, viewer_uid)

        transaction.update(viewer_ref, {"following": list(viewer_following)})
        transaction.update(target_ref, {
            "followers": list(target_followers),
            "followersCount": followers_count,
            "followersDetails": followers_details,
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

# ------------------------------------------------------------
# Maintenance helpers
# ------------------------------------------------------------

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

def ensure_user_slug(uid: str, user: Dict[str, Any]) -> Dict[str, Any]:
    """
    (Re-declared above; kept here for clarity if importing elsewhere)
    Ensure a 'slug' exists for this user; if missing, derive and persist it.
    """
    if user.get("slug"):
        return user
    s = derive_slug(user)
    if s:
        _get_user_doc(uid).update({"slug": s})
        user["slug"] = s
    return user

class Experience(TypedDict, total=False):
    id: str
    title: str
    company: str
    employmentType: str
    location: str
    startDate: str     # ISO yyyy-mm (or yyyy-mm-dd; stored as yyyy-mm)
    endDate: str       # ISO yyyy-mm (or yyyy-mm-dd; stored as yyyy-mm)
    current: bool
    description: str
    skills: List[str]          # NEW canonical
    technologies: List[str]    # deprecated (read-only compat if old data exists)
    logoUrl: str
    createdAt: str
    updatedAt: str

# --- add these helpers somewhere below the Experience type ---

def _normalize_month(s: Optional[str]) -> Optional[str]:
    """
    Accepts 'YYYY-MM' or 'YYYY-MM-DD' and returns 'YYYY-MM'.
    Returns None if input is falsy or malformed.
    """
    if not s:
        return None
    s = str(s).strip()
    # simple sanity checks
    if len(s) >= 7 and s[4] == "-" and s[0:4].isdigit() and s[5:7].isdigit():
        return s[:7]
    return None

def _normalize_str_list(val: Any) -> List[str]:
    """
    Accepts list[str] or comma/newline-separated string and returns a clean list[str].
    """
    if val is None:
        return []
    if isinstance(val, list):
        out = [str(x).strip() for x in val if str(x).strip()]
        return out[:20]
    s = str(val)
    parts = re.split(r"[\n,]", s)
    out = [p.strip() for p in parts if p.strip()]
    return out[:20]

def _validate_and_canonicalize_experience_input(data: Dict[str, Any]) -> Tuple[Optional[Experience], Optional[str]]:
    """
    Validates client payload for creating/updating an experience.
    Returns (clean_experience_dict, error_message or None).
    - Required: title, company, startDate
    - Must provide endDate unless current=True
    - Stores dates as 'YYYY-MM'
    - Uses 'skills' as canonical; falls back to 'technologies' if provided
    """
    if not isinstance(data, dict):
        return None, "Invalid payload"

    title = str(data.get("title", "")).strip()
    company = str(data.get("company", "")).strip()
    start_raw = data.get("startDate")
    end_raw = data.get("endDate")
    current = bool(data.get("current", False))

    if not title or not company:
        return None, "Title and company are required."

    startDate = _normalize_month(start_raw)
    if not startDate:
        return None, "startDate must be 'YYYY-MM' (or 'YYYY-MM-DD')."

    endDate = _normalize_month(end_raw) if not current else None
    if not current and not endDate:
        return None, "Either set current=true or provide a valid endDate ('YYYY-MM' or 'YYYY-MM-DD')."

    employmentType = str(data.get("employmentType", "")).strip() or None
    location = str(data.get("location", "")).strip() or None
    description = str(data.get("description", "")).strip() or None
    logoUrl = str(data.get("logoUrl", "")).strip() or None

    # Canonical skills; accept legacy 'technologies' for compatibility
    skills = _normalize_str_list(
        data.get("skills", data.get("technologies"))
    )

    clean: Experience = {
        "title": title,
        "company": company,
        "startDate": startDate,
        "current": current,
    }
    if employmentType: clean["employmentType"] = employmentType
    if location:       clean["location"] = location
    if endDate:        clean["endDate"] = endDate
    if description:    clean["description"] = description
    if logoUrl:        clean["logoUrl"] = logoUrl
    if skills:         clean["skills"] = skills

    return clean, None

def add_my_experience(authorization_header: Optional[str], payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a new experience under the authenticated user's 'users/{uid}/experience' subcollection.
    - Verifies Firebase ID token from the provided Authorization header.
    - Validates and normalizes the payload (no highlights/order; uses 'skills').
    - Returns: { ok: True, item: Experience } on success; { ok: False, error: str } on failure.
    """
    uid = verify_bearer_uid(authorization_header)
    if not uid:
        return {"ok": False, "error": "unauthorized"}

    clean, err = _validate_and_canonicalize_experience_input(payload or {})
    if err:
        return {"ok": False, "error": err}

    try:
        item = upsert_experience(uid, cast(Dict[str, Any], clean))
        # Compatibility: if old readers expect 'technologies', mirror from skills in response only
        if "skills" in item and "technologies" not in item:
            item["technologies"] = list(item.get("skills") or [])
        return {"ok": True, "item": item}
    except Exception as e:
        return {"ok": False, "error": f"failed to save experience: {e}"}



def _experience_collection(uid: str):
    return _get_user_doc(uid).collection("experience")


def list_experience_for_uid(uid: str) -> List[Experience]:
    """
    Returns experience for a user, auto-ordered:
      1. Current roles first (sorted by startDate desc)
      2. Then past roles (sorted by endDate desc, fallback startDate desc)
    """
    docs = list(_experience_collection(uid).stream())
    items: List[Experience] = []
    for d in docs:
        data = d.to_dict() or {}
        data["id"] = d.id

        # migrate legacy: map old technologies -> skills
        if "skills" not in data and "technologies" in data:
            data["skills"] = list(data.get("technologies") or [])

        items.append(cast(Experience, data))

    def sort_key(x: Dict[str, Any]):
        current = bool(x.get("current"))
        start = str(x.get("startDate") or "")
        end = str(x.get("endDate") or "")

        # current roles: rank highest, then sort by startDate
        if current:
            return (0, start)  # bucket 0 = current, sort by start desc later

        # past roles: bucket 1, prefer endDate; if missing, fallback to startDate
        key_date = end or start
        return (1, key_date)

    # sort by bucket, then date desc (reverse=True)
    items.sort(key=sort_key, reverse=True)
    return items



def list_experience_for_slug(slug: str) -> List[Experience]:
    u = get_user_by_slug(slug)
    if not u:
        return []
    return list_experience_for_uid(u["id"])


def upsert_experience(uid: str, data: Dict[str, Any], exp_id: Optional[str] = None) -> Experience:
    """
    Creates or updates a single experience row.
    """
    now = datetime.utcnow().isoformat()
    col = _experience_collection(uid)
    if exp_id:
        ref = col.document(exp_id)
        in_db = ref.get().to_dict() or {}
        merged = {**in_db, **data, "updatedAt": now}
        ref.set(merged, merge=True)
        merged["id"] = exp_id
        return merged  # type: ignore[return-value]
    else:
        doc_ref = col.document()
        payload = {**data, "createdAt": now, "updatedAt": now}
        doc_ref.set(payload)
        payload["id"] = doc_ref.id
        return payload  # type: ignore[return-value]