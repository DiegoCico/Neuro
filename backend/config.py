# app.py
from __future__ import annotations

from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
import os

import base64, io, numpy as np

import profiles_api as profiles
from search import search_users

from PIL import Image
from face_store import save_face_enrollment

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000")

SERVICE_ACCOUNT_PATH = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "neru-b3128-firebase-adminsdk-fbsvc-11110f3ad3.json",
)

if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)

db = firestore.client()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}})

@app.get("/")
def health():
    return jsonify({"ok": True, "service": "profiles-api"})

@app.get("/api/search/users")
def api_search_users():
    q = (request.args.get("q") or "").strip()
    try:
        limit = int(request.args.get("limit") or "8")
    except Exception:
        limit = 8
    items = search_users(q, limit=limit)
    return jsonify({"items": items})

@app.post("/api/users/<slug>/follow")
def api_follow(slug: str):
    uid = profiles.verify_bearer_uid(request.headers.get("Authorization"))
    if not uid:
        return jsonify({"error": "unauthorized"}), 401
    try:
        result = profiles.follow_user(uid, slug.lower())
        return jsonify(result)
    except LookupError:
        return jsonify({"error": "not found"}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "internal"}), 500

@app.post("/api/users/<slug>/unfollow")
def api_unfollow(slug: str):
    uid = profiles.verify_bearer_uid(request.headers.get("Authorization"))
    if not uid:
        return jsonify({"error": "unauthorized"}), 401
    try:
        result = profiles.unfollow_user(uid, slug.lower())
        return jsonify(result)
    except LookupError:
        return jsonify({"error": "not found"}), 404
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": "internal"}), 500

@app.get("/api/me")
def api_me():
    uid = profiles.verify_bearer_uid(request.headers.get("Authorization"))
    if not uid:
        return jsonify({"error": "unauthorized"}), 401

    user = profiles.get_user_by_uid(uid)
    if not user:
        return jsonify({"error": "not found"}), 404

    user = profiles.ensure_user_slug(uid, user)
    return jsonify(user)

@app.get("/api/users/<slug>")
def api_user_by_slug(slug: str):
    user = profiles.get_user_by_slug(slug)
    if not user:
        return jsonify({"error": "not found", "code": "USER_NOT_FOUND"}), 404
    return jsonify(user)

@app.post("/api/admin/backfill-slugs")
def admin_backfill_slugs():
    # Example gate (optional): require ADMIN_UID env + valid token
    # admin_uid = os.getenv("ADMIN_UID")
    # uid = profiles.verify_bearer_uid(request.headers.get("Authorization"))
    # if not uid or uid != admin_uid:
    #     return jsonify({"error": "forbidden"}), 403
    updated = profiles.backfill_all_slugs()
    return jsonify({"updated": updated})

@app.post("/api/admin/upsert-user")
def admin_upsert_user():
    body = request.get_json(force=True, silent=True) or {}
    uid = body.get("uid")
    if not uid:
        return jsonify({"error": "uid required"}), 400
    data = {k: v for k, v in body.items() if k != "uid"}
    user = profiles.upsert_user(uid, data)
    return jsonify(user)

@app.post("/api/enroll-face")
def enroll_face():
    data = request.get_json(silent=True) or {}
    uid = data.get("user_id")
    frames = data.get("frames", [])

    print(f"[enroll_face] Received enrollment for uid: {uid} with {len(frames)} frames")  # LOG

    result = save_face_enrollment(uid, frames)
    return jsonify(result), (200 if result.get("ok") else 400)

@app.get("/api/users/<slug>/experience")
def api_list_experience(slug: str):
    try:
        items = profiles.list_experience_for_slug(slug.lower().strip())
        return jsonify({"ok": True, "items": items})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    
@app.post("/api/me/experience")
def api_add_my_experience():
    authz = request.headers.get("Authorization")
    payload = request.get_json(silent=True) or {}

    res = profiles.add_my_experience(authz, payload)
    if not res.get("ok"):
        # map auth vs validation errors to useful HTTP codes
        err = (res.get("error") or "").lower()
        if "unauthorized" in err:
            return jsonify(res), 401
        return jsonify(res), 400

    return jsonify(res), 200

@app.put("/api/me/experience/<exp_id>")
@app.patch("/api/me/experience/<exp_id>")
def api_update_my_experience(exp_id: str):
    authz = request.headers.get("Authorization")
    uid = profiles.verify_bearer_uid(authz)
    if not uid:
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    payload = request.get_json(silent=True) or {}
    clean, err = profiles._validate_and_canonicalize_experience_input(payload)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    item = profiles.upsert_experience(uid, dict(clean or {}), exp_id=exp_id)
    if "skills" in item and "technologies" not in item:
        item["technologies"] = list(item.get("skills") or [])
    return jsonify({"ok": True, "item": item})

@app.delete("/api/me/experience/<exp_id>")
def api_delete_my_experience(exp_id: str):
    authz = request.headers.get("Authorization")
    uid = profiles.verify_bearer_uid(authz)
    if not uid:
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    ref = profiles._experience_collection(uid).document(exp_id)
    ref.delete()
    return jsonify({"ok": True})

@app.get("/api/profile/me")
def api_profile_me():
    uid = profiles.verify_bearer_uid(request.headers.get('Authorization'))
    if not uid:
        return jsonify({"ok": False, "error": "unauthorized"}), 401
    
    user = profiles.get_user_by_uid(uid)
    if not user:
        return jsonify({"ok": False, "error": "not found"}), 404
    
    user = profiles.ensure_user_slug(uid, user)
    return jsonify({"ok": True, "profile": user}), 200

@app.get("/api/profile/by-slug/<slug>")
def api_profile_by_slug(slug: str):
    user = profiles.get_user_by_slug(slug or "")
    if not user:
        return jsonify({"ok": False, "error": "not found"}), 404
    return jsonify({"ok": True, "profile": user}), 200

@app.post("/api/profile/about")
def update_profile_about():
    auth_header = request.headers.get("Authorization")
    uid = profiles.verify_bearer_uid(auth_header)
    if not uid:
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    about = {
        "title": data.get("title", "").strip(),
        "bio": data.get("bio", "").strip(),
        "currentFocus": data.get("currentFocus", "").strip(),
        "beyondWork": data.get("beyondWork", "").strip(),
    }

    # Save into Firestore as a sub-document
    profiles._get_user_doc(uid).collection("about").document("main").set(about, merge=True)

    return jsonify({"ok": True, "about": about}), 200

@app.get("/api/profile/about/<slug>")
def get_profile_about(slug: str):
    try:
        user = profiles.get_user_by_slug(slug)
        if not user:
            return jsonify({"ok": False, "error": "not found"}), 404

        uid = user["id"]
        doc = profiles._get_user_doc(uid).collection("about").document("main").get()
        about = doc.to_dict() if doc.exists else {}

        return jsonify({"ok": True, "about": about, "uid": uid}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)