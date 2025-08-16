// script.js

import { getLivePoseStats, getLandmarkProxy, calculateAngle, calculateValgusState } from "./posedata.js";
import { createLiveScene, createPlaybackScene } from "./pose3d.js";
import { LandmarkFilter } from "./filter.js";
import { processAndRenderReport } from "./report.js"; // <-- NEW IMPORT

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
const finishButton = document.getElementById('finishButton');
const resetButton = document.getElementById('resetButton');
const downloadButton = document.getElementById('downloadButton');
const playButton = document.getElementById('playButton');
const videoUploadInput = document.getElementById('videoUpload');
const playbackSlider = document.getElementById('playbackSlider');

// --- State Management ---
let mediaRecorder;
let recordedChunks = [];
let recordedWorldLandmarks = [];
let recordedPoseLandmarks = [];
let hipHeightData = [];
let symmetryData = [];
let valgusData = [];
let hipChartInstance;
let isSessionRunning = false;
let isProcessingUpload = false;
let liveScene, playbackScene;
let playbackAnimationId = null;
let frameCounter = 0;
let playbackOffset = 0;
let currentVideoBlobUrl = null;
let downloadBlobUrl = null;
let isDraggingOnChart = false;
let finalRepHistory = [];

// --- Landmark Filters ---
let screenLandmarkFilters = {};
let worldLandmarkFilters = {};
for (let i = 0; i < 33; i++) {
    screenLandmarkFilters[i] = new LandmarkFilter(0.8, 0.3);
    worldLandmarkFilters[i] = new LandmarkFilter(0.8, 0.3);
}

// --- MediaPipe Pose ---
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});
pose.setOptions({
    modelComplexity: 2,
    smoothLandmarks: true,
    minDetectionConfidence: 0.75,
    minTrackingConfidence: 0.8
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
    frameCounter++;

    const filteredLandmarks = results.poseLandmarks?.map((lm, i) => lm ? screenLandmarkFilters[i].filter(lm) : null);
    const filteredWorldLandmarks = results.poseWorldLandmarks?.map((lm, i) => lm ? worldLandmarkFilters[i].filter(lm) : null);
    const stats = getLivePoseStats(filteredLandmarks, filteredWorldLandmarks);
    drawFrame({ ...results, poseLandmarks: filteredLandmarks });

    if (filteredLandmarks && filteredWorldLandmarks) {
        liveScene.update(filteredWorldLandmarks);
        recordedWorldLandmarks.push(JSON.parse(JSON.stringify(filteredWorldLandmarks)));
        recordedPoseLandmarks.push(JSON.parse(JSON.stringify(filteredLandmarks)));

        const leftHip = filteredLandmarks[23], rightHip = filteredLandmarks[24];
        hipHeightData.push((leftHip && rightHip && leftHip.visibility > 0.5 && rightHip.visibility > 0.5) ? (leftHip.y + rightHip.y) / 2 : null);

        const { left, right } = getLandmarkProxy(filteredLandmarks);
        const leftKneeAngle = calculateAngle(left?.hip, left?.knee, left?.ankle);
        const rightKneeAngle = calculateAngle(right?.hip, right?.knee, right?.ankle);
        if (leftKneeAngle !== null && rightKneeAngle !== null) {
            symmetryData.push(100 * Math.exp(-0.07 * Math.abs(leftKneeAngle - rightKneeAngle)));
        } else {
            symmetryData.push(null);
        }

        const valgusState = calculateValgusState(filteredLandmarks, filteredWorldLandmarks);
        if (valgusState.confidence > 0.5) {
            const maxValgus = Math.max(valgusState.left, valgusState.right);
            valgusData.push(100 * Math.max(0, 1 - (maxValgus / 0.24)));
        } else {
            valgusData.push(null);
        }

        document.getElementById('depth').innerText = stats.liveDepth ? `${stats.liveDepth.toFixed(0)}°` : 'N/A';
        document.getElementById('symmetry').innerText = stats.liveSymmetry ? `${stats.liveSymmetry.toFixed(0)}°` : 'N/A';
    }
}

function drawFrame(results) {
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
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#DDDDDD', lineWidth: 4 });
        drawLandmarks(canvasCtx, results.poseLandmarks, { color: '#00CFFF', lineWidth: 2 });
    }
    canvasCtx.restore();
}

