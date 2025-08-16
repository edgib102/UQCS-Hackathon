import { 
    updatePose, 
    getPoseStats, 
    resetPoseStats,
    calculateAngle,
    getLandmarkProxy,
    SQUAT_THRESHOLD,
    KNEE_VISIBILITY_THRESHOLD
} from "./posedata.js";
import { createLiveScene, createPlaybackScene } from "./pose3d.js";
import { renderHipHeightChart } from "./chart.js";

// --- Configuration ---
const SQUAT_TARGET = 5;
const PLAYBACK_FPS = 30; // For calculating the 1-second offset

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
const videoUploadInput = document.getElementById('videoUpload'); // New Line

// --- State Management ---
let mediaRecorder;
let recordedChunks = [];
let recordedLandmarks = [];
let recordedPoseLandmarks = [];
let hipHeightData = [];
let hipChartInstance;
let isSessionRunning = false;
let isProcessingUpload = false; // New Line
let liveScene, playbackScene;
let playbackAnimationId = null;

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
        if (isProcessingUpload) {
            videoElement.play();
        }
    }
    
    // --- 2. Draw the Video Frame and Skeleton ---
    drawFrame(results);
    
    // --- 3. Process Pose Data (if available) ---
    if (results.poseLandmarks) {
        // We only record a frame if we have the 3D data for playback.
        if (results.poseWorldLandmarks) {
            // Update the live 3D scene
            liveScene.update(results.poseWorldLandmarks);
            
            // Record data needed for playback and analysis
            recordedLandmarks.push(JSON.parse(JSON.stringify(results.poseWorldLandmarks)));
            recordedPoseLandmarks.push(JSON.parse(JSON.stringify(results.poseLandmarks)));

            // Now, determine the corresponding hip height for this exact recorded frame.
            const leftHip = results.poseLandmarks[23];
            const rightHip = results.poseLandmarks[24];
            if (leftHip.visibility > 0.5 && rightHip.visibility > 0.5) {
                const avgHipY = (leftHip.y + rightHip.y) / 2;
                hipHeightData.push(avgHipY);
            } else {
                hipHeightData.push(null);
            }
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
    isProcessingUpload = false; // New Line
    startView.style.display = 'none';
    reportView.style.display = 'none';
    sessionView.style.display = 'block';
    loadingElement.style.display = 'flex';
    downloadButton.style.display = 'inline-block'; // New Line

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

// New function for file upload
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
    downloadButton.style.display = 'none'; // New Line

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

// New function to process frames from a video element
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
    
    // Initialize the playback scene once the report is shown
    if (!playbackScene) {
        playbackScene = createPlaybackScene(playbackCanvas);
    }
}

function startPlayback() {
    if (playbackAnimationId) {
        cancelAnimationFrame(playbackAnimationId);
    }

    let frame = 0;
    playButton.disabled = true;
    playButton.innerText = "Playing...";

    // Clear the chart's data for a clean start
    if (hipChartInstance) {
        hipChartInstance.data.labels = [];
        hipChartInstance.data.datasets[0].data = [];
        hipChartInstance.update('none');
    }

    const animate = () => {
        // If the user navigates away, stop the animation.
        if (reportView.style.display === 'none') {
            playButton.disabled = false;
            playButton.innerText = "Play 3D Reps";
            return; 
        }

        if (frame >= recordedLandmarks.length) {
            playButton.disabled = false;
            playButton.innerText = "Replay";
            return; // End animation
        }

        // 1. Update the 3D skeleton
        playbackScene.update(recordedLandmarks[frame]);
        
        // 2. Add data to the chart to "draw" the line
        if (hipChartInstance && frame < hipHeightData.length) {
            hipChartInstance.data.labels.push(frame);
            hipChartInstance.data.datasets[0].data.push(hipHeightData[frame]);
            // Redraw the chart with the new point, without animating the chart itself
            hipChartInstance.update('none'); 
        }

        frame++;
        playbackAnimationId = requestAnimationFrame(animate);
    };

    animate();
}


function resetSession() {
    // Hide the report and show the start screen
    reportView.style.display = 'none';
    startView.style.display = 'block';
    
    if (playbackAnimationId) {
        cancelAnimationFrame(playbackAnimationId);
        playbackAnimationId = null;
    }
    
    resetPoseStats();

    // Clear recorded data for the next session
    recordedLandmarks = [];
    recordedPoseLandmarks = [];
    hipHeightData = [];

    // Destroy the old chart instance to prevent memory leaks
    if (hipChartInstance) {
        hipChartInstance.destroy();
        hipChartInstance = null;
    }
    
    // Re-enable the playback button for the next report
    playButton.disabled = false;
    playButton.innerText = "Play 3D Reps";

    // Reset UI text
    document.getElementById('rep-counter').innerText = '0';
    document.getElementById('rep-quality').innerText = 'N/A';
    document.getElementById('depth').innerText = 'N/A';
    document.getElementById('symmetry').innerText = 'N/A';
}

function generateReport() {
    const { repHistory } = getPoseStats();
    if (repHistory.length === 0) return;

    // --- 💡 ADD THIS BLOCK: CROP PLAYBACK ---
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
                break; // Found the first frame, exit loop
            }
        }
    }

    // Calculate the new starting point (1 second before the squat)
    const playbackStartFrame = Math.max(0, firstSquatStartFrame - PLAYBACK_FPS);

    // If we have a new start time, slice all the data arrays
    if (playbackStartFrame > 0) {
        recordedLandmarks = recordedLandmarks.slice(playbackStartFrame);
        recordedPoseLandmarks = recordedPoseLandmarks.slice(playbackStartFrame);
        hipHeightData = hipHeightData.slice(playbackStartFrame);
    }
    // --- END BLOCK ---


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
    
    // Clean up the (now cropped) data for better visualization
    const firstValidHipHeight = hipHeightData.find(h => h !== null);
    if (firstValidHipHeight !== undefined) {
        const firstValidIndex = hipHeightData.indexOf(firstValidHipHeight);
        for (let i = 0; i < firstValidIndex; i++) {
            hipHeightData[i] = firstValidHipHeight;
        }
    }

    // Render the Hip Height Chart with an empty dataset to start
    const hipHeightChartCanvas = document.getElementById('hipHeightChart');
    hipChartInstance = renderHipHeightChart(hipHeightChartCanvas, []);
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