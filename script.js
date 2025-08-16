// script.js

import { 
    updatePose, 
    getPoseStats, 
    resetPoseStats,
    calculateAngle,
    getLandmarkProxy,
    SQUAT_THRESHOLD,
    KNEE_VISIBILITY_THRESHOLD,
    SYMMETRY_THRESHOLD
} from "./posedata.js";
import { createLiveScene, createPlaybackScene } from "./pose3d.js";
import { renderHipHeightChart } from "./chart.js";

// --- Configuration ---
const SQUAT_TARGET = 5;
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
const resetButton = document.getElementById('resetButton');
const downloadButton = document.getElementById('downloadButton');
const playButton = document.getElementById('playButton');
const videoUploadInput = document.getElementById('videoUpload');

// --- State Management ---
let mediaRecorder;
let recordedChunks = [];
let recordedLandmarks = [];
let recordedPoseLandmarks = [];
let hipHeightData = [];
let symmetryData = [];
let hipChartInstance;
let isSessionRunning = false;
let isProcessingUpload = false;
let liveScene, playbackScene;
let playbackAnimationId = null;
let isStoppingSession = false;
let sessionStopTimeoutId = null;
let playbackFrameCounter = 0;

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
    
    updatePose(results);
    const stats = getPoseStats();

    drawFrame(results, stats.kneeValgus);
    
    if (results.poseLandmarks) {
        if (results.poseWorldLandmarks) {
            liveScene.update(results.poseWorldLandmarks);
            recordedLandmarks.push(JSON.parse(JSON.stringify(results.poseWorldLandmarks)));
            recordedPoseLandmarks.push(JSON.parse(JSON.stringify(results.poseLandmarks)));

            const leftHip = results.poseLandmarks[23];
            const rightHip = results.poseLandmarks[24];
            if (leftHip.visibility > 0.5 && rightHip.visibility > 0.5) {
                hipHeightData.push((leftHip.y + rightHip.y) / 2);
            } else {
                hipHeightData.push(null);
            }

            const { left, right } = getLandmarkProxy(results.poseLandmarks);
            if (left.knee.visibility > KNEE_VISIBILITY_THRESHOLD && right.knee.visibility > KNEE_VISIBILITY_THRESHOLD) {
                const leftKneeAngle = calculateAngle(left.hip, left.knee, left.ankle);
                const rightKneeAngle = calculateAngle(right.hip, right.knee, right.ankle);
                const symmetryDiff = Math.abs(leftKneeAngle - rightKneeAngle);
                const symmetryPercentage = Math.max(0, 100 - (symmetryDiff / SYMMETRY_THRESHOLD) * 100);
                symmetryData.push(symmetryPercentage);
            } else {
                symmetryData.push(null);
            }
        }

        document.getElementById('rep-counter').innerText = stats.repCount;
        document.getElementById('rep-quality').innerText = stats.repQuality;
        document.getElementById('depth').innerText = stats.depth ? `${stats.depth.toFixed(0)}°` : 'N/A';
        document.getElementById('symmetry').innerText = stats.symmetry ? `${stats.symmetry.toFixed(0)}°` : 'N/A';
        
        if (stats.repCount >= SQUAT_TARGET && !isStoppingSession) {
            isStoppingSession = true;
            sessionStopTimeoutId = setTimeout(() => {
                stopSession();
            }, 1000); 
        }
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
        const legConnections = new Set([[23, 25], [25, 27], [24, 26], [26, 28]].map(c => JSON.stringify(c.sort((a,b) => a-b))));
        
        const otherBodyConnections = POSE_CONNECTIONS.filter(conn => {
            return conn[0] > 10 && conn[1] > 10 && !legConnections.has(JSON.stringify(conn.sort((a,b) => a-b)));
        });
        const legConnectionArray = Array.from(legConnections).map(JSON.parse);

        const legColor = kneeValgus ? '#FF4136' : '#DDDDDD';

        drawConnectors(canvasCtx, results.poseLandmarks, otherBodyConnections, { color: '#DDDDDD', lineWidth: 4 });
        drawConnectors(canvasCtx, results.poseLandmarks, legConnectionArray, { color: legColor, lineWidth: 6 });

        const bodyLandmarks = results.poseLandmarks.slice(11);
        drawLandmarks(canvasCtx, bodyLandmarks, { color: '#00CFFF', lineWidth: 2 });
    }
    
    canvasCtx.restore();
}

// --- Session & Playback Control ---
async function startSession() {
    if (!liveScene) liveScene = createLiveScene(document.getElementById('pose3dCanvas'));
    if (!canvasCtx) canvasCtx = outputCanvas.getContext('2d');
    
    isStoppingSession = false;
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
    videoElement.controls = true;
    videoElement.muted = false;
    videoElement.src = URL.createObjectURL(file);
    videoElement.load();
    videoElement.onloadeddata = () => {
        loadingElement.style.display = 'none';
        processVideoFrames();
    };
}

