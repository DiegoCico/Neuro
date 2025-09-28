import { useState, useRef, useEffect } from "react";
import Webcam from "react-webcam";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";
import { API_URL } from "../config";
import "../css/FaceDetect.css"

export default function FaceDetect() {
    const webCamRef = useRef<Webcam>(null)
    const [isDetecting, setIsDetecting] = useState(false)
    const [result, setResult] = useState<any>(null)
    const [faceBox, setFaceBox] = useState<{x: number, y: number, w: number, h: number} | null>(null)

    const clamp = (value: number, min: number, max: number) => {
        return Math.min(Math.max(value, min), max)
    }

    useEffect(() => {
        if (!webCamRef.current || !webCamRef.current.video) return

        const videoElement = webCamRef.current.video as HTMLVideoElement

        const faceMesh = new FaceMesh({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        })

        faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
        })

        faceMesh.onResults((results) => {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0]

            // Compute bounding box from landmarks
            const xs = landmarks.map((lm) => lm.x)
            const ys = landmarks.map((lm) => lm.y)
            const minX = Math.min(...xs)
            const maxX = Math.max(...xs)
            const minY = Math.min(...ys)
            const maxY = Math.max(...ys)

            setFaceBox({
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY,
            })
        } else {
            setFaceBox(null)
        }
        })

        const camera = new Camera(videoElement, {
        onFrame: async () => {
            await faceMesh.send({ image: videoElement })
        },
        width: 320,
        height: 400,
        })
        camera.start()
    }, [webCamRef])

    useEffect(() => {
        let interval: NodeJS.Timeout

        const handleDetect = async () => {
            if (!webCamRef.current) return
            const imageSrc = webCamRef.current.getScreenshot()
            if (!imageSrc) return

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
            }
        }

        interval = setInterval(handleDetect, 2000)

        return () => clearInterval(interval)
    }, [webCamRef])
    

    return (
        <div className="face-detect-container">
            <Webcam
                ref={webCamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                videoConstraints={{ facingMode: "user" }}
                className="webcam-rect"
                mirrored
            />

            {result?.ok && result.user && faceBox && (
                <div
                    className="overlay-card"
                    style={{
                        left: `${clamp((1 - (faceBox.x + faceBox.w / 2)) * 116.5, 50, 70)}%`,
                        top: `${clamp(faceBox.y * 100 - 20, 15, 70)}%`,
                    }}
                >
                    <p className="overlay-name">{result.user.fullName}</p>
                    <p className="overlay-occupation">{result.user.occupation}</p>
                </div>
            )}

            {!faceBox && (
                <div className="overlay-card top-banner">
                    <p className="overlay-name">No face detected</p>
                </div>
            )}
        </div>
    )
}