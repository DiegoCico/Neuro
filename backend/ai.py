# ai.py
from __future__ import annotations
import os
import re
import time
from dataclasses import dataclass
from typing import List, Dict, Any

from flask import request
from firebase_admin import auth, firestore
from dotenv import load_dotenv

load_dotenv()
db = firestore.client()

# -----------------------------------------------------------------------------
# Gemini config
# -----------------------------------------------------------------------------
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

MAX_MSGS = 5
MIN_SECONDS_BETWEEN_CALLS = 0.8  # was 2.0
_last_call_at: Dict[str, float] = {}
_inflight_user: Dict[str, bool] = {}  # simple in-flight guard per uid

# -----------------------------------------------------------------------------
# Data
# -----------------------------------------------------------------------------
@dataclass
class Msg:
    id: str
    from_uid: str
    to_uid: str
    text: str
    created_at: Any

# -----------------------------------------------------------------------------
# Auth / Rate-limit
# -----------------------------------------------------------------------------
def return_api_key():
    return str(GOOGLE_API_KEY)

def _require_auth() -> str:
    authz = request.headers.get("Authorization", "")
    m = re.match(r"^Bearer\s+(.+)$", authz, re.I)
    if not m:
        raise PermissionError("Missing Authorization Bearer token")
    id_token = m.group(1)
    decoded = auth.verify_id_token(id_token)
    return decoded["uid"]

def _conv_id_for(a: str, b: str) -> str:
    return "__".join(sorted([a, b]))

def _rate_limit(uid: str):
    now = time.time()
    last = _last_call_at.get(uid, 0.0)
    if now - last < MIN_SECONDS_BETWEEN_CALLS:
        raise RuntimeError("Please wait a moment before asking again.")
    _last_call_at[uid] = now

# -----------------------------------------------------------------------------
# Firestore
# -----------------------------------------------------------------------------
def _fetch_last_messages(conv_id: str, limit: int = MAX_MSGS) -> List[Msg]:
    """
    Read from conversations/{convId}/messages only (no composite index needed).
    Returns newest -> oldest (DESC). _build_prompt() already reverses to chronological.
    """
    msgs: List[Msg] = []
    col = (
        db.collection("conversations")
        .document(conv_id)
        .collection("messages")
    )

    def _to_epoch_ms(v) -> int:
        # Normalize Firestore Timestamp / seconds / ms to epoch ms (int)
        try:
            # google.cloud.firestore_v1._helpers.Timestamp has .timestamp()
            return int(v.timestamp() * 1000)  # type: ignore[attr-defined]
        except Exception:
            pass
        if isinstance(v, (int, float)):
            # Heuristic: >= 1e12 already ms, else seconds
            return int(v if v >= 1_000_000_000_000 else v * 1000)
        return 0

    # Preferred path: order by createdAt DESC (single-field index not required)
    try:
        q = col.order_by("createdAt", direction=firestore.Query.DESCENDING).limit(limit)
        docs = list(q.stream())
    except Exception:
        # Fallback: no order_by, then sort in memory by createdAt/createdAtMs DESC
        docs = list(col.limit(limit).stream())
        docs.sort(
            key=lambda d: _to_epoch_ms((d.to_dict() or {}).get("createdAt"))
                          or int((d.to_dict() or {}).get("createdAtMs") or 0),
            reverse=True,
        )

    for d in docs:
        data = d.to_dict() or {}
        msgs.append(
            Msg(
                id=d.id,
                from_uid=data.get("from", ""),
                to_uid=data.get("to", ""),
                text=data.get("text", ""),
                created_at=data.get("createdAt"),
            )
        )

    return msgs

# -----------------------------------------------------------------------------
# Prompt
# -----------------------------------------------------------------------------
def _build_prompt(messages: List[Msg], me_uid: str) -> str:
    ordered = list(reversed(messages))
    lines = []
    for m in ordered:
        role = "ME" if m.from_uid == me_uid else "THEM"
        t = (m.text or "").strip()
        if t:
            lines.append(f"{role}: {t}")
    history = "\n".join(lines) if lines else "(No prior messages)"

    return f"""You are assisting a user in a chat. Read the last few messages and craft the NEXT single reply the user (ME) should send.

Goals:
- Mirror the existing tone but keep it professional, clear, and friendly.
- Be concise (1–3 sentences). No greetings unless context calls for it.
- If there's a question to answer, answer directly. If next step is needed, propose one.
- Avoid emojis unless prior tone clearly uses them.
- Output only the reply text, with no quotes or role tags.

Conversation (oldest → newest):
{history}

Return ONLY the reply text for ME to send next.
"""

# -----------------------------------------------------------------------------
# Gemini callers
# -----------------------------------------------------------------------------
def _call_gemini_new(prompt: str) -> str:
    if not GOOGLE_API_KEY:
        raise RuntimeError("GOOGLE_API_KEY environment variable is not set")

    try:
        client = NEW_GENAI.Client(api_key=GOOGLE_API_KEY)  # type: ignore
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)  # type: ignore
        text = getattr(resp, "text", None)
        if not text:
            cand = getattr(resp, "candidates", None)
            if cand:
                try:
                    parts = cand[0].content.parts
                    text = "".join(getattr(p, "text", "") for p in parts)
                except Exception:
                    pass
        if not text or not text.strip():
            raise RuntimeError("Empty response from Gemini (new SDK)")
        return text.strip()
    except Exception as e:
        # Surface SDK errors as RuntimeError (so route returns 400 with details)
        print(f"[ai] Gemini NEW error: {type(e).__name__}: {e}")
        raise RuntimeError(f"Gemini error (new): {type(e).__name__}: {e}")

def _call_gemini_old(prompt: str) -> str:
    if not GOOGLE_API_KEY:
        raise RuntimeError("GOOGLE_API_KEY environment variable is not set")

    try:
        OLD_GENAI.configure(api_key=GOOGLE_API_KEY)  # type: ignore
        model = OLD_GENAI.GenerativeModel(GEMINI_MODEL)  # type: ignore
        resp = model.generate_content(prompt)
        text = getattr(resp, "text", None)
        if not text and hasattr(resp, "candidates") and resp.candidates:
            parts = getattr(resp.candidates[0].content, "parts", [])
            text = "".join(getattr(p, "text", "") for p in parts)
        if not text or not text.strip():
            raise RuntimeError("Empty response from Gemini (old SDK)")
        return text.strip()
    except Exception as e:
        print(f"[ai] Gemini OLD error: {type(e).__name__}: {e}")
        raise RuntimeError(f"Gemini error (old): {type(e).__name__}: {e}")

def _call_gemini(prompt: str) -> str:
    if GENAI_MODE == "new" and NEW_GENAI is not None:
        return _call_gemini_new(prompt)
    if GENAI_MODE == "old" and OLD_GENAI is not None:
        return _call_gemini_old(prompt)
    raise RuntimeError(
        "No Gemini SDK found. Install one of:\n"
        "  pip install google-genai        # new client (from google import genai)\n"
        "  or\n"
        "  pip install google-generativeai # legacy client"
    )

# Optional: log once
print(f"[ai] GENAI_MODE={GENAI_MODE}, MODEL={GEMINI_MODEL}")
