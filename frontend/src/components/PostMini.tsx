import "../css/Post.css";
import Avatar from "./Avatar";
import { getAuth } from "firebase/auth";

type PostProps = {
    id: string;
    userId: string;
    userFullName: string;
    text?: string;
    mediaUrl?: string | null;
    createdAt: string;
    likes: string[];
    commentsCount: number;
};

export default function PostMini({ id, userId, userFullName, text, mediaUrl, createdAt, likes, commentsCount }: PostProps) {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    const currentUid = currentUser?.uid;
    const alreadyLiked = currentUid ? likes.includes(currentUid) : false;

  const previewText = text && text.length > 120 ? text.slice(0, 120) + "…" : text;
    
  return (
    <div className="post-mini-card">
      {/* Avatar + Date inline */}
      <div className="post-mini-header">
        <Avatar name={userFullName} size={36} />
        <span className="post-mini-date">
          {new Date(createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Text */}
      {previewText && <p className="post-mini-text">{previewText}</p>}

      {/* Media */}
      {mediaUrl && (
        <div className="post-mini-media">
          <img src={mediaUrl} alt="post media" />
        </div>
      )}

      {/* Stats */}
      <div className="post-mini-stats">
        <span>{likes.length} {likes.length === 1 ? "like" : "likes"}</span>
        <span>·</span>
        <span>{commentsCount} {commentsCount === 1 ? "comment" : "comments"}</span>
      </div>
    </div>
  );
}
