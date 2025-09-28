import { useState, useRef } from "react";
import Webcam from "react-webcam";
import { API_URL } from "../config";
import "../css/FaceDetect.css"

export default function FaceDetect() {
    const webCamRef = useRef<Webcam>(null)
    const [isDetecting, setIsDetecting] = useState(false)
    const [result, setResult] = useState<any>(null)

    const handleDetect = async () => {
        if (!webCamRef.current) return
        const imageSrc = webCamRef.current.getScreenshot()
        if (!imageSrc) return

        setIsDetecting(true)
        setResult(null)

        try {
        const res = await fetch(`${API_URL}/api/recognize-face`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: imageSrc }),
        })
        const data = await res.json()
        setResult(data)
        } catch {
        setResult({ ok: false, error: "Network error" })
        } finally {
        setIsDetecting(false)
        }
    }

    return (
        <div className="face-detect-container">
        <Webcam
            ref={webCamRef}
            audio={false}
            screenshotFormat="image/jpeg"
            videoConstraints={{ facingMode: "user" }}
            className="webcam-feed"
            mirrored
        />

        <div className="controls">
            <button onClick={handleDetect} disabled={isDetecting} className="btn">
            {isDetecting ? "Detecting..." : "Begin Detection"}
            </button>
        </div>

        {result && (
            <div className="result">
            {result.ok ? (
                <p>
                ✅ Recognized as <strong>{result.uid}</strong> (distance:{" "}
                {result.distance?.toFixed(3)})
                </p>
            ) : (
                <p>❌ {result.error || "No match found"}</p>
            )}
            </div>
        )}
        </div>
    )
}