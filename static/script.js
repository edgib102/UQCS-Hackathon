import { updatePose, repCount, squatDepthReached } from './posedata.js';  // import updater + state

window.onload = () => {
  getPose();
};

// Kalman Filter for a single landmark point (x, y, z coordinates)
class KalmanFilter {
  constructor() {
    // State vector: [x, y, z, vx, vy, vz] - position and velocity
    this.state = new Array(6).fill(0);
    
    // State covariance matrix (6x6)
    this.P = this.createIdentityMatrix(6);
    this.scaleMatrix(this.P, 1000); // Initial uncertainty
    
    // Process noise covariance (6x6)
    this.Q = this.createIdentityMatrix(6);
    this.scaleMatrix(this.Q, 0.01); // Process noise
    
    // Measurement noise covariance (3x3) - we only measure position
    this.R = this.createIdentityMatrix(3);
    this.scaleMatrix(this.R, 0.1); // Measurement noise
    
    // State transition matrix (6x6) - constant velocity model
    this.F = [
      [1, 0, 0, 1, 0, 0],  // x = x + vx
      [0, 1, 0, 0, 1, 0],  // y = y + vy
      [0, 0, 1, 0, 0, 1],  // z = z + vz
      [0, 0, 0, 1, 0, 0],  // vx = vx
      [0, 0, 0, 0, 1, 0],  // vy = vy
      [0, 0, 0, 0, 0, 1]   // vz = vz
    ];
    
    // Measurement matrix (3x6) - we observe position only
    this.H = [
      [1, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0]
    ];
    
    this.initialized = false;
  }
  
  createIdentityMatrix(size) {
    const matrix = [];
    for (let i = 0; i < size; i++) {
      matrix[i] = [];
      for (let j = 0; j < size; j++) {
        matrix[i][j] = i === j ? 1 : 0;
      }
    }
    return matrix;
  }
  