async function processVideoFrames() {
    if (!isProcessingUpload) return;
    
    if (videoElement.paused || videoElement.ended) {
        stopSession();
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
    playbackFrameCounter = 0;

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
        if (reportView.style.display === 'none') {
            playButton.disabled = false;
            playButton.innerText = "Play 3D Reps";
            return; 
        }

        playbackFrameCounter++;
        if (playbackFrameCounter % 2 !== 0) {
            playbackAnimationId = requestAnimationFrame(animate);
            return;
        }

        if (frame >= recordedLandmarks.length) {
            playButton.disabled = false;
            playButton.innerText = "Replay";
            return;
        }

        const currentLandmarks = recordedPoseLandmarks[frame];
        
        let hasKneeValgus = false;
        if (currentLandmarks) {
            const { left, right } = getLandmarkProxy(currentLandmarks);
            const VALGUS_THRESHOLD = 0.02;
            const leftValgus = left.knee.x < left.ankle.x - VALGUS_THRESHOLD;
            const rightValgus = right.knee.x > right.ankle.x + VALGUS_THRESHOLD;
            hasKneeValgus = leftValgus || rightValgus;
        }
        
        playbackScene.update(recordedLandmarks[frame]);
        playbackScene.updateColors(hasKneeValgus);

        if (hipChartInstance) {
            hipChartInstance.data.labels.push(frame);
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
    if (sessionStopTimeoutId) clearTimeout(sessionStopTimeoutId);
    
    isStoppingSession = false;
    resetPoseStats();

    recordedLandmarks = [];
    recordedPoseLandmarks = [];
    hipHeightData = [];
    symmetryData = [];

    if (hipChartInstance) {
        hipChartInstance.destroy();
        hipChartInstance = null;
    }
    
    // Reset score UI
    const scoreCircle = document.querySelector('.score-circle');
    if (scoreCircle) scoreCircle.style.setProperty('--p', 0);
    document.getElementById('report-score-value').innerText = '0';
    document.getElementById('breakdown-score-depth').innerText = '0/30';
    document.getElementById('breakdown-desc-depth').innerText = '';
    document.getElementById('breakdown-score-symmetry').innerText = '0/30';
    document.getElementById('breakdown-desc-symmetry').innerText = '';
    document.getElementById('breakdown-score-valgus').innerText = '0/20';
    document.getElementById('breakdown-desc-valgus').innerText = '';
    document.getElementById('breakdown-score-consistency').innerText = '0/20';
    document.getElementById('breakdown-desc-consistency').innerText = '';

    playButton.disabled = false;
    playButton.innerText = "Play 3D Reps";

    document.getElementById('rep-counter').innerText = '0';
    document.getElementById('rep-quality').innerText = 'N/A';
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
            if (score > weight * 0.85) {
                description = `Excellent depth! Your average angle of ${value.toFixed(0)}° shows great range of motion. Keep it up.`;
            } else if (score > weight * 0.6) {
                description = `Good depth. You're reaching an average of ${value.toFixed(0)}°. How to improve: Try to go a little lower to fully engage your muscles.`;
            } else {
                description = `Your depth of ${value.toFixed(0)}° is shallow. How to improve: Focus on lowering your hips until they are parallel with your knees.`;
            }
            break;
        case 'symmetry':
            if (score > weight * 0.85) {
                description = `Great balance, with an average symmetry of ${value.toFixed(0)}%. Your weight seems evenly distributed.`;
            } else if (score > weight * 0.6) {
                description = `Good symmetry (${value.toFixed(0)}%). How to improve: There's a slight imbalance. Focus on keeping pressure even across both feet.`;
            } else {
                description = `There's a noticeable imbalance (${value.toFixed(0)}%). How to improve: You may be favoring one side. Try to push the ground away evenly with both legs.`;
            }
            break;
        case 'valgus':
            if (value === 0) {
                description = `Perfect! Your knees remained stable and did not cave inwards on any rep.`;
            } else if (value <= 2) {
                description = `Good stability, but your knees caved in on ${value} rep(s). How to improve: Focus on actively pushing your knees outwards as you stand up.`;
            } else {
                description = `Your knees caved in on ${value} reps, increasing injury risk. How to improve: Actively push your knees out, especially when tired. Consider using a resistance band around your knees.`;
            }
            break;
        case 'consistency':
             if (score > weight * 0.85) {
                description = `Excellent consistency. You maintained solid form across all repetitions.`;
            } else if (score > weight * 0.6) {
                description = `Good job. There were some minor variations in your form. How to improve: Aim for every rep to look and feel exactly the same.`;
            } else {
                description = `Your form was inconsistent. This can happen when fatigue sets in. How to improve: Focus on controlling the movement, not just completing the reps.`;
            }
            break;
    }
    descEl.innerText = description;
}

function generateReport() {
    const { repHistory } = getPoseStats();
    if (repHistory.length === 0) return;

    // Trim video/data to start just before the first squat
    let firstSquatStartFrame = recordedPoseLandmarks.findIndex(landmarks => {
        if (!landmarks) return false;
        const { left, right } = getLandmarkProxy(landmarks);
        return calculateAngle(left.hip, left.knee, left.ankle) < SQUAT_THRESHOLD &&
               calculateAngle(right.hip, right.knee, right.ankle) < SQUAT_THRESHOLD;
    });
    if (firstSquatStartFrame === -1) firstSquatStartFrame = 0;

    const playbackStartFrame = Math.max(0, firstSquatStartFrame - PLAYBACK_FPS);
    if (playbackStartFrame > 0) {
        recordedLandmarks = recordedLandmarks.slice(playbackStartFrame);
        recordedPoseLandmarks = recordedPoseLandmarks.slice(playbackStartFrame);
        hipHeightData = hipHeightData.slice(playbackStartFrame);
        symmetryData = symmetryData.slice(playbackStartFrame);
    }

    // --- SCORE CALCULATION ---
    const weights = { depth: 30, symmetry: 30, valgus: 20, consistency: 20 };
    const SQUAT_IDEAL_DEPTH = 90; // Ideal depth in degrees

    // 1. Depth Score
    const avgDepthAngle = repHistory.reduce((s, r) => s + r.depth, 0) / repHistory.length;
    const depthProgress = (SQUAT_THRESHOLD - avgDepthAngle) / (SQUAT_THRESHOLD - SQUAT_IDEAL_DEPTH);
    const depthScore = Math.max(0, Math.min(1, depthProgress)) * weights.depth;

    // 2. Symmetry Score
    const validSymmetryData = symmetryData.filter(s => s !== null && s !== undefined);
    const avgSymmetryPercent = validSymmetryData.length > 0 ? validSymmetryData.reduce((s, v) => s + v, 0) / validSymmetryData.length : 0;
    const symmetryScore = (avgSymmetryPercent / 100) * weights.symmetry;

    // 3. Knee Valgus Score
    const valgusCount = repHistory.filter(r => r.kneeValgus).length;
    const valgusPenalty = (valgusCount / SQUAT_TARGET) * weights.valgus;
    const valgusScore = Math.max(0, weights.valgus - valgusPenalty);

    // 4. Consistency Score
    const qualityScores = { "GOOD": 3, "OK": 2, "BAD": 1 };
    const avgQuality = repHistory.reduce((s, r) => s + qualityScores[r.quality], 0) / repHistory.length;
    const consistencyScore = (avgQuality / 3) * weights.consistency;
    
    // Total Score
    const totalScore = Math.round(depthScore + symmetryScore + valgusScore + consistencyScore);

    // --- UPDATE UI ---
    const scoreCircle = document.querySelector('.score-circle');
    const scoreValueEl = document.getElementById('report-score-value');
    setTimeout(() => { // Timeout allows the animation to be seen
        scoreCircle.style.setProperty('--p', totalScore);
    }, 100);
    scoreValueEl.innerText = totalScore;
    
    document.getElementById('report-quality-overall').innerText = totalScore > 85 ? "Excellent" : totalScore > 65 ? "Good" : "Needs Work";
    document.getElementById('report-depth-avg').innerText = `${avgDepthAngle.toFixed(0)}°`;
    document.getElementById('report-symmetry-avg').innerText = `${avgSymmetryPercent.toFixed(0)}%`;
    document.getElementById('report-valgus-count').innerText = `${valgusCount} of ${SQUAT_TARGET} reps`;

    updateBreakdown('depth', depthScore, weights.depth, avgDepthAngle);
    updateBreakdown('symmetry', symmetryScore, weights.symmetry, avgSymmetryPercent);
    updateBreakdown('valgus', valgusScore, weights.valgus, valgusCount);
    updateBreakdown('consistency', consistencyScore, weights.consistency, avgQuality);
    
    // --- Chart ---
    const hipHeightChartCanvas = document.getElementById('hipHeightChart');
    if (hipChartInstance) hipChartInstance.destroy();
    hipChartInstance = renderHipHeightChart(hipHeightChartCanvas, [], []);
}

// --- Event Listeners ---
startButton.addEventListener('click', startSession);
resetButton.addEventListener('click', resetSession);
playButton.addEventListener('click', startPlayback);
videoUploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) startUploadSession(file);
});