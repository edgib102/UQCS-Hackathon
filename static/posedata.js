// Export a variable to hold the latest pose and knee angle
export let latestPose = null;
export let leftKneeAngle = null;
export let rightKneeAngle = null;
export let squatDepthReached = false; // true if knee angle < 90 deg

// Export a function to update the pose and calculate angles
export function updatePose(results) {
  if (!results.poseLandmarks) return;

  const landmarks = results.poseLandmarks;
  latestPose = landmarks;

  // Left leg
  const leftHip = landmarks[23];
  const leftKnee = landmarks[25];
  const leftAnkle = landmarks[27];
  leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);

  // Right leg
  const rightHip = landmarks[24];
  const rightKnee = landmarks[26];
  const rightAnkle = landmarks[28];
  rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);

  // Check squat depth (bottom if either knee angle < 90°)
  squatDepthReached = leftKneeAngle < 90 || rightKneeAngle < 90;

  // Debug logs
  console.log(`Left knee angle: ${leftKneeAngle.toFixed(1)}°`);
  console.log(`Right knee angle: ${rightKneeAngle.toFixed(1)}°`);
  console.log(`Squat bottom reached? ${squatDepthReached}`);
}

// Helper function to calculate angle between three points
function calculateAngle(a, b, c) {
  const AB = { x: a.x - b.x, y: a.y - b.y };
  const CB = { x: c.x - b.x, y: c.y - b.y };

  const dot = AB.x * CB.x + AB.y * CB.y;
  const magAB = Math.sqrt(AB.x**2 + AB.y**2);
  const magCB = Math.sqrt(CB.x**2 + CB.y**2);

  const cosAngle = dot / (magAB * magCB);

  // Clamp cosAngle to [-1, 1] to avoid NaN due to rounding
  const clamped = Math.max(-1, Math.min(1, cosAngle));
  return Math.acos(clamped) * (180 / Math.PI);
}
