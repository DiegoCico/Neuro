import "../css/Post.css";
import Avatar from "./Avatar";

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

export default function Post({ id, userId, userFullName, text, mediaUrl, createdAt, likes, commentsCount }: PostProps) {
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
        <button className="post-like-btn">♡ Like</button>
      </div>
    </div>
  );
}
