// ---- Exported variables ----
export let latestPose = null;            // latest MediaPipe landmarks
export let leftKneeAngle = null;         // left knee angle in degrees
export let rightKneeAngle = null;        // right knee angle in degrees
export let squatDepthReached = false;    // true if bottom reached in current rep
export let repCount = 0;                 // total reps completed
export let repState = 'STANDING';        // FSM: STANDING, DESCENDING, BOTTOM, ASCENDING
export let stance = 'UNKNOWN';           // FRONT or SIDE

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
const KNEE_VISIBILITY_THRESHOLD = 0.2;   // minimum visibility to count knee
const SYMMETRY_THRESHOLD = 15;           // max acceptable L/R angle difference
const VALGUS_THRESHOLD = 0.05;           // % inward knee collapse relative to hip-ankle line

// ---- Main pose update function ----
export function updatePose(results) {
  if (!results.poseLandmarks) return;

  const landmarks = results.poseLandmarks;
  latestPose = landmarks;

  const leftHip = landmarks[23];
  const rightHip = landmarks[24];
  const leftKneeLandmark = landmarks[25];
  const rightKneeLandmark = landmarks[26];
  const leftAnkle = landmarks[27];
  const rightAnkle = landmarks[28];

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
    leftKneeAngle = calculateAngle(leftHip, leftKneeLandmark, leftAnkle);  // hip → knee → ankle
  } else {
    leftKneeAngle = null;
  }

  if (rightVisible) {
    rightKneeAngle = calculateAngle(rightHip, rightKneeLandmark, rightAnkle);
  } else {
    rightKneeAngle = null;
  }

  // ---- Symmetry ----
  if (leftKneeAngle && rightKneeAngle) {
    symmetry = Math.abs(leftKneeAngle - rightKneeAngle);
  } else {
    symmetry = null;
  }

  // ---- Range of motion (track min/max knee angle seen) ----
  const visibleKnees = [leftKneeAngle, rightKneeAngle].filter(a => a !== null);
  if (visibleKnees.length > 0) {
    const currentAngle = visibleKnees.reduce((a, b) => a + b, 0) / visibleKnees.length;

    if (rangeOfMotion.min === null || currentAngle < rangeOfMotion.min) {
      rangeOfMotion.min = currentAngle;
    }
    if (rangeOfMotion.max === null || currentAngle > rangeOfMotion.max) {
      rangeOfMotion.max = currentAngle;
    }
    depth = (rangeOfMotion.max ?? 0) - (rangeOfMotion.min ?? 0);
  }

  // ---- Knee valgus detection (FRONT stance only) ----
  if (stance === 'FRONT') {
    const leftHipToAnkleX = leftAnkle.x - leftHip.x;
    const leftHipToKneeX = leftKneeLandmark.x - leftHip.x;

    const rightHipToAnkleX = rightAnkle.x - rightHip.x;
    const rightHipToKneeX = rightKneeLandmark.x - rightHip.x;

    // If knee is significantly closer to midline than ankle, flag valgus
    const leftCollapse = Math.abs(leftHipToKneeX) / Math.abs(leftHipToAnkleX + 1e-6);
    const rightCollapse = Math.abs(rightHipToKneeX) / Math.abs(rightHipToAnkleX + 1e-6);

    kneeValgus = (leftCollapse < VALGUS_THRESHOLD) || (rightCollapse < VALGUS_THRESHOLD);
  } else {
    kneeValgus = false; // can't detect reliably in side view
  }

  // ---- Determine "effective knee angle(s)" for FSM ----
  let atStanding = false;
  let atBottom = false;

  if (stance === 'FRONT') {
    atStanding = (leftKneeAngle > STANDING_THRESHOLD && rightKneeAngle > STANDING_THRESHOLD);
    atBottom   = (leftKneeAngle < BOTTOM_THRESHOLD  && rightKneeAngle < BOTTOM_THRESHOLD);
  } else if (stance === 'SIDE') {
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
        squatDepthReached = true;
      }
      break;

    case 'ASCENDING':
      if (atStanding) {
        repState = 'STANDING';
        if (squatDepthReached) {
          repCount += 1;
        }
        squatDepthReached = false;
        // reset rangeOfMotion per rep
        rangeOfMotion.min = null;
        rangeOfMotion.max = null;
      }
      break;
  }

  // ---- Debug logs ----
  console.log(
    `Stance: ${stance}, State: ${repState}, Reps: ${repCount}, Depth: ${squatDepthReached}, Sym: ${symmetry?.toFixed(1) ?? 'N/A'}, ROM: ${depth?.toFixed(1) ?? 'N/A'}, Valgus: ${kneeValgus}`
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
    kneeValgus 
  };
}
