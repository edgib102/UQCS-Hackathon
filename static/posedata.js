// ---- Exported variables ----
export let latestPose = null;          // latest MediaPipe landmarks
export let leftKneeAngle = null;       // left knee angle in degrees
export let rightKneeAngle = null;      // right knee angle in degrees
export let squatDepthReached = false;  // true if bottom reached in current rep
export let repCount = 0;               // total reps completed
export let repState = 'STANDING';      // FSM: STANDING, DESCENDING, BOTTOM, ASCENDING

// ---- Thresholds (tweak for camera distance / user height) ----
const STANDING_THRESHOLD = 160;        // angle above which we consider user standing
const BOTTOM_THRESHOLD = 100;           // angle below which we consider squat bottom
const KNEE_VISIBILITY_THRESHOLD = 0.5; // minimum visibility to count knee

// ---- Main pose update function ----
export function updatePose(results) {
  if (!results.poseLandmarks) return;

  const landmarks = results.poseLandmarks;
  latestPose = landmarks;

  const leftKneeLandmark = landmarks[25];
  const rightKneeLandmark = landmarks[26];

  // Skip if either knee is not visible enough
  if (leftKneeLandmark.visibility < KNEE_VISIBILITY_THRESHOLD || 
      rightKneeLandmark.visibility < KNEE_VISIBILITY_THRESHOLD) {
    console.log('Knee(s) not visible, skipping rep detection');
    return;
  }

  // ----- Calculate knee angles -----
  leftKneeAngle = calculateAngle(landmarks[23], leftKneeLandmark, landmarks[27]);  // hip → knee → ankle
  rightKneeAngle = calculateAngle(landmarks[24], rightKneeLandmark, landmarks[28]);
  const minKnee = Math.min(leftKneeAngle, rightKneeAngle);  // use smaller knee angle for FSM

  // ----- Finite State Machine for squat -----
  switch (repState) {
    case 'STANDING':
      if (minKnee < STANDING_THRESHOLD) repState = 'DESCENDING';
      break;

    case 'DESCENDING':
      if (minKnee < BOTTOM_THRESHOLD) repState = 'BOTTOM';
      break;

    case 'BOTTOM':
      if (minKnee > BOTTOM_THRESHOLD) {
        repState = 'ASCENDING';
        squatDepthReached = true;  // bottom reached, now ascending
      }
      break;

    case 'ASCENDING':
      if (minKnee > STANDING_THRESHOLD) {
        repState = 'STANDING';
        repCount += 1;             // completed rep
        squatDepthReached = false; // reset for next rep
      }
      break;
  }

  // ----- Debug logs -----
  console.log(`State: ${repState}, Rep count: ${repCount}, Depth reached: ${squatDepthReached}`);
  console.log(`Left knee angle: ${leftKneeAngle.toFixed(1)}°, Right knee angle: ${rightKneeAngle.toFixed(1)}°`);
}

// ---- Helper function: calculate angle between three points ----
function calculateAngle(a, b, c) {
  const AB = { x: a.x - b.x, y: a.y - b.y };
  const CB = { x: c.x - b.x, y: c.y - b.y };

  const dot = AB.x * CB.x + AB.y * CB.y;
  const magAB = Math.sqrt(AB.x**2 + AB.y**2);
  const magCB = Math.sqrt(CB.x**2 + CB.y**2);

  const cosAngle = dot / (magAB * magCB);

  // Clamp to [-1,1] to prevent NaN due to floating point errors
  const clamped = Math.max(-1, Math.min(1, cosAngle));
  return Math.acos(clamped) * (180 / Math.PI);
}
