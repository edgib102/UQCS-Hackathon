// script.js

import { getLiveFormState, getLandmarkProxy, calculateAngle, calculateValgusState } from "./posedata.js";
import { createLiveScene, createPlaybackScene } from "./pose3d.js";
import { LandmarkFilter } from "./filter.js";
import { processAndRenderReport } from "./report.js";

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
const toggleDepthLaser = document.getElementById('toggleDepthLaser');
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
let repCounter = 0; 
let squatState = 'up';

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
    
    // --- MODIFIED --- Use the new master analysis function
    const formState = getLiveFormState(filteredLandmarks, filteredWorldLandmarks);
    const { stats } = formState;

    // Use a simplified version for the 2D canvas overlay
    drawFrame({ ...results, poseLandmarks: filteredLandmarks }, stats.kneeValgus);

    if (filteredLandmarks && filteredWorldLandmarks) {
        // --- MODIFIED --- Pass the full formState to the 3D scene
        liveScene.update(filteredWorldLandmarks, formState);
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

        const valgusStateRaw = calculateValgusState(filteredLandmarks, filteredWorldLandmarks);
        if (valgusStateRaw.confidence > 0.5) {
            const maxValgus = Math.max(valgusStateRaw.left, valgusStateRaw.right);
            valgusData.push(100 * Math.max(0, 1 - (maxValgus / 0.24)));
        } else {
            valgusData.push(null);
        }
        
        const depthEl = document.getElementById('depth');
        const symmetryEl = document.getElementById('symmetry');
        let depthText = 'N/A';
        if (stats.liveDepth) {
            let quality = '';
            if (stats.liveDepth < 95) quality = ' (Excellent)';
            else if (stats.liveDepth < 110) quality = ' (Good)';
            else if (stats.liveDepth < 150) quality = ' (Shallow)';
            depthText = `${stats.liveDepth.toFixed(0)}°${quality}`;

            if (squatState === 'up' && stats.liveDepth < 110) { // SQUAT_THRESHOLD
                squatState = 'down';
            } else if (squatState === 'down' && stats.liveDepth > 150) { // A bit less than STANDING_THRESHOLD
                squatState = 'up';
                repCounter++;
                document.getElementById('rep-quality').innerText = `REPS: ${repCounter}`; // Update the STATUS field
            }
        }
        depthEl.innerText = depthText;
        symmetryEl.innerText = stats.liveSymmetry ? `${stats.liveSymmetry.toFixed(0)}°` : 'N/A';

        const cueElement = document.getElementById('rep-quality'); 

        if (stats.kneeValgus) {
            cueElement.innerText = 'PUSH KNEES OUT';
            cueElement.style.color = '#FF4136';
        } else if (stats.liveDepth && stats.liveDepth < 110) { 
            cueElement.innerText = 'GOOD DEPTH';
            cueElement.style.color = '#39CCCC';
        } else {
            if (squatState === 'up') {
                cueElement.innerText = 'LIVE';
                cueElement.style.color = 'white'; 
            }
        }
    }
}

