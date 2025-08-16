import { updatePose, getPoseStats } from "./posedata.js";
import { init3DScene, updateSkeleton } from "./pose3d.js";

// --- DOM Elements ---
const videoElement = document.getElementById('video');
const outputCanvas = document.getElementById('outputCanvas');
const canvasCtx = outputCanvas.getContext('2d');
const pose3dCanvas = document.getElementById('pose3dCanvas');
const loadingElement = document.getElementById('loading');

// --- Landmark & Connection Definitions ---
// For 2D drawing
const LANDMARK_GROUPS = {
    LEFT: {
        indices: [11, 13, 15, 23, 25, 27], // L_Shoulder, L_Elbow, L_Wrist, L_Hip, L_Knee, L_Ankle
        color: '#00CFFF'
    },
    RIGHT: {
        indices: [12, 14, 16, 24, 26, 28], // R_Shoulder, R_Elbow, R_Wrist, R_Hip, R_Knee, R_Ankle
        color: '#FF9E00'
    },
    MID: {
        indices: [],
        color: '#DDDDDD'
    }
};

const CONNECTION_GROUPS = {
    LEFT: {
        pairs: [[11, 13], [13, 15], [23, 25], [25, 27], [11, 23]],
        color: '#00CFFF'
    },
    RIGHT: {
        pairs: [[12, 14], [14, 16], [24, 26], [26, 28], [12, 24]],
        color: '#FF9E00'
    },
    MID: {
        pairs: [[11, 12], [23, 24]],
        color: '#DDDDDD'
    }
};

// --- Initialize 3D Scene ---
init3DScene(pose3dCanvas);

// --- MediaPipe Pose ---
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
    modelComplexity: 1, // Using 1 for better performance, 2 is more accurate but slower
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});

// --- Main Callback ---
function onResults(results) {
    if (!videoElement.videoWidth) return;

    // Show video and hide loading spinner on first result
    if (loadingElement.style.display !== 'none') {
        loadingElement.style.display = 'none';
        videoElement.style.display = 'block';
    }
    
    outputCanvas.width = videoElement.videoWidth;
    outputCanvas.height = videoElement.videoHeight;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    canvasCtx.drawImage(videoElement, 0, 0, outputCanvas.width, outputCanvas.height);

    if (results.poseLandmarks) {
        // Draw 2D landmarks and connectors
        for (const group of Object.values(CONNECTION_GROUPS)) {
            drawConnectors(canvasCtx, results.poseLandmarks, group.pairs, { color: group.color, lineWidth: 4 });
        }
        for (const group of Object.values(LANDMARK_GROUPS)) {
            const landmarks = group.indices.map(i => results.poseLandmarks[i]);
            drawLandmarks(canvasCtx, landmarks, { color: group.color, lineWidth: 2 });
        }

        // Update pose data logic
        updatePose(results);
        updateUI(getPoseStats());

        // Update 3D skeleton if world landmarks are available
        if (results.poseWorldLandmarks) {
            updateSkeleton(results.poseWorldLandmarks);
        }
    }
    canvasCtx.restore();
}

function updateUI(stats) {
    document.getElementById('rep-counter').innerText = stats.repCount;
    document.getElementById('rep-quality').innerText = stats.repQuality;
    document.getElementById('depth').innerText = stats.depth ? `${stats.depth.toFixed(0)}°` : 'N/A';
    document.getElementById('rom').innerText = (stats.rangeOfMotion.min !== null) ? `${(stats.rangeOfMotion.max - stats.rangeOfMotion.min).toFixed(0)}°` : 'N/A';
    document.getElementById('symmetry').innerText = stats.symmetry ? `${stats.symmetry.toFixed(0)}°` : 'N/A';
    
    const valgusEl = document.getElementById('valgus');
    valgusEl.innerText = stats.kneeValgus ? "WARNING" : "GOOD";
    valgusEl.classList.toggle('warning', stats.kneeValgus);
    
    document.getElementById('ecc-time').innerText = `${stats.eccentricTime.toFixed(1)}s`;
    document.getElementById('con-time').innerText = `${stats.concentricTime.toFixed(1)}s`;
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