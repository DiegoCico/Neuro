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


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
