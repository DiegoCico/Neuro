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
    handleLikePost: (postId:string) => void;
};

export default function Post({ id, userId, userFullName, text, mediaUrl, createdAt, likes, commentsCount, handleLikePost }: PostProps) {
    const auth = getAuth();
    const currentUser = auth.currentUser;
    const currentUid = currentUser?.uid;
    const alreadyLiked = currentUid ? likes.includes(currentUid) : false;
    
  return (
    <div className="post-card">
      {/* Header */}
      <div className="post-header">
        <Avatar name={userFullName} size={32} />
        <span className="post-username">{userFullName}</span>
      </div>

      {/* Text */}
      <div className="post-body">
        <p className="post-text">{text}</p>
      </div>

      {/* Tags */}
      <div className="post-tags">
        <span className="post-tag">HTML</span>
        <span className="post-tag">PHP</span>
        <span className="post-tag">CSS</span>
        <span className="post-tag">Javascript</span>
        <span className="post-tag">Wordpress</span>
      </div>

      {/* Footer */}
      <div className="post-footer">
        <button
          onClick={() => handleLikePost(id)}
          className={`post-like-btn ${alreadyLiked ? "liked" : ""}`}
        >
          {alreadyLiked ? "♥" : "♡"} {likes.length} Like
        </button>
        {/* <span className="post-comments">{commentsCount} Comments</span> */}
      </div>
    </div>
  );
}