// --- MODIFIED --- Accepts kneeValgus boolean for simple 2D overlay coloring
function drawFrame(results, hasKneeValgus) {
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
        const legConnections = [[23, 25], [25, 27], [24, 26], [26, 28]]; 
        const valgusColor = '#FF4136'; 
        const defaultColor = '#DDDDDD';

        const nonLegConnections = POSE_CONNECTIONS.filter(c => !legConnections.some(lc => lc.join(',') === c.join(',')));
        drawConnectors(canvasCtx, results.poseLandmarks, nonLegConnections, { color: defaultColor, lineWidth: 4 });

        const legColor = hasKneeValgus ? valgusColor : defaultColor;
        drawConnectors(canvasCtx, results.poseLandmarks, legConnections, { color: legColor, lineWidth: 6 }); 

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
    
    const reportResult = processAndRenderReport({
        recordedPoseLandmarks, recordedWorldLandmarks, hipHeightData, symmetryData, valgusData, frameCounter
    });

    if (reportResult) {
        finalRepHistory = reportResult.finalRepHistory;
        playbackOffset = reportResult.playbackOffset;
        hipChartInstance = reportResult.chartInstance;
        ({ recordedWorldLandmarks, recordedPoseLandmarks, hipHeightData, symmetryData, valgusData } = reportResult.croppedData);
        
        setupReportInteractivity();
        updatePlaybackFrame(0);

        if (finalRepHistory.length > 0) {
            const worstStabRep = finalRepHistory.reduce((prev, current) => {
                const prevValgus = Math.max(prev.maxLeftValgus, prev.maxRightValgus);
                const currentValgus = Math.max(current.maxLeftValgus, current.maxRightValgus);
                return (currentValgus > prevValgus) ? current : prev;
            });

            const bestDepthRep = finalRepHistory.reduce((prev, current) => {
                return (current.depth < prev.depth) ? current : prev;
            });

            const showWorstRepButton = document.getElementById('showWorstRepButton');
            const showBestRepButton = document.getElementById('showBestRepButton');

            const STABILITY_HIGHLIGHT_COLOR = 'rgba(255, 65, 54, 0.25)';
            const DEPTH_HIGHLIGHT_COLOR = 'rgba(57, 204, 204, 0.25)';

            const highlightRepOnChart = (rep, color) => {
                if (!hipChartInstance || !rep) return;
                const startFrame = rep.startFrame - playbackOffset;
                const endFrame = rep.endFrame - playbackOffset;
                
                const highlighterOptions = hipChartInstance.options.plugins.repHighlighter;
                highlighterOptions.startFrame = startFrame;
                highlighterOptions.endFrame = endFrame;
                highlighterOptions.color = color;
                hipChartInstance.update(); 
                
                updatePlaybackFrame(Math.max(0, startFrame));
            };

            showWorstRepButton.addEventListener('click', () => {
                highlightRepOnChart(worstStabRep, STABILITY_HIGHLIGHT_COLOR);
            });

            showBestRepButton.addEventListener('click', () => {
                highlightRepOnChart(bestDepthRep, DEPTH_HIGHLIGHT_COLOR);
            });
        }
    } else {
        resetSession(); 
    }
}

function clearRepHighlight() {
    if (!hipChartInstance) return;
    const highlighterOptions = hipChartInstance.options.plugins.repHighlighter;
    if (highlighterOptions.startFrame !== null || highlighterOptions.color !== null) {
        highlighterOptions.startFrame = null;
        highlighterOptions.endFrame = null;
        highlighterOptions.color = null;
        hipChartInstance.update();
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
        clearRepHighlight(); 
        handleChartDrag(e);
    });
    hipChartInstance.canvas.addEventListener('mousemove', (e) => {
        if (isDraggingOnChart) handleChartDrag(e);
    });
    const stopDragging = () => { isDraggingOnChart = false; };
    hipChartInstance.canvas.addEventListener('mouseup', stopDragging);
    hipChartInstance.canvas.addEventListener('mouseleave', stopDragging);
}

// --- MODIFIED --- This function now also gets and passes formState for playback visualizations
function updatePlaybackFrame(frame) {
    if (!playbackScene || !recordedWorldLandmarks[frame] || !hipChartInstance || !recordedPoseLandmarks[frame]) return;

    // --- NEW --- Get the form state for the specific frame in the past
    const formState = getLiveFormState(recordedPoseLandmarks[frame], recordedWorldLandmarks[frame]);

    // --- MODIFIED --- Pass the historical formState to the playback scene
    playbackScene.update(recordedWorldLandmarks[frame], formState);
    
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
            togglePlayback(); 
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
        clearRepHighlight(); 
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
    repCounter = 0;
    squatState = 'up';
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
    
    toggleDepthLaser.checked = true; // Set to "on" by default
    if (playbackScene) {
        playbackScene.setDepthLaserVisibility(true);
    }
    
    downloadButton.href = '#';
    
    ['depth', 'symmetry'].forEach(stat => document.getElementById(stat).innerText = 'N/A');

    document.getElementById('rep-quality').innerText = 'LIVE';
}

// --- Event Listeners ---
startButton.addEventListener('click', startSession);
finishButton.addEventListener('click', stopSession);
resetButton.addEventListener('click', resetSession);
playButton.addEventListener('click', togglePlayback);
toggleDepthLaser.addEventListener('change', () => {
    if (playbackScene) {
        playbackScene.setDepthLaserVisibility(toggleDepthLaser.checked);
        const currentFrame = parseInt(playbackSlider.value, 10);
        updatePlaybackFrame(currentFrame); // Force a re-render to show the change immediately
    }
});
videoUploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) startUploadSession(file);
});
playbackSlider.addEventListener('input', (e) => {
    if (playbackAnimationId) togglePlayback();
    clearRepHighlight(); 
    updatePlaybackFrame(parseInt(e.target.value, 10));
});
document.addEventListener('keydown', (event) => {
    if (reportView.style.display === 'block' && event.target.tagName !== 'INPUT' && event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
    }
});