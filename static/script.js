import { drawConnectors, drawLandmarks, POSE_CONNECTIONS } from 'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js';
import { Pose } from 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js';


async function countCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(device => device.kind === 'videoinput');
  console.log(`Number of cameras connected: ${videoDevices.length}`);
  return videoDevices.length;
}

window.onload = async () => {
  const videos = await initCameras();

  const poseInstances = videos.map(() =>
    new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` })
  );

  poseInstances.forEach((pose, i) => {
    pose.setOptions({
      modelComplexity: 2,
      smoothLandmarks: true,
      minDetectionConfidence: 0.75,
      minTrackingConfidence: 0.75
    });
    pose.onResults(results => renderResults(results, `output${i + 1}`));

    // Start continuous frame sending
    detectFrame(videos[i], pose);
  });
};

async function initCameras() {
  // Request permission once
  await navigator.mediaDevices.getUserMedia({ video: true });

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(d =>
    d.kind === 'videoinput' &&
    !d.label.toLowerCase().includes('ir') // ignore infrared cams
  );

  if (videoDevices.length === 0) {
    throw new Error("No RGB cameras found");
  }

  const videoElements = [];

  // Webcam 1
  const video1 = document.getElementById('webcam1');
  video1.autoplay = true;
  video1.muted = true;
  video1.playsInline = true;
  video1.srcObject = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: videoDevices[0].deviceId } }
  });
  await video1.play();
  videoElements.push(video1);

  // Webcam 2 (optional)
  if (videoDevices.length > 1) {
    const video2 = document.getElementById('webcam2');
    video2.autoplay = true;
    video2.muted = true;
    video2.playsInline = true;
    video2.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: videoDevices[1].deviceId } }
    });
    await video2.play();
    videoElements.push(video2);
  }

  return videoElements;
}

function detectFrame(video, pose) {
  async function frame() {
    if (video.readyState >= 2) { // HAVE_CURRENT_DATA or better
      await pose.send({ image: video });
    }
    requestAnimationFrame(frame);
  }
  frame(); // Start immediately
}

function renderResults(results, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  canvas.width = results.image.width;
  canvas.height = results.image.height;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
    drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2, radius: 2 });
  }

  ctx.restore();
}
