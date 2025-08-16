import { updatePose, getPoseStats } from "./posedata.js";
import { init3DScene, updateSkeleton } from "./pose3d.js";

// --- DOM Elements ---
const videoElement = document.getElementById('video');
const outputCanvas = document.getElementById('outputCanvas');
const canvasCtx = outputCanvas.getContext('2d');
const repCounterElement = document.getElementById('rep-counter');
const squatDepthElement = document.getElementById('squat-depth');
const pose3dCanvas = document.getElementById('pose3dCanvas');

// ---- Define landmark groups (indices from MediaPipe Pose) ----
const LEFT_LANDMARKS = [11, 13, 15, 23, 25, 27];   // shoulder, elbow, wrist, hip, knee, ankle
const RIGHT_LANDMARKS = [12, 14, 16, 24, 26, 28];
const MID_LANDMARKS = [];             // nose, eyes, ears, etc. (adjust if needed)

// ---- Define colour scheme ----
const LEFT_COLOR = '#00CFFF';   // green
const MID_COLOR = '#DDDDDD';  // blue
const RIGHT_COLOR = '#FF9E00';    // red

// ---- Define connector groups (pairs of landmark indices) ----
const LEFT_CONNECTIONS = [
  [11, 13], [13, 15],   // left arm
  [23, 25], [25, 27],   // left leg
  [11, 23]              // left torso
];

const RIGHT_CONNECTIONS = [
  [12, 14], [14, 16],   // right arm
  [24, 26], [26, 28],   // right leg
  [12, 24],              // right torso
// torso diagonals
];

const MID_CONNECTIONS = [
  [11, 12], // shoulders
  [23, 24], // hips
];

// New stat elements
const symmetryElement = document.getElementById('symmetry');
const romElement = document.getElementById('rom');
const depthElement = document.getElementById('depth');
const valgusElement = document.getElementById('valgus');

const eccTimeElement = document.getElementById('ecc-time');
const conTimeElement = document.getElementById('con-time');
const repQualityElement = document.getElementById('rep-quality');

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
        drawConnectors(canvasCtx, results.poseLandmarks, LEFT_CONNECTIONS, {
            color: LEFT_COLOR, lineWidth: 4
        });
        drawLandmarks(canvasCtx,
            LEFT_LANDMARKS.map(i => results.poseLandmarks[i]),
            { color: LEFT_COLOR, lineWidth: 2 }
        );

        // Right side
        drawConnectors(canvasCtx, results.poseLandmarks, RIGHT_CONNECTIONS, {
            color: RIGHT_COLOR, lineWidth: 4
        });
        drawLandmarks(canvasCtx,
            RIGHT_LANDMARKS.map(i => results.poseLandmarks[i]),
            { color: RIGHT_COLOR, lineWidth: 2 }
        );

        // Middle
        drawConnectors(canvasCtx, results.poseLandmarks, MID_CONNECTIONS, {
            color: MID_COLOR, lineWidth: 4
        });
        drawLandmarks(canvasCtx,
            MID_LANDMARKS.map(i => results.poseLandmarks[i]),
            { color: MID_COLOR, lineWidth: 2 }
        );

        updatePose(results);
        const { 
            repCount, 
            squatDepthReached, 
            symmetry, 
            rangeOfMotion, 
            depth, 
            kneeValgus, 
            eccentricTime, 
            concentricTime, 
            repQuality 
        } = getPoseStats();

        // --- UI Updates ---
        repCounterElement.innerText = repCount;
        squatDepthElement.innerText = squatDepthReached ? "Yes" : "No";
        symmetryElement.innerText = symmetry ? symmetry.toFixed(1) : "N/A";
        romElement.innerText = (rangeOfMotion.min !== null && rangeOfMotion.max !== null)
            ? (rangeOfMotion.max - rangeOfMotion.min).toFixed(1)
            : "N/A";
        depthElement.innerText = depth ? depth.toFixed(1) : "N/A";
        valgusElement.innerText = kneeValgus ? "Yes ⚠️" : "No";

        eccTimeElement.innerText = eccentricTime ? eccentricTime.toFixed(1) : "0.0";
        conTimeElement.innerText = concentricTime ? concentricTime.toFixed(1) : "0.0";
        repQualityElement.innerText = repQuality;
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
