// posedata.js

// ---- State Management ----
let repHistory = [];
let repCount = 0;
let repState = 'STANDING';
let currentRepData = null;

// ---- Live Rep Data ----
let lastRepQuality = "N/A";
let lastRepSymmetry = null;
let lastRepDepth = null;
let kneeValgusState = false;

// ---- Smoothing & Thresholds ----
const angleBuffer = { left: [], right: [] };
const SMOOTHING_WINDOW = 5;
export const STANDING_THRESHOLD = 160;
export const SQUAT_THRESHOLD = 110;
export const KNEE_VISIBILITY_THRESHOLD = 0.8;
export const SYMMETRY_THRESHOLD = 20;

// ---- Helper Functions ----
export function calculateAngle(a, b, c) {
    if (!a || !b || !c) return null;
    const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let deg = Math.abs(rad * (180.0 / Math.PI));
    return deg > 180 ? 360 - deg : deg;
}

export function getLandmarkProxy(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;

    // --- FIX: Make this function robust to null landmarks in the array ---
    const hipL = landmarks[23];
    const kneeL = landmarks[25];
    const ankleL = landmarks[27];
    const hipR = landmarks[24];
    const kneeR = landmarks[26];
    const ankleR = landmarks[28];

    if (!hipL || !kneeL || !ankleL || !hipR || !kneeR || !ankleR) {
        return null;
    }
    
    return {
        left: { hip: hipL, knee: kneeL, ankle: ankleL },
        right: { hip: hipR, knee: kneeR, ankle: ankleR }
    };
}

function checkKneeValgus3D(landmarks) {
    if (!landmarks || landmarks.length === 0) return false;
    const leftKnee = landmarks[25];
    const leftAnkle = landmarks[27];
    const rightKnee = landmarks[26];
    const rightAnkle = landmarks[28];
    if(!leftKnee || !leftAnkle || !rightKnee || !rightAnkle) return false;

    const VALGUS_THRESHOLD_3D = 0.03;
    const leftValgus = leftKnee.x > leftAnkle.x + VALGUS_THRESHOLD_3D;
    const rightValgus = rightKnee.x < rightAnkle.x - VALGUS_THRESHOLD_3D;
    return leftValgus || rightValgus;
}

function getSmoothedAngle(buffer, newValue) {
    if (newValue === null) return null;
    buffer.push(newValue);
    if (buffer.length > SMOOTHING_WINDOW) {
        buffer.shift();
    }
    return buffer.reduce((sum, val) => sum + val, 0) / buffer.length;
}

// ---- Main pose update function (for LIVE feedback) ----
export function updatePose(results, frameCounter, filteredLandmarks, filteredWorldLandmarks) {
    if (!filteredLandmarks || !filteredWorldLandmarks) return;

    const lmProxy = getLandmarkProxy(filteredLandmarks);
    if (!lmProxy) return;

    const leftVisible = lmProxy.left.hip.visibility > KNEE_VISIBILITY_THRESHOLD;
    const rightVisible = lmProxy.right.hip.visibility > KNEE_VISIBILITY_THRESHOLD;
    if (!leftVisible || !rightVisible) return;

    const leftKneeAngle = calculateAngle(lmProxy.left.hip, lmProxy.left.knee, lmProxy.left.ankle);
    const rightKneeAngle = calculateAngle(lmProxy.right.hip, lmProxy.right.knee, lmProxy.right.ankle);

    const smoothedLeft = getSmoothedAngle(angleBuffer.left, leftKneeAngle);
    const smoothedRight = getSmoothedAngle(angleBuffer.right, rightKneeAngle);
    const avgAngle = (smoothedLeft + smoothedRight) / 2;

    kneeValgusState = checkKneeValgus3D(filteredWorldLandmarks);
    const hipY = (filteredLandmarks[23].y + filteredLandmarks[24].y) / 2;

    switch (repState) {
        case 'STANDING':
            if (hipY > (currentRepData?.standingHipY ?? hipY) + 0.05) {
                repState = 'DESCENDING';
                currentRepData = {
                    startFrame: frameCounter,
                    minDepthAngle: avgAngle,
                    standingHipY: hipY,
                    minHipY: hipY,
                    valgusDetected: false,
                };
            }
            break;

        case 'DESCENDING':
            if (hipY < currentRepData.minHipY) {
                currentRepData.minHipY = hipY;
                currentRepData.minDepthAngle = avgAngle;
            } else if (hipY > currentRepData.minHipY + 0.03) {
                repState = 'ASCENDING';
            }
            if (kneeValgusState) currentRepData.valgusDetected = true;
            break;

        case 'ASCENDING':
            if (hipY <= currentRepData.standingHipY) {
                repState = 'STANDING';
                if (currentRepData.minDepthAngle < SQUAT_THRESHOLD) {
                    repCount++;
                    repHistory.push({
                        depth: currentRepData.minDepthAngle,
                        kneeValgus: currentRepData.valgusDetected,
                        symmetry: Math.abs(leftKneeAngle - rightKneeAngle)
                    });
                    lastRepDepth = currentRepData.minDepthAngle;
                    lastRepSymmetry = Math.abs(leftKneeAngle - rightKneeAngle);
                }
                currentRepData = null;
            }
            if (kneeValgusState && currentRepData) currentRepData.valgusDetected = true;
            break;
    }
}

