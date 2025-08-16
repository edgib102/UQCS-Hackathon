import { updatePose, getPoseStats, resetPoseStats } from "./posedata.js";
import { createLiveScene, createPlaybackScene } from "./pose3d.js";

// --- Configuration ---
const SQUAT_TARGET = 5;

// --- DOM Elements ---
const videoElement = document.getElementById('video');
const outputCanvas = document.getElementById('outputCanvas');
const canvasCtx = outputCanvas.getContext('2d');
const playbackCanvas = document.getElementById('playbackCanvas');

const startView = document.getElementById('startView');
const sessionView = document.getElementById('sessionView');
const reportView = document.getElementById('reportView');
const loadingElement = document.getElementById('loading');

const startButton = document.getElementById('startButton');
const resetButton = document.getElementById('resetButton');
const downloadButton = document.getElementById('downloadButton');
const playButton = document.getElementById('playButton');

// --- State Management ---
let mediaRecorder;
let recordedChunks = [];
let recordedLandmarks = [];
let isSessionRunning = false;
let liveScene, playbackScene;

// --- Initialize Live 3D Scene ---
liveScene = createLiveScene(document.getElementById('pose3dCanvas'));

// --- MediaPipe Pose ---
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});
pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
});
pose.onResults(onResults);

// --- Camera ---
const camera = new Camera(videoElement, {
    onFrame: async () => {
        if (!isSessionRunning) return;
        await pose.send({ image: videoElement });
    },
    width: 640,
    height: 480
});

// --- Main Application Logic ---
function onResults(results) {
    if (!videoElement.videoWidth) return;
    
    if (loadingElement.style.display !== 'none') {
        loadingElement.style.display = 'none';
        videoElement.style.display = 'block';
    }
    
    drawFrame(results);
    
    if (results.poseWorldLandmarks) {
        liveScene.update(results.poseWorldLandmarks);
        // Store a deep copy of the landmarks for playback
        recordedLandmarks.push(JSON.parse(JSON.stringify(results.poseWorldLandmarks)));
    }
    
    updatePose(results);
    const stats = getPoseStats();
    
    document.getElementById('rep-counter').innerText = stats.repCount;
    document.getElementById('rep-quality').innerText = stats.repQuality;
    document.getElementById('depth').innerText = stats.depth ? `${stats.depth.toFixed(0)}°` : 'N/A';
    document.getElementById('symmetry').innerText = stats.symmetry ? `${stats.symmetry.toFixed(0)}°` : 'N/A';
    
    if (stats.repCount >= SQUAT_TARGET) {
        stopSession();
    }
}

function drawFrame(results) {
    outputCanvas.width = videoElement.videoWidth;
    outputCanvas.height = videoElement.videoHeight;
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    canvasCtx.drawImage(videoElement, 0, 0, outputCanvas.width, outputCanvas.height);
    if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#DDDDDD', lineWidth: 4 });
        drawLandmarks(canvasCtx, results.poseLandmarks, { color: '#00CFFF', lineWidth: 2 });
    }
    canvasCtx.restore();
}

// --- Session & Playback Control ---
async function startSession() {
    isSessionRunning = true;
    startView.style.display = 'none';
    reportView.style.display = 'none';
    sessionView.style.display = 'block';
    loadingElement.style.display = 'flex';

    await camera.start();
    
    const stream = outputCanvas.captureStream(30);
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        downloadButton.href = URL.createObjectURL(blob);
        recordedChunks = [];
    };
    mediaRecorder.start();
}

function stopSession() {
    isSessionRunning = false;
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    camera.stop();

    videoElement.style.display = 'none';
    sessionView.style.display = 'none';
    reportView.style.display = 'block';
    
    generateReport();
    
    // Initialize the playback scene once the report is shown
    if (!playbackScene) {
        playbackScene = createPlaybackScene(playbackCanvas);
    }
}

function startPlayback() {
    let frame = 0;
    const animate = () => {
        if (frame >= recordedLandmarks.length) {
            frame = 0; // Loop the playback
        }
        playbackScene.update(recordedLandmarks[frame]);
        frame++;
        requestAnimationFrame(animate);
    };
    animate();
    playButton.disabled = true;
    playButton.innerText = "Playing...";
}


function resetSession() {
    reportView.style.display = 'none';
    startView.style.display = 'block';
    resetPoseStats();
    recordedLandmarks = [];
    playButton.disabled = false;
    playButton.innerText = "Play 3D Reps";

    document.getElementById('rep-counter').innerText = '0';
    document.getElementById('rep-quality').innerText = 'N/A';
    document.getElementById('depth').innerText = 'N/A';
    document.getElementById('symmetry').innerText = 'N/A';
}

function generateReport() {
    const { repHistory } = getPoseStats();
    if (repHistory.length === 0) return;

    const avgDepth = repHistory.reduce((s, r) => s + r.depth, 0) / repHistory.length;
    const avgSymmetry = repHistory.reduce((s, r) => s + (r.symmetry || 0), 0) / repHistory.length;
    const valgusCount = repHistory.filter(r => r.kneeValgus).length;
    const qualityScores = { "GOOD": 3, "OK": 2, "BAD": 1 };
    const avgQuality = repHistory.reduce((s, r) => s + qualityScores[r.quality], 0) / repHistory.length;
    const overallQuality = avgQuality > 2.5 ? "Excellent" : avgQuality > 1.5 ? "Good" : "Needs Work";

    document.getElementById('report-quality-overall').innerText = overallQuality;
    document.getElementById('report-depth-avg').innerText = `${avgDepth.toFixed(0)}°`;
    document.getElementById('report-symmetry-avg').innerText = `${avgSymmetry.toFixed(0)}°`;
    document.getElementById('report-valgus-count').innerText = `${valgusCount} of ${SQUAT_TARGET} reps`;
}

// --- Event Listeners ---
startButton.addEventListener('click', startSession);
resetButton.addEventListener('click', resetSession);
playButton.addEventListener('click', startPlayback);