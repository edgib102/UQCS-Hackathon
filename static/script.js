import { init3DScene, update3DScene } from './pose3d.js';
import { updateRepCounter } from './posedata.js';

// --- DOM Elements ---
const video1 = document.getElementById('webcam1');
const video2 = document.getElementById('webcam2');
const canvas1 = document.getElementById('output1');
const canvas2 = document.getElementById('output2');

/**
 * Initializes and returns all available video camera elements.
 */
async function initCameras() {
    await navigator.mediaDevices.getUserMedia({ video: true }); // Request permission
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput' && !d.label.toLowerCase().includes('ir'));

    if (videoDevices.length === 0) {
        throw new Error("No RGB cameras found.");
    }

    const videoElements = [];

    // Setup Camera 1
    video1.srcObject = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: videoDevices[0].deviceId } }
    });
    videoElements.push(video1);

    // Setup Camera 2 if it exists
    if (videoDevices.length > 1) {
        video2.style.display = 'block';
        canvas2.style.display = 'block';
        video2.srcObject = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: videoDevices[1].deviceId } }
        });
        videoElements.push(video2);
    }

    return videoElements;
}

/**
 * Renders the pose detection results onto a 2D canvas.
 */
function render2DResults(results, canvas) {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

    if (results.poseLandmarks) {
        // Only draw body landmarks, excluding the head (landmarks 0-10)
        const bodyConnections = POSE_CONNECTIONS.filter(([start, end]) => start > 10 && end > 10);
        drawConnectors(ctx, results.poseLandmarks, bodyConnections, { color: '#00FF00', lineWidth: 4 });
        drawLandmarks(ctx, results.poseLandmarks.slice(11), { color: '#FF0000', radius: 2 });
    }
    ctx.restore();
}

/**
 * Creates a MediaPipe Pose instance and sets it to process a video stream.
 */
function setupPoseDetection(video, onResultsCallback) {
    const pose = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    pose.setOptions({
        modelComplexity: 1, // Using 1 for better performance, 2 is more accurate but slower
        smoothLandmarks: true,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7,
    });

    pose.onResults(onResultsCallback);

    video.onloadeddata = async () => {
        async function frame() {
            await pose.send({ image: video });
            requestAnimationFrame(frame);
        }
        frame();
    };
}


// --- Main Application Logic ---
window.onload = async () => {
    try {
        const videos = await initCameras();
        init3DScene();

        // Setup pose detection for each camera
        videos.forEach((video, index) => {
            const canvas = index === 0 ? canvas1 : canvas2;
            
            setupPoseDetection(video, (results) => {
                render2DResults(results, canvas);
                
                // Use the first camera's data for rep counting and 3D model
                if (index === 0 && results.poseLandmarks) {
                    updateRepCounter(results.poseLandmarks);
                    update3DScene(results.poseLandmarks);
                }
            });
        });

    } catch (error) {
        console.error("Failed to initialize application:", error);
        alert("Error: Could not access cameras. Please ensure you have a camera connected and have granted permission.");
    }
};