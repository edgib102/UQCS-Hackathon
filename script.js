// script.js

import { 
    getLivePoseStats,
    getLandmarkProxy,
    calculateAngle,
    analyzeSession,
    STANDING_THRESHOLD
} from "./posedata.js";
import { createLiveScene, createPlaybackScene } from "./pose3d.js";
import { renderHipHeightChart } from "./chart.js";
import { LandmarkFilter } from "./filter.js";

// --- Configuration ---
const PLAYBACK_FPS = 30;

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

// --- State Management ---
let mediaRecorder;
let recordedChunks = [];
let recordedWorldLandmarks = [];
let recordedPoseLandmarks = [];
let hipHeightData = [];
let symmetryData = [];
let hipChartInstance;
let isSessionRunning = false;
let isProcessingUpload = false;
let liveScene, playbackScene;
let playbackAnimationId = null;
let frameCounter = 0;
let playbackOffset = 0;

let screenLandmarkFilters = {}; 
let worldLandmarkFilters = {};
for (let i = 0; i < 33; i++) {
    screenLandmarkFilters[i] = new LandmarkFilter();
    worldLandmarkFilters[i] = new LandmarkFilter();
}
let finalRepHistory = [];

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

    drawFrame({ ...results, poseLandmarks: filteredLandmarks }, stats.kneeValgus);
    
    if (filteredLandmarks && filteredWorldLandmarks) {
        liveScene.update(filteredWorldLandmarks);
        
        recordedWorldLandmarks.push(JSON.parse(JSON.stringify(filteredWorldLandmarks)));
        recordedPoseLandmarks.push(JSON.parse(JSON.stringify(filteredLandmarks)));

        const leftHip = filteredLandmarks[23];
        const rightHip = filteredLandmarks[24];
        if (leftHip && rightHip && leftHip.visibility > 0.5 && rightHip.visibility > 0.5) {
            hipHeightData.push((leftHip.y + rightHip.y) / 2);
        } else {
            hipHeightData.push(null);
        }
        
        const { left, right } = getLandmarkProxy(filteredLandmarks);
        const leftKneeAngle = calculateAngle(left?.hip, left?.knee, left?.ankle);
        const rightKneeAngle = calculateAngle(right?.hip, right?.knee, right?.ankle);
        
        if(leftKneeAngle !== null && rightKneeAngle !== null){
            const symmetryDiff = Math.abs(leftKneeAngle - rightKneeAngle);
            const symmetryPercentage = 100 * Math.exp(-0.07 * symmetryDiff);
            symmetryData.push(symmetryPercentage);
        } else {
             symmetryData.push(null);
        }

        document.getElementById('depth').innerText = stats.liveDepth ? `${stats.liveDepth.toFixed(0)}°` : 'N/A';
        document.getElementById('symmetry').innerText = stats.liveSymmetry ? `${stats.liveSymmetry.toFixed(0)}°` : 'N/A';
    }
}

