# messagers.py
from __future__ import annotations

from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from datetime import datetime

from firebase_admin import firestore

# Use a fresh client each call (safe under firebase_admin)
def _db():
    return firestore.client()

# ----------------------------
# Helpers
# ----------------------------

def _conv_id_for(a: str, b: str) -> str:
    """Deterministic 2-user conversation id."""
    x, y = sorted([a.strip(), b.strip()])
    return f"{x}__{y}"

def _conv_ref(uid_a: str, uid_b: str):
    return _db().collection("conversations").document(_conv_id_for(uid_a, uid_b))

def _clean_text(s: str, max_len: int = 5000) -> str:
    s = (s or "").strip()
    if len(s) > max_len:
        s = s[:max_len]
    return s

def _ensure_participants(conv_ref, a: str, b: str) -> None:
    conv_ref.set({"participants": [a, b]}, merge=True)

def _serialize_ts(ts: Optional[datetime]) -> Dict[str, Any]:
    """Return dict with both ISO string and ms since epoch (if ts exists)."""
    if not ts:
        return {"createdAt": None, "createdAtMs": None}
    # firestore returns a native datetime with tzinfo=UTC in Admin SDK
    ms = int(ts.timestamp() * 1000)
    return {"createdAt": ts.isoformat(), "createdAtMs": ms}

# ----------------------------
# Public API used by routers
# ----------------------------

def send_message(uid: str, to_uid: str, text: str) -> Dict[str, Any]:
    """
    Create (if needed) a conversation for (uid, to_uid) and append a message.
    Uses server timestamp so clients can order chronologically.
    Returns: { ok, conversationId, messageId }
    """
    uid = (uid or "").strip()
    to_uid = (to_uid or "").strip()
    text = _clean_text(text)

    if not uid:
        return {"ok": False, "error": "unauthorized"}
    if not to_uid:
        return {"ok": False, "error": "missing 'to' uid"}
    if uid == to_uid:
        return {"ok": False, "error": "cannot message yourself"}
    if not text:
        return {"ok": False, "error": "empty message"}

    conv = _conv_ref(uid, to_uid)
    _ensure_participants(conv, uid, to_uid)

    msg_ref = conv.collection("messages").document()  # auto id
    msg_ref.set({
        "from": uid,
        "to": to_uid,
        "text": text,
        "createdAt": firestore.SERVER_TIMESTAMP,  # ✅ server-side time
    })

    return {"ok": True, "conversationId": conv.id, "messageId": msg_ref.id}


def get_thread(uid: str, other_uid: str, limit: int = 100) -> Dict[str, Any]:
    """
    Fetch the messages in the 2-party conversation (uid, other_uid),
    ordered chronologically by createdAt (ascending).
    Returns: { ok, conversationId, messages: [{id, from, to, text, createdAt, createdAtMs}, ...] }
    """
    uid = (uid or "").strip()
    other_uid = (other_uid or "").strip()
    if not uid:
        return {"ok": False, "error": "unauthorized"}
    if not other_uid:
        return {"ok": False, "error": "missing 'other_uid'"}

    conv = _conv_ref(uid, other_uid)
    msgs_col = conv.collection("messages")

    # Prefer server-side ordering; if the field is missing on legacy docs,
    # fall back to fetching and sorting in Python.
    messages: List[Dict[str, Any]] = []
    try:
        snap = msgs_col.order_by("createdAt", direction=firestore.Query.ASCENDING).limit(limit).get()
        for d in snap:
            doc = d.to_dict() or {}
            ts = doc.get("createdAt")
            ser = _serialize_ts(ts)
            messages.append({
                "id": d.id,
                "from": doc.get("from"),
                "to": doc.get("to"),
                "text": doc.get("text", ""),
                **ser,
            })
    except Exception:
        # Fallback: no index / field missing — fetch & sort locally by createdAtMs then by id
        snap = msgs_col.limit(limit).get()
        tmp: List[Dict[str, Any]] = []
        for d in snap:
            doc = d.to_dict() or {}
            ts = doc.get("createdAt")
            ser = _serialize_ts(ts)
            tmp.append({
                "id": d.id,
                "from": doc.get("from"),
                "to": doc.get("to"),
                "text": doc.get("text", ""),
                **ser,
            })
        tmp.sort(key=lambda m: (m.get("createdAtMs") or 0, m["id"]))
        messages = tmp

    return {"ok": True, "conversationId": conv.id, "messages": messages}


def list_partners(uid: str, max_conversations: int = 50) -> Dict[str, Any]:
    """
    Return a unique list of UIDs the user has conversations with.
    Returns: { ok, partners: [uid1, uid2, ...] }
    """
    uid = (uid or "").strip()
    if not uid:
        return {"ok": False, "error": "unauthorized"}

    db = _db()
    q = db.collection("conversations").where("participants", "array_contains", uid).limit(max_conversations)
    convs = q.get()

    partners: List[str] = []
    for c in convs:
        parts = (c.to_dict() or {}).get("participants", [])
        for p in parts:
            if p != uid and p not in partners:
                partners.append(p)

    return {"ok": True, "partners": partners}


def seed_demo(requester_uid: str, a: str, b: str) -> Dict[str, Any]:
    """
    Dev helper to seed a tiny back-and-forth between a and b.
    Caller must be authenticated (checked in router). We don't enforce
    requester_uid must be a or b — this is a dev utility.
    Returns: { ok, conversationId, seeded }
    """
    requester_uid = (requester_uid or "").strip()
    a = (a or "").strip()
    b = (b or "").strip()

    if not requester_uid:
        return {"ok": False, "error": "unauthorized"}
    if not a or not b or a == b:
        return {"ok": False, "error": "need two different uids 'a' and 'b'"}

    conv = _conv_ref(a, b)
    _ensure_participants(conv, a, b)

    msgs = [
        {"from": a, "to": b, "text": "Hey there!", "createdAt": firestore.SERVER_TIMESTAMP},
        {"from": b, "to": a, "text": "Yo! All good?", "createdAt": firestore.SERVER_TIMESTAMP},
        {"from": a, "to": b, "text": "Building the messenger 👨‍💻", "createdAt": firestore.SERVER_TIMESTAMP},
    ]

    batch = _db().batch()
    for m in msgs:
        batch.set(conv.collection("messages").document(), m)
    batch.commit()

    return {"ok": True, "conversationId": conv.id, "seeded": len(msgs)}
