// --- State Variables (Encapsulated within the module) ---
let repCount = 0;
let squatDepthReached = "No";
let squatState = 'up'; // Can be 'up' or 'down'

// --- Constants ---
// Angle thresholds for squat detection
const SQUAT_DOWN_THRESHOLD = 110; // Angle in degrees to consider a squat 'down'
const SQUAT_UP_THRESHOLD = 160;   // Angle in degrees to consider a squat 'up'

/**
 * Calculates the angle between three 2D points (p1, p2, p3) with p2 as the vertex.
 * @returns {number} The angle in degrees.
 */
function calculateAngle(p1, p2, p3) {
    const rad = Math.atan2(p3.y - p2.y, p3.x - p2.x) - Math.atan2(p1.y - p2.y, p1.x - p2.x);
    let deg = Math.abs(rad * (180 / Math.PI));
    return (deg > 180) ? 360 - deg : deg;
}

/**
 * Processes pose landmarks to detect squats and count repetitions.
 * @param {object} results - The pose detection results from MediaPipe.
 */
export function updatePoseData(results) {
    if (!results.poseLandmarks) return;

    const landmarks = results.poseLandmarks;

    // Get coordinates for relevant joints, ensuring they are detected
    const [leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle] = [23, 24, 25, 26, 27, 28].map(id => landmarks[id]);
    
    // Proceed only if all key joints are visible
    if ([leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle].some(lm => lm.visibility < 0.7)) {
        return;
    }

    // --- Calculate Knee Angles ---
    const leftKneeAngle = calculateAngle(leftHip, leftKnee, leftAnkle);
    const rightKneeAngle = calculateAngle(rightHip, rightKnee, rightAnkle);
    const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;

    // --- Squat Counting State Machine Logic ---
    if (squatState === 'up' && avgKneeAngle < SQUAT_DOWN_THRESHOLD) {
        squatState = 'down';
        squatDepthReached = "Yes";
    } else if (squatState === 'down' && avgKneeAngle > SQUAT_UP_THRESHOLD) {
        squatState = 'up';
        repCount++;
        squatDepthReached = "No";
    }
}

/**
 * Returns the current pose analysis statistics.
 * @returns {{repCount: number, squatDepthReached: string}}
 */
export function getPoseStats() {
    return { repCount, squatDepthReached };
}