// script.js

import { getLiveFormState, getLandmarkProxy, calculateAngle, calculateValgusState } from "./posedata.js";
import { createPlaybackScene } from "./pose3d.js"; // Removed createLiveScene
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
const showWorstRepButton = document.getElementById('showWorstRepButton');
const showBestRepButton = document.getElementById('showBestRepButton');


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
let isCalibrating = false; 
// REMOVED: liveScene is no longer used
let playbackScene;
let playbackAnimationId = null;
let frameCounter = 0;
let playbackOffset = 0;
let currentVideoBlobUrl = null;
let downloadBlobUrl = null;
let isDraggingOnChart = false;
let finalRepHistory = [];
let repCounter = 0; 
let squatState = 'up';

// --- ADDED: Landmark indices for the head, used to hide them in the 2D overlay ---
const HEAD_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

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
        if (isCalibrating || isSessionRunning) {
            await pose.send({ image: videoElement });
        }
    },
    width: 640,
    height: 480
});

// --- Main Application Logic ---
function onResults(results) {
    if (!videoElement.videoWidth) return;
    drawFrame(results, false); 

    const cueElement = document.getElementById('rep-quality');

    if (isCalibrating && !isProcessingUpload) {
        const lm = results.poseLandmarks;

        if (!lm) {
            cueElement.innerText = "STAND IN FRAME";
            return;
        }

        const feetVisible = (lm[31]?.visibility > 0.8 && lm[32]?.visibility > 0.8);
        const shouldersVisible = (lm[11]?.visibility > 0.8 && lm[12]?.visibility > 0.8);

        if (!feetVisible) {
            cueElement.innerText = "MOVE FURTHER BACK";
        } else if (!shouldersVisible) {
            cueElement.innerText = "CENTER YOURSELF";
        } else {
            cueElement.innerText = "GREAT! HOLD STILL...";
            isCalibrating = false;
            setTimeout(startRecording, 1000);
        }
        return; 
    }

    if (!isSessionRunning) return;
    frameCounter++;

    const filteredLandmarks = results.poseLandmarks?.map((lm, i) => lm ? screenLandmarkFilters[i].filter(lm) : null);
    const filteredWorldLandmarks = results.poseWorldLandmarks?.map((lm, i) => lm ? worldLandmarkFilters[i].filter(lm) : null);
    
    const formState = getLiveFormState(filteredLandmarks, filteredWorldLandmarks);
    const { stats } = formState;

    drawFrame({ ...results, poseLandmarks: filteredLandmarks }, stats.kneeValgus);

    if (filteredLandmarks && filteredWorldLandmarks) {
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
            depthText = `${stats.liveDepth.toFixed(0)}°`;

            if (squatState === 'up' && stats.liveDepth < 110) { 
                squatState = 'down';
            } else if (squatState === 'down' && stats.liveDepth > 150) {
                squatState = 'up';
                repCounter++;
            }
        }
        depthEl.innerText = depthText;
        symmetryEl.innerText = stats.liveSymmetry ? `${stats.liveSymmetry.toFixed(0)}°` : 'N/A';

        if (stats.kneeValgus) {
            cueElement.innerText = 'PUSH KNEES OUT';
            cueElement.style.color = '#f87171'; // red-400
        } else if (stats.liveDepth && stats.liveDepth < 110) { 
            cueElement.innerText = 'GOOD DEPTH';
            cueElement.style.color = '#5eead4'; // teal-300
        } else {
            if (squatState === 'up') {
                cueElement.innerText = 'LIVE';
                cueElement.style.color = '#a5b4fc'; // indigo-300
            }
        }
    }
}

function drawFrame(results, hasKneeValgus) {
    if (loadingElement.style.display !== 'none') {
        loadingElement.style.display = 'none';
        videoElement.style.display = 'block';
    }
    if (!canvasCtx) return;
    outputCanvas.width = videoElement.videoWidth;
    outputCanvas.height = videoElement.videoHeight;
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    canvasCtx.drawImage(videoElement, 0, 0, outputCanvas.width, outputCanvas.height);


    if (results.poseLandmarks) {
        const legConnections = [[23, 25], [25, 27], [24, 26], [26, 28]]; 
        const valgusColor = '#ef4444'; // red-500
        const defaultColor = '#9ca3af'; // gray-400

        // Get all connections except for the legs, then filter out the face connections
        const nonLegConnections = POSE_CONNECTIONS.filter(c => !legConnections.some(lc => lc.join(',') === c.join(',')));
        const bodyConnections = nonLegConnections.filter(conn => {
            const [start, end] = conn;
            return !(HEAD_INDICES.includes(start) && HEAD_INDICES.includes(end));
        });

        // Draw the main body skeleton (without face lines)
        drawConnectors(canvasCtx, results.poseLandmarks, bodyConnections, { color: defaultColor, lineWidth: 4 });

        // Draw the legs with color based on knee valgus
        const legColor = hasKneeValgus ? valgusColor : defaultColor;
        drawConnectors(canvasCtx, results.poseLandmarks, legConnections, { color: legColor, lineWidth: 6 }); 

        // Filter out face landmarks before drawing the dots
        const bodyLandmarks = results.poseLandmarks.filter((_, i) => !HEAD_INDICES.includes(i));
        drawLandmarks(canvasCtx, bodyLandmarks, { color: '#00CFFF', lineWidth: 2 });
    }
    canvasCtx.restore();
}

