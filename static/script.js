import { updatePoseData, getPoseStats } from "./posedata.js";
import { init3DScene, updateSkeleton } from "./pose3d.js";

// --- DOM Elements ---
const videoElement = document.getElementById('video');
const outputCanvas = document.getElementById('outputCanvas');
const canvasCtx = outputCanvas.getContext('2d');
const repCounterElement = document.getElementById('rep-counter');
const squatDepthElement = document.getElementById('squat-depth');
const pose3dCanvas = document.getElementById('pose3dCanvas');

// --- Initialize 3D Scene ---
// Pass the dedicated canvas to the 3D renderer
init3DScene(pose3dCanvas);

// --- MediaPipe Pose Initialization ---
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

// --- Main Callback Function ---
function onResults(results) {
    // Set canvas dimensions
    outputCanvas.width = videoElement.videoWidth;
    outputCanvas.height = videoElement.videoHeight;

    // Clear canvas and draw video frame
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    canvasCtx.drawImage(videoElement, 0, 0, outputCanvas.width, outputCanvas.height);

    if (results.poseLandmarks) {
        // --- 2D Drawing ---
        // Draw the connectors and landmarks on the 2D canvas
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
        drawLandmarks(canvasCtx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });
        
        // --- Pose Analysis ---
        // Process landmarks to count squats
        updatePoseData(results);
        const { repCount, squatDepthReached } = getPoseStats();

        // --- UI Update ---
        // Update the displayed stats
        repCounterElement.innerText = repCount;
        squatDepthElement.innerText = squatDepthReached;
    }
    
    if (results.poseWorldLandmarks) {
        // --- 3D Rendering ---
        // Update the 3D skeleton visualization
        updateSkeleton(results.poseWorldLandmarks);
    }

    canvasCtx.restore();
}

pose.onResults(onResults);

// --- Camera Setup ---
const camera = new Camera(videoElement, {
    onFrame: async () => {
        await pose.send({ image: videoElement });
    },
    width: 640,
    height: 480
});
camera.start();