// --- Session & Playback Control ---
async function startSession() {
    if (!liveScene) liveScene = createLiveScene(document.getElementById('pose3dCanvas'));
    if (!canvasCtx) canvasCtx = outputCanvas.getContext('2d');
    resetSession();
    isSessionRunning = true;
    isProcessingUpload = false;
    startView.style.display = 'none';
    reportView.style.display = 'none';
    sessionView.style.display = 'block';
    loadingElement.style.display = 'flex';
    downloadButton.style.display = 'inline-block';
    await camera.start();

    const stream = outputCanvas.captureStream(30);
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        downloadBlobUrl = URL.createObjectURL(blob);
        downloadButton.href = downloadBlobUrl;
        recordedChunks = [];
    };
    mediaRecorder.start();
}

function startUploadSession(file) {
    resetSession();
    if (!liveScene) liveScene = createLiveScene(document.getElementById('pose3dCanvas'));
    if (!canvasCtx) canvasCtx = outputCanvas.getContext('2d');
    isSessionRunning = true;
    isProcessingUpload = true;
    startView.style.display = 'none';
    reportView.style.display = 'none';
    sessionView.style.display = 'block';
    loadingElement.style.display = 'flex';
    downloadButton.style.display = 'none';

    videoElement.style.display = 'block';
    currentVideoBlobUrl = URL.createObjectURL(file);
    videoElement.src = currentVideoBlobUrl;
    videoElement.load();
    videoElement.onloadeddata = () => {
        loadingElement.style.display = 'none';
        videoElement.play();
        processVideoFrames();
    };
}

async function processVideoFrames() {
    if (!isProcessingUpload || videoElement.paused || videoElement.ended) {
        if (isSessionRunning) stopSession();
        return;
    }
    await pose.send({ image: videoElement });
    requestAnimationFrame(processVideoFrames);
}

function stopSession() {
    isSessionRunning = false;
    if (!isProcessingUpload && mediaRecorder?.state === 'recording') mediaRecorder.stop();
    if (!isProcessingUpload) camera.stop();

    if (!playbackScene) playbackScene = createPlaybackScene(playbackCanvas);

    videoElement.style.display = 'none';
    sessionView.style.display = 'none';
    reportView.style.display = 'block';

    if (hipChartInstance) hipChartInstance.destroy();
    
    // Call the refactored report generation function
    const reportResult = processAndRenderReport({
        recordedPoseLandmarks, recordedWorldLandmarks, hipHeightData, symmetryData, valgusData, frameCounter
    });

    if (reportResult) {
        // Update state with the processed & cropped data from the report
        finalRepHistory = reportResult.finalRepHistory;
        playbackOffset = reportResult.playbackOffset;
        hipChartInstance = reportResult.chartInstance;
        ({ recordedWorldLandmarks, recordedPoseLandmarks, hipHeightData, symmetryData, valgusData } = reportResult.croppedData);
        
        setupReportInteractivity();
        updatePlaybackFrame(0);
    } else {
        resetSession(); // Reset if no reps were found
    }
}

function setupReportInteractivity() {
    const originalDatasetColors = hipChartInstance.data.datasets.map(ds => ({
        borderColor: ds.borderColor, backgroundColor: ds.backgroundColor,
    }));
    const mutedBorderColor = '#555555';
    const mutedBackgroundColor = 'rgba(85, 85, 85, 0.1)';

    const setChartFocus = (focusIndex = -1) => {
        if (!hipChartInstance) return;
        originalDatasetColors.forEach((originalColors, index) => {
            const dataset = hipChartInstance.data.datasets[index];
            const isFocused = focusIndex === -1 || index === focusIndex;
            dataset.borderColor = isFocused ? originalColors.borderColor : mutedBorderColor;
            dataset.backgroundColor = isFocused ? originalColors.backgroundColor : mutedBackgroundColor;
        });
        hipChartInstance.update();
    };

    const breakdownItems = {
        'breakdown-item-depth': 0, 'breakdown-item-consistency': 0,
        'breakdown-item-symmetry': 1, 'breakdown-item-valgus': 2,
    };
    for (const [id, index] of Object.entries(breakdownItems)) {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('mouseenter', () => setChartFocus(index));
            element.addEventListener('mouseleave', () => setChartFocus(-1));
        }
    }

    const handleChartDrag = (e) => {
        const rect = hipChartInstance.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        let frame = Math.round(hipChartInstance.scales.x.getValueForPixel(x));
        frame = Math.max(0, Math.min(frame, recordedWorldLandmarks.length - 1));
        updatePlaybackFrame(frame);
    };

    hipChartInstance.canvas.addEventListener('mousedown', (e) => {
        isDraggingOnChart = true;
        if (playbackAnimationId) togglePlayback();
        handleChartDrag(e);
    });
    hipChartInstance.canvas.addEventListener('mousemove', (e) => {
        if (isDraggingOnChart) handleChartDrag(e);
    });
    const stopDragging = () => { isDraggingOnChart = false; };
    hipChartInstance.canvas.addEventListener('mouseup', stopDragging);
    hipChartInstance.canvas.addEventListener('mouseleave', stopDragging);
}

