import { updatePose, repCount, squatDepthReached } from './posedata.js';  // import updater + state

window.onload = () => {
  getPose();
};

function getPose() {
  const videoElement = document.getElementById('webcam');
  const canvasElement = document.getElementById('output');
  const canvasCtx = canvasElement.getContext('2d');

  // Add status badges for rep count and depth
  const repBadge = document.createElement('div');
  repBadge.style.position = 'absolute';
  repBadge.style.top = '10px';
  repBadge.style.left = '10px';
  repBadge.style.backgroundColor = 'rgba(0,0,0,0.5)';
  repBadge.style.color = 'white';
  repBadge.style.padding = '5px 10px';
  repBadge.style.fontSize = '18px';
  repBadge.style.borderRadius = '5px';
  repBadge.innerText = `Reps: 0`;
  document.body.appendChild(repBadge);

  const depthBadge = document.createElement('div');
  depthBadge.style.position = 'absolute';
  depthBadge.style.top = '10px';
  depthBadge.style.right = '10px';
  depthBadge.style.backgroundColor = 'rgba(0,0,0,0.5)';
  depthBadge.style.color = 'white';
  depthBadge.style.padding = '5px 10px';
  depthBadge.style.fontSize = '18px';
  depthBadge.style.borderRadius = '5px';
  depthBadge.innerText = `Bottom reached: false`;
  document.body.appendChild(depthBadge);

  navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    .then((stream) => {
      videoElement.srcObject = stream;
    })
    .catch((err) => {
      console.error('Error accessing webcam:', err);
    });

  const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  pose.onResults(results => {
    updatePose(results);  // updates repCount, squatDepthReached, angles

    // Update badges
    repBadge.innerText = `Reps: ${repCount}`;
    depthBadge.innerText = `Bottom reached: ${squatDepthReached}`;

    // Draw video and skeleton
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    if (results.poseLandmarks) {
      drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
        { color: '#00FF00', lineWidth: 4 });
      drawLandmarks(canvasCtx, results.poseLandmarks,
        { color: '#FF0000', lineWidth: 1, radius: 1 });
    }
    canvasCtx.restore();
  });

  async function detectFrame() {
    await pose.send({ image: videoElement });
    requestAnimationFrame(detectFrame);
  }

  videoElement.onloadeddata = () => detectFrame();
}
