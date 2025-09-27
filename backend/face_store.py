import base64, io
from datetime import datetime
from PIL import Image
import numpy as np
import face_recognition
from firebase_admin import firestore

db = firestore.client()

def save_face_enrollment(uid: str, frames: list[dict]) -> dict:
    """
    Save face enrollment metadata for a user into Firestore.
    - Creates/updates document at face/{uid}
    - Stores averaged embedding at doc root
    - Adds individual frame metadata under face/{uid}/frames
    """

    if not uid:
        return {"ok": False, "error": "Missing user_id"}

    if not frames:
        return {"ok": False, "error": "No frames provided"}

    embeddings = []
    face_doc = db.collection("face").document(uid)

    # Update metadata for this user
    face_doc.set({
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow()
    }, merge=True)

    for f in frames:
        pose = f.get("pose")
        image_data = f.get("image")
        if not image_data:
            continue

        try:
            # decode base64 data URL
            img_b64 = image_data.split(",", 1)[1]
            img = Image.open(io.BytesIO(base64.b64decode(img_b64))).convert("RGB")
            img_np = np.array(img)

            encs = face_recognition.face_encodings(img_np)

            if len(encs) == 1:
                vec = encs[0].tolist()
                embeddings.append(encs[0])

                # Save metadata in subcollection
                face_doc.collection("frames").add({
                    "pose": pose,
                    "vector": vec,
                    "createdAt": datetime.utcnow()
                })

        except Exception as e:
            print(f"[save_face_enrollment] Frame error: {e}")

    if not embeddings:
        return {"ok": False, "error": "No valid faces detected"}

    # Average embedding across frames
    final_emb = np.mean(embeddings, axis=0).tolist()
    face_doc.set({"embeddings": final_emb}, merge=True)

    return {
        "ok": True,
        "uid": uid,
        "frames_saved": len(embeddings),
        "embedding_dims": len(final_emb)
    }
