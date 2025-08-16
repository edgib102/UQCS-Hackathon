// ---- Exported variables ----
export let latestPose = null;            // latest MediaPipe landmarks
export let leftKneeAngle = null;         // left knee angle in degrees
export let rightKneeAngle = null;        // right knee angle in degrees
export let squatDepthReached = false;    // true if bottom reached in current rep
export let repCount = 0;                 // total reps completed
export let repState = 'STANDING';        // FSM: STANDING, DESCENDING, BOTTOM, ASCENDING
export let stance = 'UNKNOWN';           // FRONT or SIDE
export let repStartTime = null;        // timestamp when rep started
export let eccentricTime = 0;          // time descending (seconds)
export let concentricTime = 0;         // time ascending (seconds)
export let repQuality = "N/A";         // Good / Needs work / Bad



// ---- New analytics ----
export let symmetry = null;              // |leftKneeAngle - rightKneeAngle|
export let rangeOfMotion = {             // lowest & highest knee angles seen
  min: null,
  max: null,
};
export let depth = null;                 // difference between standing and bottom angle
export let kneeValgus = false;           // true if knees caving in

// ---- Thresholds (tweak for camera distance / user height) ----
const STANDING_THRESHOLD = 160;          // angle above which we consider user standing
const BOTTOM_THRESHOLD = 100;            // angle below which we consider squat bottom
const KNEE_VISIBILITY_THRESHOLD = 0.5;   // minimum visibility to count knee
const SYMMETRY_THRESHOLD = 15;           // max acceptable L/R angle difference
const VALGUS_THRESHOLD = 0.05;           // % inward knee collapse relative to hip-ankle line
const HIP_DEPTH_THRESHOLD = 0.5;       // normalized y (0 top, 1 bottom of frame)

// ---- Main pose update function ----
export function updatePose(results) {
  if (!results.poseLandmarks) return;

  const landmarks = results.poseLandmarks;
  latestPose = landmarks;

  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftKnee = landmarks[25];
  const rightKnee = landmarks[26];
  const leftAnkle = landmarks[27];
  const rightAnkle = landmarks[28];

  const leftVisible = leftKnee.visibility >= KNEE_VISIBILITY_THRESHOLD;
  const rightVisible = rightKnee.visibility >= KNEE_VISIBILITY_THRESHOLD;

  // ---- Knee angles ----
  if (leftVisible) leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
  else leftKneeAngle = null;

  if (rightVisible) rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
  else rightKneeAngle = null;

  // ---- Symmetry ----
  symmetry = (leftKneeAngle && rightKneeAngle) ? Math.abs(leftKneeAngle - rightKneeAngle) : null;

  // ---- Range of motion ----
  const visibleAngles = [leftKneeAngle, rightKneeAngle].filter(a => a !== null);
  if (visibleAngles.length > 0) {
    const avgAngle = visibleAngles.reduce((a, b) => a + b, 0) / visibleAngles.length;
    rangeOfMotion.min = (rangeOfMotion.min === null) ? avgAngle : Math.min(rangeOfMotion.min, avgAngle);
    rangeOfMotion.max = (rangeOfMotion.max === null) ? avgAngle : Math.max(rangeOfMotion.max, avgAngle);
    depth = rangeOfMotion.max - rangeOfMotion.min;
  }

  // ---- Knee valgus ----
  if (leftVisible && rightVisible) {
    const leftCollapse = Math.abs((leftKnee.x - leftHip.x) / ((leftAnkle.x - leftHip.x) || 1));
    const rightCollapse = Math.abs((rightKnee.x - rightHip.x) / ((rightAnkle.x - rightHip.x) || 1));
    kneeValgus = leftCollapse < VALGUS_THRESHOLD || rightCollapse < VALGUS_THRESHOLD;
  } else {
    kneeValgus = false;
  }

  // ---- Hip depth ----
  const hipY = (leftHip.y + rightHip.y) / 2;
  const atBottom = hipY > HIP_DEPTH_THRESHOLD;

  // ---- FSM and timing ----
  const now = performance.now() / 1000;
  switch (repState) {
    case 'STANDING':
      if (!atBottom) {
        repState = 'DESCENDING';
        repStartTime = now;
      }
      break;

    case 'DESCENDING':
      if (atBottom) {
        repState = 'BOTTOM';
        eccentricTime = now - (repStartTime ?? now);
      }
      break;

    case 'BOTTOM':
      if (!atBottom) {
        repState = 'ASCENDING';
        squatDepthReached = true;
        repStartTime = now;
      }
      break;

    case 'ASCENDING':
      if (hipY < HIP_DEPTH_THRESHOLD) {
        repState = 'STANDING';
        if (squatDepthReached) {
          repCount += 1;
          concentricTime = now - (repStartTime ?? now);

          // ---- Rep quality ----
          repQuality = "Good";
          if (symmetry && symmetry > SYMMETRY_THRESHOLD) repQuality = "Needs Work";
          if (kneeValgus || !squatDepthReached) repQuality = "Bad";

          squatDepthReached = false;
          rangeOfMotion.min = null;
          rangeOfMotion.max = null;
        }
      }
      break;
  }
}

// ---- Helper function: calculate angle between three points ----
function calculateAngle(a, b, c) {
  const AB = { x: a.x - b.x, y: a.y - b.y };
  const CB = { x: c.x - b.x, y: c.y - b.y };

  const dot = AB.x * CB.x + AB.y * CB.y;
  const magAB = Math.sqrt(AB.x**2 + AB.y**2);
  const magCB = Math.sqrt(CB.x**2 + CB.y**2);

  const cosAngle = dot / (magAB * magCB);

  const clamped = Math.max(-1, Math.min(1, cosAngle));
  return Math.acos(clamped) * (180 / Math.PI);
}

export function getPoseStats() {
  return { 
    repCount, 
    squatDepthReached, 
    stance, 
    symmetry, 
    rangeOfMotion, 
    depth, 
    kneeValgus,
    eccentricTime,
    concentricTime,
    repQuality
  };
}