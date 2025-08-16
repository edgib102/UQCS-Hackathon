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
        
        const VALGUS_VISUAL_THRESHOLD = 0.03; // 3cm
        const hasKneeValgus = currentRep ? (currentRep.maxLeftValgus > VALGUS_VISUAL_THRESHOLD || currentRep.maxRightValgus > VALGUS_VISUAL_THRESHOLD) : false;
        
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

/**
 * Updates the UI with detailed feedback for a specific metric.
 * @param {string} metric - The metric being updated ('depth', 'symmetry', etc.).
 * @param {number} score - The calculated score for the metric.
 * @param {number} weight - The maximum possible score for the metric.
 * @param {object} values - An object containing relevant data for the feedback text.
 */
function updateBreakdown(metric, score, weight, values) {
    const scoreEl = document.getElementById(`breakdown-score-${metric}`);
    const descEl = document.getElementById(`breakdown-desc-${metric}`);
    scoreEl.innerText = `${Math.round(score)}/${weight}`;
    let description = '';

    const performanceTier = score / weight; // 0.0 to 1.0

    switch (metric) {
        case 'depth':
            const { avgAngle } = values;
            if (performanceTier > 0.9) {
                description = `Fantastic depth! Your average angle of ${avgAngle.toFixed(0)}° shows an excellent range of motion. This is key for maximizing muscle activation.`;
            } else if (performanceTier > 0.65) {
                description = `Good depth. You're reaching ${avgAngle.toFixed(0)}° on average. Focus on sinking your hips just a little lower to get parallel (90°) for even better results.`;
            } else {
                description = `Your depth is currently shallow at ${avgAngle.toFixed(0)}°. Work on flexibility and control to lower your hips until your thighs are parallel with the floor.`;
            }
            break;

        case 'symmetry':
            const { avgPercent } = values;
            if (performanceTier > 0.9) {
                description = `Excellent balance! With ${avgPercent.toFixed(0)}% symmetry, your form is very stable and weight is evenly distributed. Keep it up!`;
            } else if (performanceTier > 0.65) {
                description = `Good symmetry (${avgPercent.toFixed(0)}%). There's a slight imbalance. Try focusing on pushing the ground away with both feet equally, especially as you stand up.`;
            } else {
                description = `A significant imbalance was detected (${avgPercent.toFixed(0)}%). You might be favoring one side. This can lead to injury. Try squatting without weight to rebuild a stable foundation.`;
            }
            break;

        case 'valgus':
            const { count, totalReps } = values;
            if (count === 0) {
                description = `Perfect knee stability! Your knees tracked perfectly over your feet on all ${totalReps} reps. This is crucial for long-term joint health.`;
            } else if (count <= 2 && totalReps > 5) {
                description = `Good stability. Your knees caved in on ${count} rep${count > 1 ? 's' : ''}. This often happens with fatigue. Focus on actively pushing your knees outwards.`;
            } else {
                description = `Your knees caved inwards on ${count} of ${totalReps} reps. This is a common issue called "knee valgus" and increases injury risk. Strengthen your glutes and focus on pushing your knees out.`;
            }
            break;
            
        case 'consistency':
            const { stdDev } = values;
            if (performanceTier > 0.9) {
                description = `Incredibly consistent! Your depth varied by only ${stdDev.toFixed(1)}°. Every rep was a mirror of the last. This is professional-level form.`;
            } else if (performanceTier > 0.65) {
                description = `Good consistency. A small variation of ${stdDev.toFixed(1)}° was detected. Aim for each rep to feel and look identical for maximum efficiency and safety.`;
            } else {
                description = `Your form was inconsistent, with depth varying by ${stdDev.toFixed(1)}°. This often means you're losing focus or control under fatigue. Prioritize quality over quantity on every single rep.`;
            }
            break;
    }
    descEl.innerText = description;
}

/**
 * Analyzes the completed session, calculates scores, and populates the report view.
 */
