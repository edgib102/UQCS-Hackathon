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
    detectFrame(videos[i], pose);
  });
};

async function initCameras() {
  // Request permission once
  await navigator.mediaDevices.getUserMedia({ video: true });

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(d =>
    d.kind === 'videoinput' &&
    !d.label.toLowerCase().includes('ir')
  );

  if (videoDevices.length === 0) {
    throw new Error("No RGB cameras found");
  }

  const videoElements = [];

  // Webcam 1
  const video1 = document.getElementById('webcam1');
  video1.srcObject = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: videoDevices[0].deviceId } }
  });
  videoElements.push(video1);

  // Webcam 2 (optional)
  if (videoDevices.length > 1) {
    const video2 = document.getElementById('webcam2');
    video2.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: videoDevices[1].deviceId } }
    });
    videoElements.push(video2);
  }

  return videoElements;
}

function detectFrame(video, pose) {
  async function frame() {
    await pose.send({ image: video });
    requestAnimationFrame(frame);
  }
  video.onloadeddata = frame;
}

function renderResults(results, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.poseLandmarks) {
    // Filter connections to remove any that involve head landmarks (0–10)
    const bodyConnections = POSE_CONNECTIONS.filter(
      ([startIdx, endIdx]) => startIdx > 10 && endIdx > 10
    );

    // Draw body lines only
    drawConnectors(ctx, results.poseLandmarks, bodyConnections, { color: '#00FF00', lineWidth: 4 });

    // Draw landmarks excluding head
    const bodyLandmarks = results.poseLandmarks.filter((_, idx) => idx > 10);
    drawLandmarks(ctx, bodyLandmarks, { color: '#FF0000', lineWidth: 2, radius: 2 });
  }

  ctx.restore();
}
