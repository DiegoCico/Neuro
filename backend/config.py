# app.py
from __future__ import annotations

from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
import os

import base64, io, numpy as np

import network
import messager as msgs

import profiles_api as profiles
from search import search_users

from PIL import Image
from face_store import save_face_enrollment

import ai

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000")

SERVICE_ACCOUNT_PATH = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    "neru-b3128-firebase-adminsdk-fbsvc-11110f3ad3.json",
)

if not firebase_admin._apps:
    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)

db = firestore.client()

# app = Flask(__name__)
# CORS(app, resources={r"/*": {"origins": CORS_ORIGINS}})
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": CORS_ORIGINS,
                             "allow_headers": ["Content-Type", "Authorization"],
                             "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]}})


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
    
@app.post("/api/messages/send")
def api_msg_send():
    """POST body: { "to": "<otherUid>", "text": "<message>" }"""
    uid = profiles.verify_bearer_uid(request.headers.get("Authorization"))
    if not uid:
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    body = request.get_json(force=True, silent=True) or {}
    to_uid = (body.get("to") or "").strip()
    text = (body.get("text") or "").strip()

    try:
        res = msgs.send_message(uid, to_uid, text)
        if not res.get("ok"):
            return jsonify(res), 400
        return jsonify(res), 200
    except LookupError:
        return jsonify({"ok": False, "error": "not found"}), 404
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": "internal"}), 500


@app.get("/api/messages/with/<other_uid>")
def api_msg_thread(other_uid: str):
    """Retrieve the 2-party conversation with <other_uid>."""
    uid = profiles.verify_bearer_uid(request.headers.get("Authorization"))
    if not uid:
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    try:
        res = msgs.get_thread(uid, other_uid)
        if not res.get("ok"):
            return jsonify(res), 400
        return jsonify(res), 200
    except LookupError:
        return jsonify({"ok": False, "error": "not found"}), 404
    except Exception:
        return jsonify({"ok": False, "error": "internal"}), 500


@app.get("/api/messages/partners")
def api_msg_partners():
    """List UIDs the requester has conversations with."""
    uid = profiles.verify_bearer_uid(request.headers.get("Authorization"))
    if not uid:
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    try:
        res = msgs.list_partners(uid)
        if not res.get("ok"):
            return jsonify(res), 400
        return jsonify(res), 200
    except Exception:
        return jsonify({"ok": False, "error": "internal"}), 500


@app.post("/api/messages/seed-demo")
def api_msg_seed_demo():
    """
    Dev utility to seed a tiny back-and-forth:
    POST body: { "a": "<uidA>", "b": "<uidB>" }
    """
    uid = profiles.verify_bearer_uid(request.headers.get("Authorization"))
    if not uid:
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    body = request.get_json(force=True, silent=True) or {}
    a = (body.get("a") or "").strip()
    b = (body.get("b") or "").strip()

    try:
        res = msgs.seed_demo(uid, a, b)
        if not res.get("ok"):
            return jsonify(res), 400
        return jsonify(res), 200
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception:
        return jsonify({"ok": False, "error": "internal"}), 500
    
@app.get("/api/profile/by-uid/<uid>")
def api_profile_by_uid(uid: str):
    user = profiles.get_user_by_uid(uid)
    if not user:
        return jsonify({"ok": False, "error": "not found"}), 404
    # Ensure slug is present/consistent like elsewhere
    user = profiles.ensure_user_slug(uid, user)
    return jsonify({"ok": True, "profile": user}), 200

@app.route("/api/ai/suggest-reply", methods=["POST"])
def suggest_reply():
    """
    POST /api/ai/suggest-reply
    Headers: Authorization: Bearer <Firebase ID token>
    Body:    { "partnerUid": "abc123" }
    """
    try:
        me_uid = ai._require_auth()
        print(f"[AI] Request from uid={me_uid}")

        ai._rate_limit(me_uid)

        body = request.get_json(silent=True) or {}
        partner_uid = (body.get("partnerUid") or "").strip()
        print(f"[AI] partnerUid={partner_uid!r}, body={body}")

        if not partner_uid:
            return jsonify({"ok": False, "error": "Missing partnerUid"}), 400

        conv_id = ai._conv_id_for(me_uid, partner_uid)
        msgs = ai._fetch_last_messages(conv_id, ai.MAX_MSGS)
        print(f"[AI] conv_id={conv_id}, fetched {len(msgs)} msgs")

        prompt = ai._build_prompt(msgs, me_uid)
        print(f"[AI] prompt built (len={len(prompt)})")

        reply = ai._call_gemini(prompt)
        print(f"[AI] Gemini reply: {reply!r}")

        return jsonify({"ok": True, "reply": reply})

    except PermissionError as e:
        print(f"[AI] Permission error: {e}")
        return jsonify({"ok": False, "error": str(e)}), 401
    except RuntimeError as e:
        print(f"[AI] Runtime error: {e}")
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        import traceback
        print(f"[AI] Unexpected error: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"ok": False, "error": "Internal error"}), 500

@app.route('/api/posts', methods=["POST"])
def create_post():
    auth_header = request.headers.get('Authorization')
    uid = profiles.verify_bearer_uid(auth_header)
    if not uid:
        return jsonify({"ok": False, "error": "unauthorized"}), 401

    text = request.form.get("text", '').strip()

    media_url = None
    media_type = None

    doc_ref = db.collection('users').document(uid).get()
    data = doc_ref.to_dict()

    post = {
        'userId':uid,
        'userFullName':data.get('fullName'),
        'text':text,
        'mediaUrl':media_url,
        'mediaType':media_type,
        'createdAt':firestore.SERVER_TIMESTAMP,
        'likes':[],
        'commentsCount':0
    }

    doc_ref = db.collection('posts').document()
    doc_ref.set(post)

    saved_post = doc_ref.get().to_dict()
    saved_post["id"] = doc_ref.id

    return jsonify({"ok": True, "post": saved_post})

@app.route('/api/posts', methods=['GET'])
def fetch_posts():
    try:
        post_ref = db.collection('posts')

        docs = post_ref.stream()

        posts = []
        for doc in docs:
            data = doc.to_dict()
            data['id'] = doc.id

            created_at = data.get('createdAt')
            if created_at:
                data["createdAt"] = created_at.isoformat()

            posts.append(data)

        return jsonify({"ok": True, "posts": posts}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    
@app.route('/api/posts/like', methods=['POST'])
def like_post():
    try:
        auth_header = request.headers.get('Authorization')
        uid = profiles.verify_bearer_uid(auth_header)
        if not uid:
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        
        data = request.get_json(silent=True) or {}
        post_id = data.get('postId')
        if not post_id:
            return jsonify({"ok": False, "error": "missing postId"}), 400
        
        post_ref = db.collection('posts').document(post_id)

        post_ref.update({
            "likes": firestore.ArrayUnion([uid])
        })

        return jsonify({"ok": True, "postId": post_id, "likedBy": uid}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/network/followers", methods=["GET", "OPTIONS"])
def get_followers():
    if request.method == "OPTIONS":
        resp = app.make_default_options_response()
        resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        resp.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
        return resp, 204

    try:
        me_uid, _ = network.verify_token(request)
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 401

    try:
        follower_uids = network._fetch_follower_uids(me_uid)
        profiles_map = network._load_profiles(follower_uids)
        items = [network._shape_follower_item(profiles_map[u]) for u in follower_uids if u in profiles_map]
        return jsonify({"items": items}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to load followers: {e}"}), 500



if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)