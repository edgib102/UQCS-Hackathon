import { updatePose } from './posedata.js';  // import the updater


window.onload = () =>{

  getPose()
  updatePose()
}



  function getPose(){
    const videoElement = document.getElementById('webcam');
    const canvasElement = document.getElementById('output');
    
    const canvasCtx = canvasElement.getContext('2d');
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then((stream) => {
        // Set the video element source to the webcam stream
        videoElement.srcObject = stream;
      })
      .catch((err) => {
        console.error('Error accessing webcam:', err);
      });

    const pose = new Pose({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    pose.onResults(results => {
      updatePose(results)
      canvasCtx.save();
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
      if (results.poseLandmarks) {
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS,
          {color: '#00FF00', lineWidth: 4});
        drawLandmarks(canvasCtx, results.poseLandmarks,
          {color: '#FF0000', lineWidth: 1, radius: 1});
      }
      canvasCtx.restore();
    });

    async function detectFrame() {
      await pose.send({image: videoElement});
      requestAnimationFrame(detectFrame);
    }

    videoElement.onloadeddata = () => detectFrame();    
  }
