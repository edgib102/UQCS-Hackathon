// ---- Exported variables ----
export let latestPose = null;          // latest MediaPipe landmarks
export let leftKneeAngle = null;       // left knee angle in degrees
export let rightKneeAngle = null;      // right knee angle in degrees
export let squatDepthReached = false;  // true if bottom reached in current rep
export let repCount = 0;               // total reps completed
export let repState = 'STANDING';      // FSM: STANDING, DESCENDING, BOTTOM, ASCENDING
export let stance = 'UNKNOWN';         // FRONT or SIDE

// ---- Thresholds (tweak for camera distance / user height) ----
const STANDING_THRESHOLD = 160;        // angle above which we consider user standing
const BOTTOM_THRESHOLD = 100;          // angle below which we consider squat bottom
const KNEE_VISIBILITY_THRESHOLD = 0.2; // minimum visibility to count knee

// ---- Main pose update function ----
export function updatePose(results) {
  if (!results.poseLandmarks) return;

  const landmarks = results.poseLandmarks;
  latestPose = landmarks;

  const leftKneeLandmark = landmarks[25];
  const rightKneeLandmark = landmarks[26];

  const leftVisible = leftKneeLandmark.visibility >= KNEE_VISIBILITY_THRESHOLD;
  const rightVisible = rightKneeLandmark.visibility >= KNEE_VISIBILITY_THRESHOLD;

  // ---- Determine stance ----
  if (leftVisible && rightVisible) {
    stance = 'FRONT';
  } else if (leftVisible || rightVisible) {
    stance = 'SIDE';
  } else {
    stance = 'UNKNOWN';
    console.log('No knees visible, skipping rep detection');
    return;
  }

  // ---- Calculate knee angles (if visible) ----
  if (leftVisible) {
    leftKneeAngle = calculateAngle(landmarks[23], leftKneeLandmark, landmarks[27]);  // hip → knee → ankle
  } else {
    leftKneeAngle = null;
  }

  if (rightVisible) {
    rightKneeAngle = calculateAngle(landmarks[24], rightKneeLandmark, landmarks[28]);
  } else {
    rightKneeAngle = null;
  }

  // ---- Determine "effective knee angle(s)" for FSM ----
  let atStanding = false;
  let atBottom = false;

  if (stance === 'FRONT') {
    // Both knees must meet the condition
    atStanding = (leftKneeAngle > STANDING_THRESHOLD && rightKneeAngle > STANDING_THRESHOLD);
    atBottom   = (leftKneeAngle < BOTTOM_THRESHOLD  && rightKneeAngle < BOTTOM_THRESHOLD);
  } else if (stance === 'SIDE') {
    // Only the visible knee matters
    const visibleKneeAngle = leftKneeAngle ?? rightKneeAngle;
    atStanding = (visibleKneeAngle > STANDING_THRESHOLD);
    atBottom   = (visibleKneeAngle < BOTTOM_THRESHOLD);
  }

  // ---- Finite State Machine for squat ----
  switch (repState) {
    case 'STANDING':
      if (!atStanding) repState = 'DESCENDING';
      break;

    case 'DESCENDING':
      if (atBottom) repState = 'BOTTOM';
      break;

    case 'BOTTOM':
      if (!atBottom) {
        repState = 'ASCENDING';
        squatDepthReached = true;  // bottom reached, now ascending
      }
      break;

    case 'ASCENDING':
      if (atStanding) {
        repState = 'STANDING';
        if (squatDepthReached) {
          repCount += 1;           // completed rep
        }
        squatDepthReached = false; // reset for next rep
      }
      break;
  }

  // ---- Debug logs ----
  console.log(
    `Stance: ${stance}, State: ${repState}, Reps: ${repCount}, Depth: ${squatDepthReached}`
  );
  console.log(
    `Left knee: ${leftKneeAngle?.toFixed(1) ?? 'N/A'}°, Right knee: ${rightKneeAngle?.toFixed(1) ?? 'N/A'}°`
  );
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

export function getPoseStats() {
  return { repCount, squatDepthReached, stance };
}
