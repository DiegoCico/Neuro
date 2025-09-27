import { useState, useRef, useEffect, useCallback } from 'react'
import Webcam from 'react-webcam'
import '../css/FaceSetup.css'
import { FaceMesh } from '@mediapipe/face_mesh'
import { Camera } from '@mediapipe/camera_utils'
import { API_URL } from '../config'

// Landmarks to be used for face id
// Nose tip (1) moves consistently relative to all other landmarks - good anchor.
// Eyes help measure up/down tilt (eye-chin or eye-forehead distance).
// Cheek/ear landmarks help detect left/right turns.
// Chin (152) helps confirm down tilt.
// Forehead (10) helps confirm up tilt.

export default function FaceSetup() {
    const webCamRef = useRef<Webcam>(null)
    const [frames, setFrames] = useState<{ pose: string, image: string}[]>([])
    const [capturing, setCapturing] = useState(false)
    const capturingRef = useRef(false)
    const [progress, setProgress] = useState(0)
    const [isFaceDetected, setIsFaceDetected] = useState(false)
    const [facePoses, setFacePoses] = useState({
        neutral: false, left: false, right: false, up: false, down: false
    })
    const [currentPose, setCurrentPose] = useState<'neutral' | 'left' | 'right' | 'up' | 'down' | null>(null)
    const [isEnrollmentComplete, setIsEnrollmentComplete] = useState(false)
    const [poseHold, setPoseHold] = useState({
        neutral: 0,
        left: 0,
        right: 0,
        up: 0,
        down: 0
    })

    const dist = (a: {x: number; y: number}, b: {x: number; y: number}) => {
        const dx = a.x - b.x
        const dy = a.y - b.y
        return Math.hypot(dx, dy)
    }

    useEffect(() => {
        capturingRef.current = capturing
    }, [capturing])

    const classifyPoseFromLandmarks = (
        landmarks: Array<{ x: number; y: number }>
        ): 'neutral' | 'left' | 'right' | 'up' | 'down' => {
        const nose = landmarks[1]
        const leftCheek = landmarks[234]
        const rightCheek = landmarks[454]
        const chin = landmarks[152]
        const forehead = landmarks[10]
        if (!nose || !leftCheek || !rightCheek || !chin || !forehead) return 'neutral'

        const dl = dist(nose, leftCheek)
        const dr = dist(nose, rightCheek)
        const lrRatio = dl / dr

        const df = dist(nose, forehead)
        const dc = dist(nose, chin)
        const udRatio = df / dc

        const LR_EPS = 0.25
        const UD_EPS = 0.20

        if (lrRatio > 1 + LR_EPS) return 'left'
        if (dr / dl > 1 + LR_EPS) return 'right'
        if (udRatio < 1 - UD_EPS) return 'up'  
        if (udRatio > 1 + UD_EPS) return 'down'

        return 'neutral'
    }

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
                    const landmarks = results.multiFaceLandmarks?.[0]
                    const hasFace = !!landmarks
                    setIsFaceDetected(hasFace)

                    if (!capturingRef.current || !hasFace) return

                    const pose = classifyPoseFromLandmarks(landmarks as any)
                    setCurrentPose(pose)

                    setPoseHold((prev) => {
                        const updated = { neutral: 0, left: 0, right: 0, up: 0, down: 0 }
                        updated[pose] = prev[pose] + 1

                        const threshold = 5

                        if (updated[pose] >= threshold) {
                            setFacePoses((old) => {
                            if (old[pose]) return old

                            const newPoses = { ...old, [pose]: true }

                            if (webCamRef.current) {
                                const imageSrc = webCamRef.current.getScreenshot()
                                if (imageSrc) {
                                setFrames((prevFrames) => [...prevFrames, { pose, image: imageSrc }])
                                }
                            }

                            const completedCount = Object.values(newPoses).filter(Boolean).length
                            setProgress(Math.min(completedCount * 20, 100))

                            if (Object.values(newPoses).every(Boolean)) {
                                setIsEnrollmentComplete(true)
                                stopEnrollment()
                            }

                            return newPoses
                            })
                        }

                        return updated
                    })
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

    const startEnrollment = () => {
        setFrames([])
        setProgress(0)
        setCapturing(true)
        setFacePoses({
            neutral: false, left: false, right: false, up: false, down: false
        })
    }

    const stopEnrollment = () => {
        setCapturing(false)
        console.log("Captured frames:", frames.length) // LOG
    }

    const continueEnrollment = async() => {
        setCapturing(false)

        const payload = {
            user_id: "user123",
            frames: frames
        }

        const res = await fetch(`${API_URL}/api/enroll-face`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })

        const data = await res.json();
        console.log("Enrollment response:", data);
    }

    const downloadFrames = () => {
        frames.forEach((frame, index) => {
            const a = document.createElement("a")
            a.href = frame.image
            a.download = `frame_${frame.pose}.jpg`
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

                <svg className="circle-overlay" viewBox="0 0 450 450">
                    {/* Background ring */}
                    <circle
                        cx="225"
                        cy="225"
                        r="210"
                        stroke="gray"
                        strokeWidth="8"
                        fill="none"
                    />
                    {/* Progress ring */}
                    <circle
                        cx="225"
                        cy="225"
                        r="210"
                        stroke="limegreen"
                        strokeWidth="8"
                        fill="none"
                        strokeDasharray={2 * Math.PI * 210}
                        strokeDashoffset={
                        2 * Math.PI * 210 - (2 * Math.PI * 210 * progress) / 100
                        }
                        strokeLinecap="round"
                        transform="rotate(-90 225 225)"
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
                {isEnrollmentComplete && (
                    <button onClick={() => continueEnrollment()} className="btn start-btn">
                        Continue
                    </button>
                )}
                <p>
                    {capturing
                    ? "Move your head slowly to complete the circle..."
                    : "Press start to begin scanning"}
                </p>
                <div className="pose-checklist">
                    <p><strong>Enrollment Steps:</strong></p>
                    <ul>
                        <li className={facePoses.neutral ? "done" : ""}>
                        Neutral {facePoses.neutral ? "✅" : "❌"}
                        </li>
                        <li className={facePoses.left ? "done" : ""}>
                        Turn Left {facePoses.left ? "✅" : "❌"}
                        </li>
                        <li className={facePoses.right ? "done" : ""}>
                        Turn Right {facePoses.right ? "✅" : "❌"}
                        </li>
                        <li className={facePoses.up ? "done" : ""}>
                        Look Up {facePoses.up ? "✅" : "❌"}
                        </li>
                        <li className={facePoses.down ? "done" : ""}>
                        Look Down {facePoses.down ? "✅" : "❌"}
                        </li>
                    </ul>
                </div>

                {/* Next instruction */}
                <div className="pose-instruction">
                    {!facePoses.neutral
                        ? "Look forward to start"
                        : !facePoses.left
                        ? "Turn your head left"
                        : !facePoses.right
                        ? "Turn your head right"
                        : !facePoses.up
                        ? "Tilt your head upward"
                        : !facePoses.down
                        ? "Tilt your head downward"
                        : "Enrollment complete!"}
                </div>
                {isEnrollmentComplete && (
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