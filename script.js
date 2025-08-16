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
let playbackFrameCounter = 0; // New counter for playback speed

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
        const legConnections = new Set([[23, 25], [25, 27], [24, 26], [26, 28]].map(JSON.stringify));
        
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
    if (!liveScene) {
        liveScene = createLiveScene(document.getElementById('pose3dCanvas'));
    }
    if (!canvasCtx) {
        canvasCtx = outputCanvas.getContext('2d');
    }
    
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
    if (!liveScene) {
        liveScene = createLiveScene(document.getElementById('pose3dCanvas'));
    }
    if (!canvasCtx) {
        canvasCtx = outputCanvas.getContext('2d');
    }

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
    
    if (!isProcessingUpload && mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
    }
    if (!isProcessingUpload) {
        camera.stop();
    }
    
    videoElement.style.display = 'none';
    sessionView.style.display = 'none';
    reportView.style.display = 'block';
    
    generateReport();
    
    if (!playbackScene) {
        playbackScene = createPlaybackScene(playbackCanvas);
    }
}

function startPlayback() {
    if (playbackAnimationId) {
        cancelAnimationFrame(playbackAnimationId);
    }
    playbackFrameCounter = 0; // Reset the new counter

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

        // Only update on every 2nd frame to slow down playback
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
    
    if (playbackAnimationId) {
        cancelAnimationFrame(playbackAnimationId);
        playbackAnimationId = null;
    }
    
    if (sessionStopTimeoutId) {
        clearTimeout(sessionStopTimeoutId);
        sessionStopTimeoutId = null;
    }
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

    let firstSquatStartFrame = 0;
    for (let i = 0; i < recordedPoseLandmarks.length; i++) {
        const landmarks = recordedPoseLandmarks[i];
        if (!landmarks) continue;
        const { left, right } = getLandmarkProxy(landmarks);
        if (left.knee.visibility > KNEE_VISIBILITY_THRESHOLD && right.knee.visibility > KNEE_VISIBILITY_THRESHOLD) {
            const leftKneeAngle = calculateAngle(left.hip, left.knee, left.ankle);
            const rightKneeAngle = calculateAngle(right.hip, right.knee, right.ankle);
            if (leftKneeAngle < SQUAT_THRESHOLD && rightKneeAngle < SQUAT_THRESHOLD) {
                firstSquatStartFrame = i;
                break;
            }
        }
    }
    const playbackStartFrame = Math.max(0, firstSquatStartFrame - PLAYBACK_FPS);
    if (playbackStartFrame > 0) {
        recordedLandmarks = recordedLandmarks.slice(playbackStartFrame);
        recordedPoseLandmarks = recordedPoseLandmarks.slice(playbackStartFrame);
        hipHeightData = hipHeightData.slice(playbackStartFrame);
        symmetryData = symmetryData.slice(playbackStartFrame);
    }

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
    
    const firstValidHipHeight = hipHeightData.find(h => h !== null);
    if (firstValidHipHeight !== undefined) {
        const firstValidIndex = hipHeightData.indexOf(firstValidHipHeight);
        for (let i = 0; i < firstValidIndex; i++) hipHeightData[i] = firstValidHipHeight;
    }
    const firstValidSymmetry = symmetryData.find(s => s !== null);
    if (firstValidSymmetry !== undefined) {
        const firstValidIndex = symmetryData.indexOf(firstValidSymmetry);
        for (let i = 0; i < firstValidIndex; i++) symmetryData[i] = firstValidSymmetry;
    }

    if (hipChartInstance) {
        hipChartInstance.destroy();
    }
    
    const hipHeightChartCanvas = document.getElementById('hipHeightChart');
    hipChartInstance = renderHipHeightChart(hipHeightChartCanvas, [], []);
}

// --- Event Listeners ---
startButton.addEventListener('click', startSession);
resetButton.addEventListener('click', resetSession);
playButton.addEventListener('click', startPlayback);
videoUploadInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        startUploadSession(file);
    }
});