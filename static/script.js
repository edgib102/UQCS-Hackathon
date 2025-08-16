import { updatePose, getPoseStats } from "./posedata.js";
import { init3DScene, updateSkeleton } from "./pose3d.js";

// --- DOM Elements ---
const videoElement = document.getElementById('video');
const outputCanvas = document.getElementById('outputCanvas');
const canvasCtx = outputCanvas.getContext('2d');
const repCounterElement = document.getElementById('rep-counter');
const squatDepthElement = document.getElementById('squat-depth');
const pose3dCanvas = document.getElementById('pose3dCanvas');

// New stat elements
const symmetryElement = document.getElementById('symmetry');
const romElement = document.getElementById('rom');
const depthElement = document.getElementById('depth');
const valgusElement = document.getElementById('valgus');

// --- Initialize 3D Scene ---
init3DScene(pose3dCanvas);

// --- MediaPipe Pose ---
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

// --- Main Callback ---
function onResults(results) {
    outputCanvas.width = videoElement.videoWidth;
    outputCanvas.height = videoElement.videoHeight;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    canvasCtx.drawImage(videoElement, 0, 0, outputCanvas.width, outputCanvas.height);

    if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
        drawLandmarks(canvasCtx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });

        updatePose(results);
        const { repCount, squatDepthReached, symmetry, rangeOfMotion, depth, kneeValgus } = getPoseStats();

        // --- UI Updates ---
        repCounterElement.innerText = repCount;
        squatDepthElement.innerText = squatDepthReached ? "Yes" : "No";
        symmetryElement.innerText = symmetry ? symmetry.toFixed(1) : "N/A";
        romElement.innerText = (rangeOfMotion.min !== null && rangeOfMotion.max !== null)
            ? (rangeOfMotion.max - rangeOfMotion.min).toFixed(1)
            : "N/A";
        depthElement.innerText = depth ? depth.toFixed(1) : "N/A";
        valgusElement.innerText = kneeValgus ? "Yes ⚠️" : "No";
    }

    if (results.poseWorldLandmarks) {
        updateSkeleton(results.poseWorldLandmarks);
    }

    canvasCtx.restore();
}

pose.onResults(onResults);

// --- Camera ---
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await pose.send({ image: videoElement });
    },
    width: 640,
    height: 480
});
camera.start();
