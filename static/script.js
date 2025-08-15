import { updatePose, repCount, squatDepthReached } from './posedata.js';  // import updater + state

window.onload = () => {
  getPose();
};

function getPose() {
  const videoElement = document.getElementById('webcam');
  const canvasElement = document.getElementById('output');
  const canvasCtx = canvasElement.getContext('2d');

  const repCounter = document.getElementById("rep-counter")
  const squatDepthCounter = document.getElementById("squat-depth")


  navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    .then((stream) => {
      videoElement.srcObject = stream;
    })
    .catch((err) => {
      console.error('Error accessing webcam:', err);
    });

  const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
  pose.setOptions({
  modelComplexity: 2, // 0, 1, 2
  smoothLandmarks: true,
  enableSegmentation: false,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
  });

  pose.onResults(results => {
    updatePose(results);  // updates repCount, squatDepthReached, angles

    // update counters
    repCounter.innerHTML = repCount
    squatDepthCounter.innerHTML = squatDepthReached


    // Draw video and skeleton
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    if (results.poseLandmarks) {
      // Filter connections to exclude any that involve head landmarks (0–10)
      const bodyConnections = POSE_CONNECTIONS.filter(
        ([startIdx, endIdx]) => startIdx > 10 && endIdx > 10
      );

      drawConnectors(canvasCtx, results.poseLandmarks, bodyConnections,
        { color: '#00FF00', lineWidth: 4 });

      // Draw only landmarks from 11 onwards (skip head)
      const bodyLandmarks = results.poseLandmarks.slice(11);
      drawLandmarks(canvasCtx, bodyLandmarks, 
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
