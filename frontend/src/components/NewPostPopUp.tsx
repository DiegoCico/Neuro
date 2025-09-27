import "../css/NewPostPopUp.css";
import { useRef } from "react";

type NewPostPopUpProps = {
  handlePopUp: (close: boolean) => void;
};

export default function NewPostPopUp({ handlePopUp }: NewPostPopUpProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const handleUploadClick = () => {
        fileInputRef.current?.click()
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0]
            console.log('file', file)
        }
    }

    return (
        <div className="popup-overlay">
            <div className="popup-container">
                {/* Close button */}
                <div className="popup-close">
                <button
                    onClick={() => handlePopUp(false)}
                    className="popup-close-btn"
                >
                    ✕
                </button>
                </div>

                {/* Upload area */}
                <div
                className="upload-area"
                onClick={handleUploadClick}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    console.log("Dropped file:", file);
                    }
                }}
                >
                <svg
                    className="upload-icon"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12"
                    />
                </svg>
                <p className="upload-text">Click or drag a file here (Max 1GB)</p>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden-input"
                />
                </div>

                {/* Text area */}
                <div className="popup-body">
                <textarea
                    placeholder="Whats on your mind?"
                    className="popup-textarea"
                    rows={6}
                />
                </div>

                {/* Footer */}
                <div className="popup-footer">
                <button disabled className="popup-post-btn">
                    Post
                </button>
                </div>
            </div>
        </div>
    )
}
