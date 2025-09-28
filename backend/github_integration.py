# backend/github_public.py
from __future__ import annotations

import re
import requests
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from firebase_admin import firestore

db = firestore.client()

# ---------- helpers ----------

def _json_error(code: int, msg: str, **extra):
    return jsonify({"ok": False, "error": msg, **extra}), code

def _users_col():
    return db.collection("users")

def _profile_by_slug(slug: str):
    slug = (slug or "").strip().lower()
    if not slug:
        return None
    q = _users_col().where("slug", "==", slug).limit(1).stream()
    for d in q:
        doc = d.to_dict() or {}
        doc["id"] = d.id
        return doc
    return None

def _extract_github_username_from_profile(doc: dict) -> str | None:
    """
    Try a few common places where you might have stored the GitHub username
    on your user document.
    """
    if not doc:
        return None

    # 1) Nested object: { github: { username: "diego" } }
    gh = doc.get("github") or {}
    if isinstance(gh, dict):
        u = gh.get("username")
        if isinstance(u, str) and u.strip():
            return u.strip()

    # 2) Flat field: { githubUsername: "diego" }
    u = doc.get("githubUsername")
    if isinstance(u, str) and u.strip():
        return u.strip()

    # 3) Links object: { links: { github: "https://github.com/diego" } }
    links = doc.get("links") or {}
    if isinstance(links, dict):
        gh_url = links.get("github")
        if isinstance(gh_url, str) and gh_url.strip():
            # Extract last path segment as username
            m = re.search(r"github\.com/([^/?#]+)", gh_url)
            if m:
                return m.group(1)

    # 4) As a last resort: { social: { github: "diego" } } or similar
    social = doc.get("social") or {}
    if isinstance(social, dict):
        u = social.get("github")
        if isinstance(u, str) and u.strip():
            return u.strip()

    return None

def _gh_get_user_repos(username: str, limit: int):
    """
    Fetch public repos for a user via GitHub's public API (no token).
    Sorted by update (desc) via query params.
    """
    url = f"https://api.github.com/users/{username}/repos"
    try:
        res = requests.get(
            url,
            params={"sort": "updated", "per_page": str(limit)},
            headers={"Accept": "application/vnd.github+json", "User-Agent": "NeuroApp/1.0"},
            timeout=15,
        )
    except requests.RequestException as e:
        return None, f"Network error contacting GitHub: {e}"

    if res.status_code == 404:
        return [], None  # user not found -> just show none
    if res.status_code != 200:
        # Soft-fail to empty list to avoid noisy UI; attach status if needed
        return [], None

    data = res.json() or []
    # Normalize / pick fields we care about
    items = []
    for r in data:
        items.append({
            "id": r.get("id"),
            "name": r.get("name"),
            "html_url": r.get("html_url"),
            "description": r.get("description"),
            "stargazers_count": r.get("stargazers_count"),
            "forks_count": r.get("forks_count"),
            "language": r.get("language"),
            "updated_at": r.get("updated_at"),
            "private": r.get("private"),
            "archived": r.get("archived"),
        })
    # API already sorts by updated desc, but ensure:
    items.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
    return items[:limit], None

# ---------- routes ----------