  scaleMatrix(matrix, scale) {
    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix[i].length; j++) {
        matrix[i][j] *= scale;
      }
    }
  }
  
  matrixMultiply(A, B) {
    const rows = A.length;
    const cols = B[0].length;
    const common = B.length;
    
    const result = [];
    for (let i = 0; i < rows; i++) {
      result[i] = [];
      for (let j = 0; j < cols; j++) {
        result[i][j] = 0;
        for (let k = 0; k < common; k++) {
          result[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    return result;
  }
  
  matrixAdd(A, B) {
    const result = [];
    for (let i = 0; i < A.length; i++) {
      result[i] = [];
      for (let j = 0; j < A[i].length; j++) {
        result[i][j] = A[i][j] + B[i][j];
      }
    }
    return result;
  }
  
  matrixSubtract(A, B) {
    const result = [];
    for (let i = 0; i < A.length; i++) {
      result[i] = [];
      for (let j = 0; j < A[i].length; j++) {
        result[i][j] = A[i][j] - B[i][j];
      }
    }
    return result;
  }
  
  transpose(matrix) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const result = [];
    
    for (let j = 0; j < cols; j++) {
      result[j] = [];
      for (let i = 0; i < rows; i++) {
        result[j][i] = matrix[i][j];
      }
    }
    return result;
  }
  
  matrixInverse3x3(matrix) {
    // Simple 3x3 matrix inversion
    const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
    
    const det = a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g);
    
    if (Math.abs(det) < 1e-10) {
      // Return identity if determinant is too small
      return this.createIdentityMatrix(3);
    }
    
    return [
      [(e*i - f*h)/det, (c*h - b*i)/det, (b*f - c*e)/det],
      [(f*g - d*i)/det, (a*i - c*g)/det, (c*d - a*f)/det],
      [(d*h - e*g)/det, (b*g - a*h)/det, (a*e - b*d)/det]
    ];
  }
  
  predict() {
    // Predict state: x = F * x
    const newState = this.matrixMultiply(this.F, this.state.map(x => [x]));
    this.state = newState.map(row => row[0]);
    
    // Predict covariance: P = F * P * F' + Q
    const FT = this.transpose(this.F);
    const FP = this.matrixMultiply(this.F, this.P);
    const FPFT = this.matrixMultiply(FP, FT);
    this.P = this.matrixAdd(FPFT, this.Q);
  }
  
  update(measurement) {
    // measurement is [x, y, z]
    if (!this.initialized) {
      // Initialize state with first measurement
      this.state[0] = measurement[0];
      this.state[1] = measurement[1];
      this.state[2] = measurement[2];
      // velocities remain 0
      this.initialized = true;
      return { x: measurement[0], y: measurement[1], z: measurement[2] };
    }
    
    // Prediction step
    this.predict();
    
    // Update step
    // Innovation: y = z - H * x
    const Hx = this.matrixMultiply(this.H, this.state.map(x => [x]));
    const innovation = [
      measurement[0] - Hx[0][0],
      measurement[1] - Hx[1][0],
      measurement[2] - Hx[2][0]
    ];
    
    // Innovation covariance: S = H * P * H' + R
    const HT = this.transpose(this.H);
    const HP = this.matrixMultiply(this.H, this.P);
    const HPHT = this.matrixMultiply(HP, HT);
    const S = this.matrixAdd(HPHT, this.R);
    
    // Kalman gain: K = P * H' * S^-1
    const PHT = this.matrixMultiply(this.P, HT);
    const S_inv = this.matrixInverse3x3(S);
    const K = this.matrixMultiply(PHT, S_inv);
    
    // Update state: x = x + K * y
    const Ky = this.matrixMultiply(K, innovation.map(x => [x]));
    for (let i = 0; i < 6; i++) {
      this.state[i] += Ky[i][0];
    }
    
    // Update covariance: P = (I - K * H) * P
    const KH = this.matrixMultiply(K, this.H);
    const I_KH = this.matrixSubtract(this.createIdentityMatrix(6), KH);
    this.P = this.matrixMultiply(I_KH, this.P);
    
    return {
      x: this.state[0],
      y: this.state[1],
      z: this.state[2]
    };
  }
}

function getPose() {
  const videoElement = document.getElementById('webcam');
  const canvasElement = document.getElementById('output');
  const canvasCtx = canvasElement.getContext('2d');

  const repCounter = document.getElementById("rep-counter");
  const squatDepthCounter = document.getElementById("squat-depth");

  navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    .then((stream) => {
      videoElement.srcObject = stream;
    })
    .catch((err) => {
      console.error('Error accessing webcam:', err);
    });

  const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
  pose.setOptions({
    modelComplexity: 2,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7
  });

  // --- Kalman filter setup ---
  let kalmanFilters = []; // One filter per landmark
  const numLandmarks = 33; // MediaPipe pose has 33 landmarks
  
  // Initialize Kalman filters for each landmark
  for (let i = 0; i < numLandmarks; i++) {
    kalmanFilters[i] = new KalmanFilter();
  }

  function filterLandmarks(currentLandmarks) {
    if (!currentLandmarks) return null;

    const filteredLandmarks = [];
    
    for (let i = 0; i < currentLandmarks.length; i++) {
      const landmark = currentLandmarks[i];
      
      // Apply Kalman filter to this landmark
      const filtered = kalmanFilters[i].update([landmark.x, landmark.y, landmark.z]);
      
      filteredLandmarks[i] = {
        x: filtered.x,
        y: filtered.y,
        z: filtered.z,
        visibility: landmark.visibility // Keep original visibility
      };
    }
    
    return filteredLandmarks;
  }

  // --- Pose processing ---
  pose.onResults(results => {
    // Apply Kalman filter to landmarks
    const filteredLandmarks = filterLandmarks(results.poseLandmarks);
    
    // Update pose with filtered landmarks
    updatePose({ ...results, poseLandmarks: filteredLandmarks });

    // Update counters
    repCounter.innerHTML = repCount;
    squatDepthCounter.innerHTML = squatDepthReached;

    // Draw video and skeleton
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (filteredLandmarks) {
      const bodyConnections = POSE_CONNECTIONS.filter(
        ([startIdx, endIdx]) => startIdx > 10 && endIdx > 10
      );

      drawConnectors(canvasCtx, filteredLandmarks, bodyConnections,
        { color: '#00FF00', lineWidth: 4 });

      // Draw only landmarks from 11 onwards (skip head)
      const bodyLandmarks = filteredLandmarks.slice(11);
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