// --- Session & Playback Control ---

async function startSession() {
    if (!canvasCtx) canvasCtx = outputCanvas.getContext('2d');
    
    resetSession();

    isProcessingUpload = false;
    isCalibrating = true;

    startView.style.display = 'none';
    reportView.style.display = 'none';
    sessionView.style.display = 'flex';
    loadingElement.style.display = 'flex';
    downloadButton.style.display = 'inline-block';
    
    finishButton.disabled = true; 
    document.getElementById('rep-quality').innerText = 'POSITIONING...';

    await camera.start();
}

function startRecording() {
    isSessionRunning = true;
    finishButton.disabled = false;
    document.getElementById('rep-quality').innerText = 'LIVE';

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
    if (!canvasCtx) canvasCtx = outputCanvas.getContext('2d');
    isSessionRunning = true;
    isProcessingUpload = true;
    isCalibrating = false;
    startView.style.display = 'none';
    reportView.style.display = 'none';
    sessionView.style.display = 'flex';
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
    isCalibrating = false;
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

            const STABILITY_HIGHLIGHT_COLOR = 'rgba(239, 68, 68, 0.25)';
            const DEPTH_HIGHLIGHT_COLOR = 'rgba(20, 184, 166, 0.25)';

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
    const mutedBorderColor = '#4b5563'; // gray-600
    const mutedBackgroundColor = 'rgba(75, 85, 99, 0.1)';

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

function updatePlaybackFrame(frame) {
    if (!playbackScene || !recordedWorldLandmarks[frame] || !hipChartInstance || !recordedPoseLandmarks[frame]) return;

    const formState = getLiveFormState(recordedPoseLandmarks[frame], recordedWorldLandmarks[frame]);

    playbackScene.update(recordedWorldLandmarks[frame], formState);
    
    playbackSlider.value = frame;
    hipChartInstance.options.plugins.playbackCursor.frame = frame;
    hipChartInstance.update('none');
}

function startPlayback() {
    if (playbackAnimationId) clearTimeout(playbackAnimationId);
    let frame = parseInt(playbackSlider.value, 10);
    if (frame >= recordedWorldLandmarks.length - 1) frame = 0;
    
    const PLAYBACK_FPS = 20; // Slower playback speed

    const animate = () => {
        if (frame >= recordedWorldLandmarks.length) {
            togglePlayback(); 
            playButton.innerText = "Replay";
            return;
        }
        updatePlaybackFrame(frame++);
        playbackAnimationId = setTimeout(animate, 1000 / PLAYBACK_FPS);
    };
    animate();
}

function togglePlayback() {
    if (playbackAnimationId) {
        clearTimeout(playbackAnimationId);
        playbackAnimationId = null;
        playButton.innerText = "Play 3D Reps";
        if (hipChartInstance) {
            hipChartInstance.options.plugins.playbackCursor.frame = null;
            hipChartInstance.update('none');
        }
    } else {
        clearRepHighlight();
        playButton.innerText = "Pause";
        startPlayback();
    }
}

function resetSession() {
    reportView.style.display = 'none';
    sessionView.style.display = 'none';
    startView.style.display = 'flex';
    if (playbackAnimationId) clearTimeout(playbackAnimationId);
    if (currentVideoBlobUrl) URL.revokeObjectURL(currentVideoBlobUrl);
    if (downloadBlobUrl) URL.revokeObjectURL(downloadBlobUrl);
    
    isSessionRunning = false;
    isCalibrating = false;
    isProcessingUpload = false; 
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
    videoElement.load(); // <-- BUG FIX: Re-added this line to ensure the video element is fully reset.
    videoUploadInput.value = null;
    
    const scoreCircle = document.querySelector('.score-circle');
    if (scoreCircle) scoreCircle.style.setProperty('--p', 0);
    document.getElementById('report-score-value').innerText = '0';
    playButton.disabled = false;
    finishButton.disabled = false;
    playButton.innerText = "Play 3D Reps";
    
    toggleDepthLaser.checked = true; 
    if (playbackScene) {
        playbackScene.setDepthLaserVisibility(true);
    }
    
    downloadButton.href = '#';
    
    ['depth', 'symmetry'].forEach(stat => document.getElementById(stat).innerText = 'N/A');

    // BUG FIX: Also reset the color of the status text
    const repQualityEl = document.getElementById('rep-quality');
    repQualityEl.innerText = 'LIVE';
    repQualityEl.style.color = 'white';
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
        if(!isNaN(currentFrame)) {
            updatePlaybackFrame(currentFrame); 
        }
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