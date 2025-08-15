// --- State Variables ---
let repCount = 0;
let repState = 'STANDING'; // 'STANDING', 'DESCENDING', 'BOTTOM', 'ASCENDING'
let squatDepthReached = false;

// --- Thresholds ---
const STANDING_THRESHOLD = 160; // Angle for standing position
const BOTTOM_THRESHOLD = 100;    // Angle for squat depth
const VISIBILITY_THRESHOLD = 0.5; // Minimum visibility for landmarks

/**
 * Calculates the angle between three 2D points (p1, p2, p3).
 * The angle is calculated at p2.
 */
function calculateAngle(p1, p2, p3) {
    const rad = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let angle = Math.abs(rad * (180.0 / Math.PI));
    if (angle > 180.0) {
        angle = 360 - angle;
    }
    return angle;
}

/**
 * Processes pose landmarks to count squat repetitions and update UI.
 * @param {object[]} landmarks - The array of pose landmarks from MediaPipe.
 */
export function updateRepCounter(landmarks) {
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    const leftKnee = landmarks[25];
    const rightKnee = landmarks[26];
    const leftAnkle = landmarks[27];
    const rightAnkle = landmarks[28];

    // Check if key landmarks are visible
    if (leftKnee.visibility < VISIBILITY_THRESHOLD || rightKnee.visibility < VISIBILITY_THRESHOLD) {
        return; // Skip if knees are not clearly visible
    }

    // Calculate knee angles
    const leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
    const rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
    const minKneeAngle = Math.min(leftKneeAngle, rightKneeAngle);

    // State machine for rep counting
    switch (repState) {
        case 'STANDING':
            if (minKneeAngle < STANDING_THRESHOLD) {
                repState = 'DESCENDING';
                squatDepthReached = false;
            }
            break;
        case 'DESCENDING':
            if (minKneeAngle < BOTTOM_THRESHOLD) {
                repState = 'BOTTOM';
                squatDepthReached = true;
            }
            break;
        case 'BOTTOM':
            if (minKneeAngle > BOTTOM_THRESHOLD) {
                repState = 'ASCENDING';
            }
            break;
        case 'ASCENDING':
            if (minKneeAngle > STANDING_THRESHOLD) {
                repState = 'STANDING';
                if (squatDepthReached) {
                    repCount++;
                }
            }
            break;
    }

    // Update the UI with the latest stats
    document.getElementById('repCount').textContent = repCount;
    document.getElementById('leftKneeAngle').textContent = leftKneeAngle.toFixed(1);
    document.getElementById('rightKneeAngle').textContent = rightKneeAngle.toFixed(1);
    document.getElementById('squatDepthReached').textContent = squatDepthReached;
}