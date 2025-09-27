# app.py
from __future__ import annotations

import os
from flask import Flask, request, jsonify
from flask_cors import CORS

import profiles_api as profiles

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}})

@app.get("/")
def health():
    return jsonify({"ok": True, "service": "profiles-api"})

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
    pass

if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
