// ---- State Management ----
export let repHistory = [];
export let latestPose = null;
export let repCount = 0;
export let repState = 'UP'; // FSM: UP, DOWN

// ---- Live Rep Data ----
export let repQuality = "N/A";
export let symmetry = null;
export let rangeOfMotion = { min: null, max: null };
export let depth = null;

// ---- Private state variables ----
let repStartTime = null;

// ---- Thresholds ----
const STANDING_THRESHOLD = 160;
export const SQUAT_THRESHOLD = 110;
export const KNEE_VISIBILITY_THRESHOLD = 0.65;
export const SYMMETRY_THRESHOLD = 20; // Export this
const VALGUS_THRESHOLD = 0.02;

// ---- Main pose update function ----
export function updatePose(results) {
    if (!results.poseLandmarks) return;

    latestPose = results.poseLandmarks;
    const { left, right } = getLandmarkProxy(latestPose);

    const leftVisible = left.knee.visibility > KNEE_VISIBILITY_THRESHOLD;
    const rightVisible = right.knee.visibility > KNEE_VISIBILITY_THRESHOLD;
    
    // If both knees are not visible, don't update pose
    if (!leftVisible || !rightVisible) return;

    const leftKneeAngle = calculateAngle(left.hip, left.knee, left.ankle);
    const rightKneeAngle = calculateAngle(right.hip, right.knee, right.ankle);

    symmetry = Math.abs(leftKneeAngle - rightKneeAngle);
    const kneeValgus = checkKneeValgus(left, right, leftVisible, rightVisible);

    const avgAngle = (leftKneeAngle + rightKneeAngle) / 2;

    rangeOfMotion.min = Math.min(rangeOfMotion.min ?? avgAngle, avgAngle);
    rangeOfMotion.max = Math.max(rangeOfMotion.max ?? avgAngle, avgAngle);
    depth = rangeOfMotion.max - rangeOfMotion.min;

    // ---- Rep Counting FSM ----
    const now = performance.now();
    if (repState === 'UP' && leftKneeAngle < SQUAT_THRESHOLD && rightKneeAngle < SQUAT_THRESHOLD) {
        repState = 'DOWN';
        repStartTime = now;
    } else if (repState === 'DOWN' && leftKneeAngle > STANDING_THRESHOLD && rightKneeAngle > STANDING_THRESHOLD) {
        repCount++;
        repState = 'UP';
        
        const totalTime = (now - repStartTime) / 1000;
        
        if (depth < (STANDING_THRESHOLD - SQUAT_THRESHOLD - 10) || kneeValgus || (symmetry && symmetry > SYMMETRY_THRESHOLD)) {
            repQuality = "BAD";
        } else if (symmetry && symmetry > (SYMMETRY_THRESHOLD / 2)) {
            repQuality = "OK";
        } else {
            repQuality = "GOOD";
        }
        
        // Store the completed rep's data
        repHistory.push({
            quality: repQuality,
            depth: depth,
            symmetry: symmetry,
            kneeValgus: kneeValgus,
            eccentricTime: totalTime / 2, // Simple split for now
            concentricTime: totalTime / 2,
        });

        // Reset for next rep
        rangeOfMotion = { min: null, max: null };
        depth = null;
    }
}

export function getPoseStats() {
    return { repCount, repQuality, symmetry, depth, repHistory };
}

// ---- New Reset Function ----
export function resetPoseStats() {
    repHistory = [];
    latestPose = null;
    repCount = 0;
    repState = 'UP';
    repQuality = "N/A";
    symmetry = null;
    rangeOfMotion = { min: null, max: null };
    depth = null;
}

// ---- Helper Functions ----
function checkKneeValgus(left, right, leftVisible, rightVisible) {
    if (!leftVisible || !rightVisible) return false;
    const leftValgus = left.knee.x < left.ankle.x - VALGUS_THRESHOLD;
    const rightValgus = right.knee.x > right.ankle.x + VALGUS_THRESHOLD;
    return leftValgus || rightValgus;
}

export function calculateAngle(a, b, c) {
    const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let deg = Math.abs(rad * (180.0 / Math.PI));
    return deg > 180 ? 360 - deg : deg;
}

export function getLandmarkProxy(landmarks) {
    return {
        left: { hip: landmarks[23], knee: landmarks[25], ankle: landmarks[27] },
        right: { hip: landmarks[24], knee: landmarks[26], ankle: landmarks[28] }
    };
}