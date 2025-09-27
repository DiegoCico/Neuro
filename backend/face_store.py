# face_store.py
import base64, io
from datetime import datetime, timezone
from typing import List, Dict, Any
from PIL import Image
import numpy as np
import face_recognition
from firebase_admin import firestore

db = firestore.client()

def _utc_now():
    return datetime.now(timezone.utc)

def _clear_frames_subcollection(face_doc_ref) -> int:
    """Delete all docs under face/{uid}/frames. Returns number deleted."""
    frames_ref = face_doc_ref.collection("frames")
    deleted = 0
    # Delete in small batches to avoid timeouts/limits
    while True:
        batch = db.batch()
        docs = list(frames_ref.limit(300).stream())
        if not docs:
            break
        for d in docs:
            batch.delete(d.reference)
            deleted += 1
        batch.commit()
    return deleted

def save_face_enrollment(uid: str, frames: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Replace a user's face enrollment:
      - Deletes all subdocs in face/{uid}/frames
      - Writes new per-frame metadata (pose + 128D vector)
      - Computes & stores averaged embedding at face/{uid}
    """
    if not uid:
        return {"ok": False, "error": "Missing user_id"}
    if not frames:
        return {"ok": False, "error": "No frames provided"}

    face_doc = db.collection("face").document(uid)

    # Preserve existing createdAt if present, otherwise set it
    snap = face_doc.get()
    created_at = snap.to_dict().get("createdAt") if snap.exists else None
    face_doc.set(
        {
            "createdAt": created_at or _utc_now(),
            "updatedAt": _utc_now(),
        },
        merge=True,
    )

    old_count = _clear_frames_subcollection(face_doc)

    # 2) Process new frames and collect encodings
    enc_list = []
    saved_frames = 0

    for f in frames:
        pose = f.get("pose")
        image_data = f.get("image")
        if not isinstance(image_data, str) or "," not in image_data:
            continue

        try:
            img_b64 = image_data.split(",", 1)[1]
            img = Image.open(io.BytesIO(base64.b64decode(img_b64))).convert("RGB")
            img_np = np.array(img)
            encs = face_recognition.face_encodings(img_np)

            # Only accept frames with exactly one face
            if len(encs) == 1:
                vec = encs[0]
                enc_list.append(vec)
                face_doc.collection("frames").add(
                    {
                        "pose": pose,
                        "vector": vec.tolist(),
                        "createdAt": _utc_now(),
                    }
                )
                saved_frames += 1
        except Exception as e:
            print(f"[save_face_enrollment] Frame error: {e}")

    if not enc_list:
        # If nothing valid, ensure frames stay empty and updatedAt moves forward
        return {"ok": False, "error": "No valid faces detected", "frames_deleted": old_count}

    # 3) Average & store the master embedding
    final_emb = np.mean(np.vstack(enc_list), axis=0).tolist()
    face_doc.set(
        {
            "embeddings": final_emb,
            "vectorDims": len(final_emb),
            "frameCount": saved_frames,
            "updatedAt": _utc_now(),
        },
        merge=True,
    )

    return {
        "ok": True,
        "uid": uid,
        "len_frames":len(frames),
        "frames_deleted": old_count,
        "frames_saved": saved_frames,
        "embedding_dims": len(final_emb),
    }
