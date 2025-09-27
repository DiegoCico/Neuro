import { useState, useRef, useEffect, useCallback } from 'react'
import Webcam from 'react-webcam'
import '../css/FaceSetup.css'
import { FaceMesh } from '@mediapipe/face_mesh'
import { Camera } from '@mediapipe/camera_utils'

// Landmarks to be used for face id
// Nose tip (1) moves consistently relative to all other landmarks - good anchor.
// Eyes help measure up/down tilt (eye-chin or eye-forehead distance).
// Cheek/ear landmarks help detect left/right turns.
// Chin (152) helps confirm down tilt.
// Forehead (10) helps confirm up tilt.

export default function FaceSetup() {
    const webCamRef = useRef<Webcam>(null)
    const [frames, setFrames] = useState<string[]>([])
    const [capturing, setCapturing] = useState(false)
    const [progress, setProgress] = useState(0)
    const [isFaceDetected, setIsFaceDetected] = useState(false)

    const captureFrame = useCallback(() => {
        if (webCamRef.current) {
            const imageSrc = webCamRef.current.getScreenshot()
            if (imageSrc) {
                setFrames(prev => [...prev, imageSrc])
            }
        }
    }, [])

    useEffect(() => {
        if (webCamRef.current) {
            if (webCamRef && webCamRef.current.video) {
                const videoElement = webCamRef.current.video as HTMLVideoElement

                const faceMesh = new FaceMesh({
                    locateFile: (file) =>
                        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
                })

                faceMesh.setOptions({
                    maxNumFaces: 1,
                    refineLandmarks: true,
                    minDetectionConfidence: 0.5,
                    minTrackingConfidence: 0.5
                })

                faceMesh.onResults((results) => {
                    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                        console.log("Face detected with landmarks:", results.multiFaceLandmarks[0])
                        setIsFaceDetected(true)
                    } else {
                        console.log('No face detected')
                        setIsFaceDetected(false)
                    }
                })

                const camera = new Camera(videoElement, {
                    onFrame: async() => {
                        await faceMesh.send({ image: videoElement })
                    },
                    width: 300,
                    height: 300
                })
                camera.start()
            }
        }
    }, [webCamRef])

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null
        if (capturing) {
            interval = setInterval(() => {
                if (isFaceDetected) {
                    captureFrame()
                    setProgress(prev => Math.min(prev + 5, 100))
                } else {
                    console.log("Skipped frame - no face detected")
                }
            }, 500)
        }
        
        return () => {
            if (interval) {
                clearInterval(interval)
            }
        }
    }, [capturing, isFaceDetected, captureFrame])

    const startEnrollment = () => {
        setFrames([])
        setProgress(0)
        setCapturing(true)
    }

    const stopEnrollment = () => {
        setCapturing(false)
        console.log("Captured frames:", frames.length)
        //TODO: send frames to backend here
    }

    const downloadFrames = () => {
        frames.forEach((frame, index) => {
            const a = document.createElement("a")
            a.href = frame
            a.download = `frame_${index + 1}.jpg`
            a.click()
        })
    }

    return (
        <div className="face-setup-container">
            {/* Circle + Webcam container */}
            <div className="circle-wrapper">
                <Webcam
                ref={webCamRef}
                audio={false}
                screenshotFormat="image/jpeg"
                videoConstraints={{ facingMode: "user" }}
                className="webcam-feed"
                mirrored
                />

                <svg className="circle-overlay" viewBox="0 0 300 300">
                {/* Background ring */}
                <circle
                    cx="150"
                    cy="150"
                    r="140"
                    stroke="gray"
                    strokeWidth="8"
                    fill="none"
                />
                {/* Progress ring */}
                <circle
                    cx="150"
                    cy="150"
                    r="140"
                    stroke="limegreen"
                    strokeWidth="8"
                    fill="none"
                    strokeDasharray={2 * Math.PI * 140}
                    strokeDashoffset={
                    2 * Math.PI * 140 - (2 * Math.PI * 140 * progress) / 100
                    }
                    strokeLinecap="round"
                    transform="rotate(-90 150 150)"
                />
                </svg>
            </div>

            {/* Controls */}
            <div className="controls">
                {!capturing ? (
                <button onClick={startEnrollment} className="btn start-btn">
                    Start Face Enrollment
                </button>
                ) : (
                <button onClick={stopEnrollment} className="btn stop-btn">
                    Stop
                </button>
                )}
                <p>
                {capturing
                    ? "Move your head slowly to complete the circle..."
                    : "Press start to begin scanning"}
                </p>
                {!capturing && frames.length > 0 && (
                    <button onClick={downloadFrames} className="btn">
                        Download Frames
                    </button>
                )}

                {capturing && !isFaceDetected && (
                    <p className="warning-text">No face detected, please center your face</p>
                )}
            </div>
        </div>
    )
}