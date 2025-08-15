 window.onload = async () => {
      const [video1, video2] = await initCameras();

      const pose1 = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
      const pose2 = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });

      pose1.setOptions({ modelComplexity: 2, smoothLandmarks: true, minDetectionConfidence: 0.75, minTrackingConfidence: 0.75 });
      pose2.setOptions({ modelComplexity: 2, smoothLandmarks: true, minDetectionConfidence: 0.75, minTrackingConfidence: 0.75 });

      pose1.onResults(results => renderResults(aresults, 'output1'));
      pose2.onResults(results => renderResults(results, 'output2'));

      detectFrame(video1, pose1);
      detectFrame(video2, pose2);
    };

    async function initCameras() {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');

      const video1 = document.getElementById('webcam1');
      const video2 = document.getElementById('webcam2');

      video1.srcObject = await navigator.mediaDevices.getUserMedia({ video: { deviceId: videoDevices[0].deviceId } });
      video2.srcObject = await navigator.mediaDevices.getUserMedia({ video: { deviceId: videoDevices[1].deviceId } });

      return [video1, video2];
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
      const ctx = canvas.getContext('2d');

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      if (results.poseLandmarks) {
        drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
        drawLandmarks(ctx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2, radius: 2 });
      }

      ctx.restore();
    }