export function getPoseStats() {
    return {
        repCount,
        symmetry: lastRepSymmetry,
        depth: lastRepDepth,
        repHistory,
        kneeValgus: kneeValgusState
    };
}

export function resetPoseStats() {
    repHistory = [];
    repCount = 0;
    repState = 'STANDING';
    currentRepData = null;
    lastRepQuality = "N/A";
    lastRepSymmetry = null;
    lastRepDepth = null;
    kneeValgusState = false;
    angleBuffer.left = [];
    angleBuffer.right = [];
}

// --- Accurate Post-Session Analysis ---
export function analyzeSession(allLandmarks, allWorldLandmarks) {
    if (allLandmarks.length < 20) return [];

    const hipYTimeseries = allLandmarks.map(lm => (lm && lm[23] && lm[24]) ? (lm[23].y + lm[24].y) / 2 : null).filter(y => y !== null);
    if (hipYTimeseries.length < 20) return [];

    const troughs = [];
    for (let i = 5; i < hipYTimeseries.length - 5; i++) {
        const prev = hipYTimeseries[i-5];
        const curr = hipYTimeseries[i];
        const next = hipYTimeseries[i+5];
        if (curr > prev && curr > next) {
            troughs.push(i);
        }
    }
    if (troughs.length === 0) return [];

    const finalReps = [];
    let lastPeak = 0;
    for (const troughIndex of troughs) {
        if (troughIndex < lastPeak) continue;

        const lmAtTrough = allLandmarks[troughIndex];
        const lmProxy = getLandmarkProxy(lmAtTrough);
        if (!lmProxy) continue;
        
        const depthAngle = calculateAngle(lmProxy.left.hip, lmProxy.left.knee, lmProxy.left.ankle);
        if (depthAngle === null || depthAngle > SQUAT_THRESHOLD + 10) continue;
        
        let peakIndex = -1;
        for(let i = troughIndex - 5; i > lastPeak; i--) {
            if(hipYTimeseries[i] < hipYTimeseries[i+1] && hipYTimeseries[i] < hipYTimeseries[i-1]){
                peakIndex = i;
                break;
            }
        }
        if(peakIndex === -1) peakIndex = lastPeak;

        const repDepth = hipYTimeseries[troughIndex] - hipYTimeseries[peakIndex];
        if (repDepth > 0.1) {
            let hasValgus = false;
            for (let i = peakIndex; i < troughIndex + (troughIndex - peakIndex) && i < allWorldLandmarks.length; i++) {
                if (checkKneeValgus3D(allWorldLandmarks[i])) {
                    hasValgus = true;
                    break;
                }
            }
            const symmetryAtDepth = Math.abs(
                calculateAngle(lmProxy.left.hip, lmProxy.left.knee, lmProxy.left.ankle) -
                calculateAngle(lmProxy.right.hip, lmProxy.right.knee, lmProxy.right.ankle)
            );

            finalReps.push({
                startFrame: peakIndex,
                endFrame: troughIndex + (troughIndex - peakIndex),
                depth: depthAngle,
                kneeValgus: hasValgus,
                symmetry: symmetryAtDepth,
            });
            lastPeak = troughIndex;
        }
    }
    return finalReps;
}