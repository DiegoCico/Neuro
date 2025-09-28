# automation.py
from __future__ import annotations

import os
import re
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, request, jsonify
from firebase_admin import auth as fb_auth, firestore

# Optional Google Calendar / Meet imports (graceful fallback if not installed)
try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    _GOOGLE_OK = True
except Exception:
    _GOOGLE_OK = False

# --------------------------------------------------------------------------------------
# Blueprint
# --------------------------------------------------------------------------------------

db = firestore.client()

# --------------------------------------------------------------------------------------
# Helpers: auth, errors, utils
# --------------------------------------------------------------------------------------

def _json_error(code: int, msg: str, **extra):
    payload = {"ok": False, "error": msg, **extra}
    return jsonify(payload), code

def _bearer_token() -> Optional[str]:
    hdr = request.headers.get("Authorization", "")
    if hdr.startswith("Bearer "):
        return hdr.split(" ", 1)[1].strip()
    return None

def _require_user() -> Tuple[Optional[Dict[str, Any]], Optional[Tuple[Any, int]]]:
    """
    Verifies Firebase ID token. Returns (user_claims, flask_error_response)
    """
    token = _bearer_token()
    if not token:
        return None, _json_error(401, "Missing Authorization: Bearer <token>")
    try:
        claims = fb_auth.verify_id_token(token)
        return claims, None
    except Exception as e:
        return None, _json_error(401, f"Invalid token: {e}")

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _conv_id_for(a: str, b: str) -> str:
    return "__".join(sorted([a, b]))

def _safe_email(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    # extremely light validation
    if "@" in s and "." in s.split("@")[-1]:
        return s
    return None

# --------------------------------------------------------------------------------------
# ADK-like Analyze (stub with rules; swap in Google ADK call where marked)
# --------------------------------------------------------------------------------------

POS_WORDS = r"\b(yes|interested|sounds good|great|awesome|sure|let'?s do it|keen)\b"
NEG_WORDS = r"\b(no|not interested|stop|unsubscribe|never|remove me|pass)\b"
LATER_WORDS = r"\b(later|busy|another time|next week|follow up|remind)\b"

def _infer_intent(text: str) -> Dict[str, str]:
    t = text.strip().lower()
    if not t:
        return {"sentiment": "neutral", "intent": "unknown"}

    if re.search(NEG_WORDS, t, flags=re.I):
        return {"sentiment": "negative", "intent": "no"}
    if re.search(LATER_WORDS, t, flags=re.I):
        return {"sentiment": "neutral", "intent": "later"}
    if re.search(POS_WORDS, t, flags=re.I):
        return {"sentiment": "positive", "intent": "yes"}

    # naive sentiment
    pos = len(re.findall(r"\b(good|great|thanks|thank you|helpful|love)\b", t))
    neg = len(re.findall(r"\b(bad|hate|terrible|annoyed|spam)\b", t))
    sentiment = "positive" if pos > neg else "negative" if neg > pos else "neutral"
    return {"sentiment": sentiment, "intent": "unknown"}

# --------------------------------------------------------------------------------------
# Google Meet Scheduling (Calendar API with service account or graceful fallback)
# --------------------------------------------------------------------------------------

def _google_calendar_build() -> Optional[Any]:
    """
    Returns a Calendar service client if environment is configured, else None.

    Required env:
      - GOOGLE_SERVICE_ACCOUNT_JSON (path to service account JSON) OR raw JSON in GOOGLE_SERVICE_ACCOUNT_INFO
      - (optional) GOOGLE_IMPERSONATE_EMAIL (user to impersonate for Calendar)
    The service account must have domain-wide delegation enabled if impersonating.
    """
    if not _GOOGLE_OK:
        return None

    info_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    info_raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_INFO")
    impersonate = os.getenv("GOOGLE_IMPERSONATE_EMAIL")

    creds = None
    try:
        if info_raw:
            info = json.loads(info_raw)
            creds = service_account.Credentials.from_service_account_info(info, scopes=[
                "https://www.googleapis.com/auth/calendar",
            ])
        elif info_path and os.path.exists(info_path):
            creds = service_account.Credentials.from_service_account_file(info_path, scopes=[
                "https://www.googleapis.com/auth/calendar",
            ])
        else:
            return None

        if impersonate:
            creds = creds.with_subject(impersonate)

        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        return service
    except Exception:
        return None

def _create_google_meet_event(
    title: str,
    start_iso: str,
    duration_mins: int,
    attendees_emails: List[str],
    timezone_str: str = "America/New_York",
) -> Dict[str, Any]:
    """
    Tries to create a Calendar event with a Meet link.
    Returns { ok, meetUrl, eventId, calendarId, raw }.
    Falls back to a placeholder meetUrl if API is unavailable.
    """
    service = _google_calendar_build()
    start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    end_dt = start_dt + timedelta(minutes=max(15, duration_mins or 30))

    if service is None:
        # Fallback: not configured — return a fake-but-stable meet URL token so the flow continues.
        fake_url = f"https://meet.google.com/{uuid.uuid4().hex[:3]}-{uuid.uuid4().hex[4:7]}-{uuid.uuid4().hex[8:12]}"
        return {"ok": True, "meetUrl": fake_url, "eventId": None, "calendarId": None, "raw": None, "note": "Fallback (no Google API configured)"}

    attendees = []
    for e in attendees_emails:
        safe = _safe_email(e)
        if safe:
            attendees.append({"email": safe})

    event = {
        "summary": title or "Intro chat",
        "start": {"dateTime": start_dt.isoformat(), "timeZone": timezone_str},
        "end": {"dateTime": end_dt.isoformat(), "timeZone": timezone_str},
        "conferenceData": {"createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}},
        "attendees": attendees,
    }

    try:
        created = service.events().insert(calendarId="primary", body=event, conferenceDataVersion=1).execute()
        meet_url = None
        conf = created.get("conferenceData", {})
        entry_points = conf.get("entryPoints", []) if conf else []
        for ep in entry_points:
            if ep.get("entryPointType") == "video":
                meet_url = ep.get("uri")
                break
        # Some tenants expose meet link under "hangoutLink"
        if not meet_url:
            meet_url = created.get("hangoutLink")

        return {
            "ok": True,
            "meetUrl": meet_url,
            "eventId": created.get("id"),
            "calendarId": created.get("organizer", {}).get("email") or "primary",
            "raw": created,
        }
    except Exception as e:
        # Fallback on API failure
        fake_url = f"https://meet.google.com/{uuid.uuid4().hex[:3]}-{uuid.uuid4().hex[4:7]}-{uuid.uuid4().hex[8:12]}"
        return {"ok": False, "meetUrl": fake_url, "error": str(e), "eventId": None, "calendarId": None, "raw": None}

