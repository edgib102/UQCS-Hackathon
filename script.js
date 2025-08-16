import { updatePose, getPoseStats, resetPoseStats } from "./posedata.js";
import { createLiveScene, createPlaybackScene } from "./pose3d.js";
import { renderHipHeightChart } from "./chart.js";

// --- Configuration ---
const SQUAT_TARGET = 5;

// --- DOM Elements ---
const videoElement = document.getElementById('video');
const outputCanvas = document.getElementById('outputCanvas');
let canvasCtx;
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
let hipHeightData = [];
let hipChartInstance;
let isSessionRunning = false;
let liveScene, playbackScene;

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
    if (!isSessionRunning || !videoElement.videoWidth) return;
    
    // --- 1. Initial UI Setup ---
    if (loadingElement.style.display !== 'none') {
        loadingElement.style.display = 'none';
        videoElement.style.display = 'block';
    }
    
    // --- 2. Draw the Video Frame and Skeleton ---
    drawFrame(results);
    
    // --- 3. Process Pose Data (if available) ---
    if (results.poseLandmarks) {
        // Update the 3D scene
        if (results.poseWorldLandmarks) {
            liveScene.update(results.poseWorldLandmarks);
            recordedLandmarks.push(JSON.parse(JSON.stringify(results.poseWorldLandmarks)));
        }

        // Get hip height for the chart
        const leftHip = results.poseLandmarks[23];
        const rightHip = results.poseLandmarks[24];
        if (leftHip.visibility > 0.5 && rightHip.visibility > 0.5) {
            const avgHipY = (leftHip.y + rightHip.y) / 2;
            hipHeightData.push(avgHipY);
        }

        // --- 4. Run Analysis & Update Stats ---
        updatePose(results);
        const stats = getPoseStats();

        // Update the live stats display
        document.getElementById('rep-counter').innerText = stats.repCount;
        document.getElementById('rep-quality').innerText = stats.repQuality;
        document.getElementById('depth').innerText = stats.depth ? `${stats.depth.toFixed(0)}°` : 'N/A';
        document.getElementById('symmetry').innerText = stats.symmetry ? `${stats.symmetry.toFixed(0)}°` : 'N/A';
        
        // Check if the session is complete
        if (stats.repCount >= SQUAT_TARGET) {
            stopSession();
        }
    }
}

function drawFrame(results) {
    outputCanvas.width = videoElement.videoWidth;
    outputCanvas.height = videoElement.videoHeight;
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    canvasCtx.drawImage(videoElement, 0, 0, outputCanvas.width, outputCanvas.height);
    
    if (results.poseLandmarks) {
        // Filter out facial landmarks (0-10) and their connections
        const bodyLandmarks = results.poseLandmarks.slice(11);
        const bodyConnections = POSE_CONNECTIONS.filter(
            ([start, end]) => start > 10 && end > 10
        );

        // Draw body connectors
        drawConnectors(canvasCtx, results.poseLandmarks, bodyConnections, { color: '#DDDDDD', lineWidth: 4 });
        // Draw body landmarks
        drawLandmarks(canvasCtx, bodyLandmarks, { color: '#00CFFF', lineWidth: 2 });
    }
    
    canvasCtx.restore();
}

// --- Session & Playback Control ---
async function startSession() {
    // Initialize scenes and contexts now that the page is loaded
    if (!liveScene) {
        liveScene = createLiveScene(document.getElementById('pose3dCanvas'));
    }
    if (!canvasCtx) {
        canvasCtx = outputCanvas.getContext('2d');
    }
    
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
        if (!isSessionRunning) { // Stop animation if session is reset
            if (frame >= recordedLandmarks.length) {
                frame = 0; // Loop the playback
            }
            playbackScene.update(recordedLandmarks[frame]);
            frame++;
            requestAnimationFrame(animate);
        }
    };
    animate();
    playButton.disabled = true;
    playButton.innerText = "Playing...";
}


function resetSession() {
    reportView.style.display = 'none';
    startView.style.display = 'block';
    resetPoseStats();

    // Clear recorded data
    recordedLandmarks = [];
    hipHeightData = [];
    isSessionRunning = true; // Hack to stop playback animation loop

    // Destroy old chart instance
    if (hipChartInstance) {
        hipChartInstance.destroy();
    }
    
    playButton.disabled = false;
    playButton.innerText = "Play 3D Reps";

    // Reset UI text
    document.getElementById('rep-counter').innerText = '0';
    document.getElementById('rep-quality').innerText = 'N/A';
    document.getElementById('depth').innerText = 'N/A';
    document.getElementById('symmetry').innerText = 'N/A';

    // Set back to false after a short delay
    setTimeout(() => { isSessionRunning = false; }, 100);
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
    
    // Render the Hip Height Chart
    const hipHeightChartCanvas = document.getElementById('hipHeightChart'); // Get the canvas element
    hipChartInstance = renderHipHeightChart(hipHeightChartCanvas, hipHeightData); // Pass the element to the function

}

// --- Event Listeners ---
startButton.addEventListener('click', startSession);
resetButton.addEventListener('click', resetSession);
playButton.addEventListener('click', startPlayback);