function generateReport() {
    finalRepHistory = analyzeSession(recordedPoseLandmarks, recordedWorldLandmarks);
    if (finalRepHistory.length === 0) {
        alert("No valid squats were detected in the session. Please ensure your full body is visible and try again.");
        resetSession();
        return;
    }
    
    // Crop the data arrays to focus only on the detected squats for playback
    const firstSquatStartFrame = finalRepHistory[0].startFrame;
    const lastSquatEndFrame = finalRepHistory[finalRepHistory.length - 1].endFrame;
    const cropStartFrame = Math.max(0, firstSquatStartFrame - PLAYBACK_FPS);
    const cropEndFrame = Math.min(frameCounter, lastSquatEndFrame + PLAYBACK_FPS);

    playbackOffset = cropStartFrame;
    recordedWorldLandmarks = recordedWorldLandmarks.slice(cropStartFrame, cropEndFrame);
    recordedPoseLandmarks = recordedPoseLandmarks.slice(cropStartFrame, cropEndFrame);
    hipHeightData = hipHeightData.slice(cropStartFrame, cropEndFrame);
    symmetryData = symmetryData.slice(cropStartFrame, cropEndFrame);
    
    const weights = { depth: 30, symmetry: 30, valgus: 20, consistency: 20 };

    // --- 1. DEPTH SCORING (Optimized with non-linear curve and ATG bonus) ---
    const SQUAT_IDEAL_DEPTH = 90; // Parallel is the goal for a full score
    const SQUAT_ATG_DEPTH = 75;   // "Ass-to-grass" depth for bonus points
    const avgDepthAngle = finalRepHistory.reduce((sum, rep) => sum + rep.depth, 0) / finalRepHistory.length;

    const getDepthProgress = (angle) => {
        if (angle >= STANDING_THRESHOLD) return 0;
        if (angle <= SQUAT_IDEAL_DEPTH) return 1.0;
        const progress = (STANDING_THRESHOLD - angle) / (STANDING_THRESHOLD - SQUAT_IDEAL_DEPTH);
        // Apply an easing function (sine curve) to make progress feel more rewarding
        return Math.sin(progress * Math.PI / 2);
    };

    const baseProgress = getDepthProgress(avgDepthAngle);
    const atgBonus = avgDepthAngle < SQUAT_IDEAL_DEPTH 
        ? ((SQUAT_IDEAL_DEPTH - Math.max(SQUAT_ATG_DEPTH, avgDepthAngle)) / (SQUAT_IDEAL_DEPTH - SQUAT_ATG_DEPTH)) * 0.15 // Bonus up to 15%
        : 0;
    const depthScore = Math.min(1.0, baseProgress + atgBonus) * weights.depth;


    // --- 2. SYMMETRY SCORING (Original exponential model is effective) ---
    const avgSymmetryDiff = finalRepHistory.reduce((s, r) => s + r.symmetry, 0) / finalRepHistory.length;
    const avgSymmetryPercent = 100 * Math.exp(-0.07 * avgSymmetryDiff);
    const symmetryScore = (avgSymmetryPercent / 100) * weights.symmetry;


    // --- 3. VALGUS SCORING (Optimized to penalize per-rep events and severity) ---
    const VALGUS_THRESHOLD_METERS = 0.03; // 3cm deviation is a flag
    const SEVERE_VALGUS_METERS = 0.06;    // 6cm is a major issue
    let valgusScore = weights.valgus;
    let valgusCount = 0;

    finalRepHistory.forEach(rep => {
        const maxValgus = Math.max(rep.maxLeftValgus, rep.maxRightValgus);
        if (maxValgus > VALGUS_THRESHOLD_METERS) {
            valgusCount++;
            // Base penalty scales with set length to be fair
            let penalty = weights.valgus / Math.max(5, finalRepHistory.length);
            // Add a severity multiplier for significant knee cave
            if (maxValgus > SEVERE_VALGUS_METERS) {
                penalty *= 1.5;
            }
            valgusScore -= penalty;
        }
    });
    valgusScore = Math.max(0, valgusScore);


    // --- 4. CONSISTENCY SCORING (Optimized with stricter threshold and power curve) ---
    const depths = finalRepHistory.map(r => r.depth);
    const stdDev = depths.length > 1 ? Math.sqrt(depths.map(x => Math.pow(x - avgDepthAngle, 2)).reduce((a, b) => a + b) / (depths.length - 1)) : 0;
    const MAX_ACCEPTABLE_STD_DEV = 4; // Stricter than before
    // Use a power curve to penalize larger deviations more heavily
    const consistencyProgress = Math.max(0, 1 - Math.pow(stdDev / MAX_ACCEPTABLE_STD_DEV, 1.5));
    const consistencyScore = consistencyProgress * weights.consistency;
    
    
    // --- FINAL SCORE CALCULATION & UI UPDATE ---
    const totalScore = Math.round(depthScore + symmetryScore + valgusScore + consistencyScore);
    
    const scoreCircle = document.querySelector('.score-circle');
    const scoreValueEl = document.getElementById('report-score-value');
    setTimeout(() => scoreCircle.style.setProperty('--p', totalScore), 100);
    scoreValueEl.innerText = totalScore;
    
    document.getElementById('report-quality-overall').innerText = totalScore > 85 ? "Excellent" : totalScore > 65 ? "Good" : "Needs Improvement";
    document.getElementById('report-depth-avg').innerText = `${avgDepthAngle.toFixed(0)}°`;
    document.getElementById('report-symmetry-avg').innerText = `${avgSymmetryPercent.toFixed(0)}%`;
    document.getElementById('report-valgus-count').innerText = `${valgusCount} of ${finalRepHistory.length} reps`;

    updateBreakdown('depth', depthScore, weights.depth, { avgAngle: avgDepthAngle });
    updateBreakdown('symmetry', symmetryScore, weights.symmetry, { avgPercent: avgSymmetryPercent });
    updateBreakdown('valgus', valgusScore, weights.valgus, { count: valgusCount, totalReps: finalRepHistory.length });
    updateBreakdown('consistency', consistencyScore, weights.consistency, { stdDev: stdDev });
    
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