function drawFrame(results, kneeValgus = false) {
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
    
    const stream = outputCanvas.captureStream(PLAYBACK_FPS);
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        downloadButton.href = URL.createObjectURL(blob);
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
    videoElement.src = URL.createObjectURL(file);
    videoElement.load();
    videoElement.onloadeddata = () => {
        loadingElement.style.display = 'none';
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
    
    videoElement.style.display = 'none';
    sessionView.style.display = 'none';
    reportView.style.display = 'block';
    
    generateReport();
    if (!playbackScene) playbackScene = createPlaybackScene(playbackCanvas);
}

function startPlayback() {
    if (playbackAnimationId) cancelAnimationFrame(playbackAnimationId);
    if (!playbackScene) playbackScene = createPlaybackScene(playbackCanvas);
    if (finalRepHistory.length === 0 || recordedWorldLandmarks.length === 0) return;

    const repFrameMap = new Map();
    finalRepHistory.forEach((rep) => {
        for (let i = rep.startFrame; i <= rep.endFrame; i++) {
            repFrameMap.set(i, rep);
        }
    });

    let frame = 0;
    playButton.disabled = true;
    playButton.innerText = "Playing...";

    if (hipChartInstance) {
        hipChartInstance.data.labels = [];
        hipChartInstance.data.datasets[0].data = [];
        hipChartInstance.data.datasets[1].data = [];
        hipChartInstance.update('none');
    }

    const animate = () => {
        if (reportView.style.display === 'none' || frame >= recordedWorldLandmarks.length) {
            playButton.disabled = false;
            playButton.innerText = "Replay";
            return;
        }

        const originalFrame = frame + playbackOffset;
        const currentRep = repFrameMap.get(originalFrame);
        const hasKneeValgus = currentRep ? currentRep.kneeValgus : false;
        
        playbackScene.update(recordedWorldLandmarks[frame]);
        playbackScene.updateColors(hasKneeValgus);

        if (hipChartInstance) {
            hipChartInstance.data.labels.push(originalFrame);
            hipChartInstance.data.datasets[0].data.push(hipHeightData[frame]);
            hipChartInstance.data.datasets[1].data.push(symmetryData[frame]);
            hipChartInstance.update('none'); 
        }
        frame++;
        playbackAnimationId = requestAnimationFrame(animate);
    };
    animate();
}

function resetSession() {
    reportView.style.display = 'none';
    startView.style.display = 'block';
    if (playbackAnimationId) cancelAnimationFrame(playbackAnimationId);
    
    isSessionRunning = false;
    frameCounter = 0;
    playbackOffset = 0;
    finalRepHistory = [];
    recordedWorldLandmarks = [];
    recordedPoseLandmarks = [];
    hipHeightData = [];
    symmetryData = [];
    
    for (let i = 0; i < 33; i++) {
        screenLandmarkFilters[i].reset();
        worldLandmarkFilters[i].reset();
    }

    if (hipChartInstance) {
        hipChartInstance.destroy();
        hipChartInstance = null;
    }
    
    const scoreCircle = document.querySelector('.score-circle');
    if (scoreCircle) scoreCircle.style.setProperty('--p', 0);
    document.getElementById('report-score-value').innerText = '0';
    ['depth', 'symmetry', 'valgus', 'consistency'].forEach(metric => {
         document.getElementById(`breakdown-score-${metric}`).innerText = `0/${{depth:30, symmetry:30, valgus:20, consistency:20}[metric]}`;
         document.getElementById(`breakdown-desc-${metric}`).innerText = '';
    });
   
    playButton.disabled = false;
    playButton.innerText = "Play 3D Reps";

    document.getElementById('rep-quality').innerText = 'LIVE';
    document.getElementById('depth').innerText = 'N/A';
    document.getElementById('symmetry').innerText = 'N/A';
}

function updateBreakdown(metric, score, weight, value) {
    const scoreEl = document.getElementById(`breakdown-score-${metric}`);
    const descEl = document.getElementById(`breakdown-desc-${metric}`);
    scoreEl.innerText = `${Math.round(score)}/${weight}`;
    let description = '';
    
    switch (metric) {
        case 'depth':
            description = score > weight * 0.85 ? `Excellent depth! Your average angle of ${value.toFixed(0)}° shows great range of motion.`
                        : score > weight * 0.6 ? `Good depth. You're reaching an average of ${value.toFixed(0)}°. Try to go a little lower.`
                        : `Your depth of ${value.toFixed(0)}° is shallow. Focus on lowering your hips until they are parallel with your knees.`;
            break;
        case 'symmetry':
            description = score > weight * 0.85 ? `Great balance, with an average symmetry of ${value.toFixed(0)}%. Your weight seems evenly distributed.`
                        : score > weight * 0.6 ? `Good symmetry (${value.toFixed(0)}%). There's a slight imbalance. Focus on keeping pressure even across both feet.`
                        : `There's a noticeable imbalance (${value.toFixed(0)}%). You may be favoring one side. Try to push the ground away evenly with both legs.`;
            break;
        case 'valgus':
            description = value === 0 ? `Perfect! Your knees remained stable and did not cave inwards on any rep.`
                        : value <= 2 ? `Good stability, but your knees caved in on ${value} rep(s). Focus on actively pushing your knees outwards as you stand up.`
                        : `Your knees caved in on ${value} reps, increasing injury risk. Actively push your knees out, especially when tired.`;
            break;
        case 'consistency':
             description = score > weight * 0.85 ? `Excellent consistency, with a depth variation of only ${value.toFixed(1)}°. You maintained solid form.`
                         : score > weight * 0.6 ? `Good job. There were some minor variations (${value.toFixed(1)}°) in your form. Aim for every rep to look the same.`
                         : `Your form was inconsistent (depth varied by ${value.toFixed(1)}°). This can happen with fatigue. Focus on control, not just reps.`;
            break;
    }
    descEl.innerText = description;
}

function generateReport() {
    finalRepHistory = analyzeSession(recordedPoseLandmarks, recordedWorldLandmarks);
    if (finalRepHistory.length === 0) {
        alert("No valid squats were detected in the session. Please ensure your full body is visible and try again.");
        resetSession();
        return;
    }
    
    const repsForReport = finalRepHistory;

    const firstSquatStartFrame = repsForReport[0].startFrame;
    const lastSquatEndFrame = repsForReport[repsForReport.length - 1].endFrame;
    const cropStartFrame = Math.max(0, firstSquatStartFrame - PLAYBACK_FPS);
    const cropEndFrame = Math.min(frameCounter, lastSquatEndFrame + PLAYBACK_FPS);

    playbackOffset = cropStartFrame;
    recordedWorldLandmarks = recordedWorldLandmarks.slice(cropStartFrame, cropEndFrame);
    recordedPoseLandmarks = recordedPoseLandmarks.slice(cropStartFrame, cropEndFrame);
    hipHeightData = hipHeightData.slice(cropStartFrame, cropEndFrame);
    symmetryData = symmetryData.slice(cropStartFrame, cropEndFrame);
    
    const weights = { depth: 30, symmetry: 30, valgus: 20, consistency: 20 };
    const SQUAT_IDEAL_DEPTH = 90;

    const avgDepthAngle = repsForReport.reduce((s, r) => s + r.depth, 0) / repsForReport.length;
    const depthProgress = (STANDING_THRESHOLD - avgDepthAngle) / (STANDING_THRESHOLD - SQUAT_IDEAL_DEPTH);
    const depthScore = Math.max(0, Math.min(1, depthProgress)) * weights.depth;

    const avgSymmetryDiff = repsForReport.reduce((s, r) => s + r.symmetry, 0) / repsForReport.length;
    const avgSymmetryPercent = 100 * Math.exp(-0.07 * avgSymmetryDiff);
    const symmetryScore = (avgSymmetryPercent / 100) * weights.symmetry;

    const valgusCount = repsForReport.filter(r => r.kneeValgus).length;
    const valgusPenalty = (valgusCount / repsForReport.length) * weights.valgus;
    const valgusScore = Math.max(0, weights.valgus - valgusPenalty);

    const depths = repsForReport.map(r => r.depth);
    const meanDepth = depths.reduce((a, b) => a + b) / depths.length;
    const stdDev = depths.length > 1 ? Math.sqrt(depths.map(x => Math.pow(x - meanDepth, 2)).reduce((a, b) => a + b) / (depths.length -1)) : 0;
    const MAX_ACCEPTABLE_STD_DEV = 10;
    const consistencyProgress = Math.max(0, 1 - (stdDev / MAX_ACCEPTABLE_STD_DEV));
    const consistencyScore = consistencyProgress * weights.consistency;
    
    const totalScore = Math.round(depthScore + symmetryScore + valgusScore + consistencyScore);
    
    const scoreCircle = document.querySelector('.score-circle');
    const scoreValueEl = document.getElementById('report-score-value');
    setTimeout(() => scoreCircle.style.setProperty('--p', totalScore), 100);
    scoreValueEl.innerText = totalScore;
    
    document.getElementById('report-quality-overall').innerText = totalScore > 85 ? "Excellent" : totalScore > 65 ? "Good" : "Needs Work";
    document.getElementById('report-depth-avg').innerText = `${avgDepthAngle.toFixed(0)}°`;
    document.getElementById('report-symmetry-avg').innerText = `${avgSymmetryPercent.toFixed(0)}%`;
    document.getElementById('report-valgus-count').innerText = `${valgusCount} of ${repsForReport.length} reps`;

    updateBreakdown('depth', depthScore, weights.depth, avgDepthAngle);
    updateBreakdown('symmetry', symmetryScore, weights.symmetry, avgSymmetryPercent);
    updateBreakdown('valgus', valgusScore, weights.valgus, valgusCount);
    updateBreakdown('consistency', consistencyScore, weights.consistency, stdDev);
    
    const hipHeightChartCanvas = document.getElementById('hipHeightChart');
    if (hipChartInstance) hipChartInstance.destroy();
    hipChartInstance = renderHipHeightChart(hipHeightChartCanvas, [], []);
}

// --- Event Listeners ---
startButton.addEventListener('click', startSession);
finishButton.addEventListener('click', stopSession);
resetButton.addEventListener('click', resetSession);
playButton.addEventListener('click', startPlayback);
videoUploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) startUploadSession(file);
});