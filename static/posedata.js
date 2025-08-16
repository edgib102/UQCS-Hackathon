// ---- Exported variables for state management ----
export let latestPose = null;
export let repCount = 0;
export let repState = 'UP'; // FSM: UP, DOWN
export let repQuality = "N/A";
export let eccentricTime = 0;
export let concentricTime = 0;
export let symmetry = null;
export let rangeOfMotion = { min: null, max: null };
export let depth = null;
export let kneeValgus = false;

// ---- Private state variables ----
let repStartTime = null;

// ---- Thresholds (tweak for desired difficulty) ----
const STANDING_THRESHOLD = 160;     // Angle above which user is considered standing
const SQUAT_THRESHOLD = 110;        // Angle below which a squat is registered
const KNEE_VISIBILITY_THRESHOLD = 0.65;
const SYMMETRY_THRESHOLD = 20;      // Max acceptable L/R knee angle difference in degrees
const VALGUS_THRESHOLD = 0.05;      // Threshold for knee caving inward

// ---- Main pose update function ----
export function updatePose(results) {
    if (!results.poseLandmarks) return;

    latestPose = results.poseLandmarks;
    const { left, right } = getLandmarkProxy(latestPose);

    const leftVisible = left.knee.visibility > KNEE_VISIBILITY_THRESHOLD;
    const rightVisible = right.knee.visibility > KNEE_VISIBILITY_THRESHOLD;

    const leftKneeAngle = leftVisible ? calculateAngle(left.hip, left.knee, left.ankle) : null;
    const rightKneeAngle = rightVisible ? calculateAngle(right.hip, right.knee, right.ankle) : null;

    // --- Analytics ---
    symmetry = (leftKneeAngle && rightKneeAngle) ? Math.abs(leftKneeAngle - rightKneeAngle) : null;
    kneeValgus = checkKneeValgus(left, right, leftVisible, rightVisible);

    const visibleAngles = [leftKneeAngle, rightKneeAngle].filter(a => a !== null);
    if (visibleAngles.length === 0) return; // Cannot proceed without knee angles

    const avgAngle = visibleAngles.reduce((a, b) => a + b, 0) / visibleAngles.length;

    // Update range of motion for the current rep
    rangeOfMotion.min = Math.min(rangeOfMotion.min ?? avgAngle, avgAngle);
    rangeOfMotion.max = Math.max(rangeOfMotion.max ?? avgAngle, avgAngle);

    // ---- Rep Counting Finite State Machine (FSM) ----
    const now = performance.now();
    if (repState === 'UP' && avgAngle < SQUAT_THRESHOLD) {
        repState = 'DOWN';
        repStartTime = now;
        eccentricTime = 0;
        concentricTime = 0;
    } else if (repState === 'DOWN' && avgAngle > STANDING_THRESHOLD) {
        // Rep completed
        repCount++;
        repState = 'UP';

        // Calculate metrics for the completed rep
        depth = rangeOfMotion.max - rangeOfMotion.min;
        const totalTime = (now - repStartTime) / 1000;
        
        // A simple time split; more complex logic could find the exact bottom point
        eccentricTime = totalTime / 2; 
        concentricTime = totalTime / 2;

        // Assess rep quality
        if (depth < (STANDING_THRESHOLD - SQUAT_THRESHOLD - 10) || kneeValgus || (symmetry && symmetry > SYMMETRY_THRESHOLD)) {
            repQuality = "BAD";
        } else if (symmetry && symmetry > (SYMMETRY_THRESHOLD / 2)) {
            repQuality = "OK";
        } else {
            repQuality = "GOOD";
        }

        // Reset ROM for next rep
        rangeOfMotion = { min: null, max: null };
    }
}

// ---- Analytics Helper Functions ----

function checkKneeValgus(left, right, leftVisible, rightVisible) {
    if (!leftVisible || !rightVisible) return false;

    // A simple valgus check: is the knee significantly inside the hip-ankle line?
    const leftValgus = left.knee.x < left.ankle.x || left.knee.x > left.hip.x;
    const rightValgus = right.knee.x > right.ankle.x || right.knee.x < right.hip.x;
    
    // A more robust check could be added here using the Z-axis if needed.
    // For now, we flag if either knee shows this pattern.
    return leftValgus || rightValgus;
}

// ---- Geometry Helper ----
function calculateAngle(a, b, c) {
    const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let deg = Math.abs(rad * (180.0 / Math.PI));
    return deg > 180 ? 360 - deg : deg;
}

// ---- Landmark Proxy for easier access ----
function getLandmarkProxy(landmarks) {
    return {
        left: {
            hip: landmarks[23], knee: landmarks[25], ankle: landmarks[27]
        },
        right: {
            hip: landmarks[24], knee: landmarks[26], ankle: landmarks[28]
        }
    };
}

// ---- Data Exporter ----
export function getPoseStats() {
    return {
        repCount, repQuality, eccentricTime, concentricTime, symmetry,
        rangeOfMotion, depth, kneeValgus
    };
}