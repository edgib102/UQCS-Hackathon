// posedata.js

export const SQUAT_THRESHOLD = 110;
export const KNEE_VISIBILITY_THRESHOLD = 0.8;
export const STANDING_THRESHOLD = 160;

// ---- 3D Vector Math Helpers ----
const vec3 = {
    subtract: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    magnitude: (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
    scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
};

// ---- Helper Functions ----
export function calculateAngle(a, b, c) {
    if (!a || !b || !c) return null;
    const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let deg = Math.abs(rad * (180.0 / Math.PI));
    return deg > 180 ? 360 - deg : deg;
}

export function getLandmarkProxy(landmarks) {
    if (!landmarks || landmarks.length === 0) return null;
    const hipL = landmarks[23]; const kneeL = landmarks[25]; const ankleL = landmarks[27];
    const hipR = landmarks[24]; const kneeR = landmarks[26]; const ankleR = landmarks[28];
    if (!hipL || !kneeL || !ankleL || !hipR || !kneeR || !ankleR) return null;
    return {
        left: { hip: hipL, knee: kneeL, ankle: ankleL },
        right: { hip: hipR, knee: kneeR, ankle: ankleR }
    };
}

function calculateValgusState(worldLandmarks) {
    const proxy = getLandmarkProxy(worldLandmarks);
    if (!proxy) return { left: 0, right: 0 };

    const hipAnkleL = vec3.subtract(proxy.left.ankle, proxy.left.hip);
    const hipKneeL = vec3.subtract(proxy.left.knee, proxy.left.hip);
    const projL = vec3.dot(hipKneeL, hipAnkleL) / vec3.dot(hipAnkleL, hipAnkleL);
    const closestPointL = vec3.add(proxy.left.hip, vec3.scale(hipAnkleL, projL));
    const deviationL = vec3.subtract(proxy.left.knee, closestPointL);

    const hipAnkleR = vec3.subtract(proxy.right.ankle, proxy.right.hip);
    const hipKneeR = vec3.subtract(proxy.right.knee, proxy.right.hip);
    const projR = vec3.dot(hipKneeR, hipAnkleR) / vec3.dot(hipAnkleR, hipAnkleR);
    const closestPointR = vec3.add(proxy.right.hip, vec3.scale(hipAnkleR, projR));
    const deviationR = vec3.subtract(proxy.right.knee, closestPointR);
    
    // FIX: Only measure the medial (X-axis) component of the deviation for a more accurate valgus score.
    const leftValgusDistance = deviationL.x > 0 ? deviationL.x : 0;
    const rightValgusDistance = deviationR.x < 0 ? Math.abs(deviationR.x) : 0;

    return {
        left: leftValgusDistance,
        right: rightValgusDistance,
    };
}

// --- Simplified function for LIVE feedback ONLY ---
export function getLivePoseStats(filteredLandmarks, filteredWorldLandmarks) {
    if (!filteredLandmarks) return { liveDepth: null, liveSymmetry: null, kneeValgus: false };

    const lmProxy = getLandmarkProxy(filteredLandmarks);
    const valgusState = calculateValgusState(filteredWorldLandmarks);
    const kneeValgus = (valgusState.left > 0.03 || valgusState.right > 0.03);

    if (!lmProxy) return { liveDepth: null, liveSymmetry: null, kneeValgus };

    const leftKneeAngle = calculateAngle(lmProxy.left.hip, lmProxy.left.knee, lmProxy.left.ankle);
    const rightKneeAngle = calculateAngle(lmProxy.right.hip, lmProxy.right.knee, lmProxy.right.ankle);
    let liveDepth = null; let liveSymmetry = null;
    if (leftKneeAngle && rightKneeAngle) {
        liveDepth = (leftKneeAngle + rightKneeAngle) / 2;
        liveSymmetry = Math.abs(leftKneeAngle - rightKneeAngle);
    }
    return { liveDepth, liveSymmetry, kneeValgus };
}

// --- Accurate Post-Session Analysis ---
export function analyzeSession(allLandmarks, allWorldLandmarks) {
    if (allLandmarks.length < 30) return [];

    const hipYTimeseries = allLandmarks.map(lm => (lm && lm[23] && lm[24]) ? (lm[23].y + lm[24].y) / 2 : null);
    
    const smoothedHipY = [];
    const smoothingWindow = 5;
    for(let i = 0; i < hipYTimeseries.length; i++){
        if(hipYTimeseries[i] === null) { smoothedHipY.push(null); continue; }
        let sum = 0; let count = 0;
        for(let j = -smoothingWindow; j <= smoothingWindow; j++){
            if(i+j >= 0 && i+j < hipYTimeseries.length && hipYTimeseries[i+j] !== null){
                sum += hipYTimeseries[i+j]; count++;
            }
        }
        smoothedHipY.push(sum/count);
    }

    const MIN_REP_PROMINENCE = 0.1; const MIN_REP_DISTANCE = 15;
    const troughs = [];
    for (let i = 1; i < smoothedHipY.length - 1; i++) {
        if (smoothedHipY[i] !== null && smoothedHipY[i-1] !== null && smoothedHipY[i+1] !== null &&
            smoothedHipY[i] > smoothedHipY[i-1] && smoothedHipY[i] > smoothedHipY[i+1]) {
             if (troughs.length === 0 || i - troughs[troughs.length - 1] > MIN_REP_DISTANCE) troughs.push(i);
        }
    }
    if (troughs.length === 0) return [];

    const finalReps = [];
    for (const troughIndex of troughs) {
        const lmAtTrough = allLandmarks[troughIndex];
        if (!lmAtTrough) continue;

        // --- NEW VALIDATION STEP 1: Check Landmark Visibility ---
        const hipL = lmAtTrough[23]; const kneeL = lmAtTrough[25]; const ankleL = lmAtTrough[27];
        const hipR = lmAtTrough[24]; const kneeR = lmAtTrough[26]; const ankleR = lmAtTrough[28];
        if (!hipL || !kneeL || !ankleL || !hipR || !kneeR || !ankleR ||
            hipL.visibility < KNEE_VISIBILITY_THRESHOLD || kneeL.visibility < KNEE_VISIBILITY_THRESHOLD ||
            ankleL.visibility < KNEE_VISIBILITY_THRESHOLD || hipR.visibility < KNEE_VISIBILITY_THRESHOLD ||
            kneeR.visibility < KNEE_VISIBILITY_THRESHOLD || ankleR.visibility < KNEE_VISIBILITY_THRESHOLD) {
            continue; // Reject rep if key landmarks are not clearly visible
        }

        // --- NEW VALIDATION STEP 2: Biomechanical Check (Hips vs Knees) ---
        const avgHipY = (hipL.y + hipR.y) / 2;
        const avgKneeY = (kneeL.y + kneeR.y) / 2;
        if (avgHipY < avgKneeY) {
            continue; // Reject rep if hips are not below or level with knees (in screen space)
        }

        const proxyAtTrough = getLandmarkProxy(lmAtTrough);
        if (!proxyAtTrough) continue;

        const depthAngle = calculateAngle(proxyAtTrough.left.hip, proxyAtTrough.left.knee, proxyAtTrough.left.ankle);
        if (depthAngle === null || depthAngle > SQUAT_THRESHOLD + 10) continue;

        let startFrame = 0;
        for (let i = troughIndex - 1; i > 0; i--) {
            if (smoothedHipY[i] !== null && smoothedHipY[i-1] !== null && smoothedHipY[i+1] !== null &&
                smoothedHipY[i] < smoothedHipY[i-1] && smoothedHipY[i] < smoothedHipY[i+1]) {
                startFrame = i; break;
            }
        }
        
        let endFrame = allLandmarks.length - 1;
        for (let i = troughIndex + 1; i < allLandmarks.length - 1; i++) {
            if (smoothedHipY[i] !== null && smoothedHipY[i-1] !== null && smoothedHipY[i+1] !== null &&
                smoothedHipY[i] < smoothedHipY[i-1] && smoothedHipY[i] < smoothedHipY[i+1]) {
                endFrame = i; break;
            }
        }
        
        if (smoothedHipY[troughIndex] - smoothedHipY[startFrame] < MIN_REP_PROMINENCE) continue;

        let maxLeftValgus = 0, maxRightValgus = 0, totalSymmetryDiff = 0, symmetrySamples = 0;
        for (let i = startFrame; i <= endFrame; i++) {
            const valgusState = calculateValgusState(allWorldLandmarks[i]);
            maxLeftValgus = Math.max(maxLeftValgus, valgusState.left);
            maxRightValgus = Math.max(maxRightValgus, valgusState.right);

            const proxy = getLandmarkProxy(allLandmarks[i]);
            if(proxy) {
                const leftAngle = calculateAngle(proxy.left.hip, proxy.left.knee, proxy.left.ankle);
                const rightAngle = calculateAngle(proxy.right.hip, proxy.right.knee, proxy.right.ankle);
                if (leftAngle !== null && rightAngle !== null) {
                    totalSymmetryDiff += Math.abs(leftAngle - rightAngle);
                    symmetrySamples++;
                }
            }
        }

        finalReps.push({
            startFrame, endFrame, depth: depthAngle,
            maxLeftValgus, maxRightValgus,
            symmetry: symmetrySamples > 0 ? totalSymmetryDiff / symmetrySamples : 0,
        });
    }
    return finalReps;
}