function updatePlaybackFrame(frame) {
    if (!playbackScene || !recordedWorldLandmarks[frame] || !hipChartInstance) return;
    const currentRep = finalRepHistory.find(rep => (frame + playbackOffset) >= rep.startFrame && (frame + playbackOffset) <= rep.endFrame);
    const hasKneeValgus = currentRep ? (currentRep.maxLeftValgus > 0.08 || currentRep.maxRightValgus > 0.08) : false;
    playbackScene.update(recordedWorldLandmarks[frame]);
    playbackScene.updateColors(hasKneeValgus);
    playbackSlider.value = frame;
    hipChartInstance.options.plugins.playbackCursor.frame = frame;
    hipChartInstance.update('none');
}

function startPlayback() {
    if (playbackAnimationId) cancelAnimationFrame(playbackAnimationId);
    let frame = parseInt(playbackSlider.value, 10);
    if (frame >= recordedWorldLandmarks.length - 1) frame = 0;
    playButton.disabled = true;
    playButton.innerText = "Playing...";
    
    const animate = () => {
        if (frame >= recordedWorldLandmarks.length) {
            togglePlayback(); // Will stop the animation
            playButton.innerText = "Replay";
            return;
        }
        updatePlaybackFrame(frame++);
        playbackAnimationId = requestAnimationFrame(animate);
    };
    animate();
}

function togglePlayback() {
    if (playbackAnimationId) {
        cancelAnimationFrame(playbackAnimationId);
        playbackAnimationId = null;
        playButton.disabled = false;
        playButton.innerText = "Play 3D Reps";
        if (hipChartInstance) {
            hipChartInstance.options.plugins.playbackCursor.frame = null;
            hipChartInstance.update('none');
        }
    } else {
        startPlayback();
    }
}

function resetSession() {
    reportView.style.display = 'none';
    sessionView.style.display = 'none';
    startView.style.display = 'block';
    if (playbackAnimationId) cancelAnimationFrame(playbackAnimationId);
    if (currentVideoBlobUrl) URL.revokeObjectURL(currentVideoBlobUrl);
    if (downloadBlobUrl) URL.revokeObjectURL(downloadBlobUrl);
    
    isSessionRunning = false;
    frameCounter = 0;
    playbackOffset = 0;
    recordedChunks = [];
    finalRepHistory = [];
    [recordedWorldLandmarks, recordedPoseLandmarks, hipHeightData, symmetryData, valgusData] = [[], [], [], [], []];
    
    Object.values(screenLandmarkFilters).forEach(f => f.reset());
    Object.values(worldLandmarkFilters).forEach(f => f.reset());
    
    if (hipChartInstance) {
        hipChartInstance.destroy();
        hipChartInstance = null;
    }
    videoElement.pause();
    videoElement.src = '';
    videoElement.srcObject = null;
    videoElement.load();
    videoUploadInput.value = null;
    
    const scoreCircle = document.querySelector('.score-circle');
    if (scoreCircle) scoreCircle.style.setProperty('--p', 0);
    document.getElementById('report-score-value').innerText = '0';
    playButton.disabled = false;
    playButton.innerText = "Play 3D Reps";
    downloadButton.href = '#';
    
    ['depth', 'symmetry'].forEach(stat => document.getElementById(stat).innerText = 'N/A');
}

// --- Event Listeners ---
startButton.addEventListener('click', startSession);
finishButton.addEventListener('click', stopSession);
resetButton.addEventListener('click', resetSession);
playButton.addEventListener('click', togglePlayback);
videoUploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) startUploadSession(file);
});
playbackSlider.addEventListener('input', (e) => {
    if (playbackAnimationId) togglePlayback();
    updatePlaybackFrame(parseInt(e.target.value, 10));
});
document.addEventListener('keydown', (event) => {
    if (reportView.style.display === 'block' && event.target.tagName !== 'INPUT' && event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
    }
});