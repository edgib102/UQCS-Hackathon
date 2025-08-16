// posedata.js - Improved for webcam accuracy

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

// IMPROVED: Balanced valgus detection - not too strict, not too lenient
function calculateValgusState(screenLandmarks, worldLandmarks) {
    const screenProxy = getLandmarkProxy(screenLandmarks);
    if (!screenProxy) return { left: 0, right: 0, confidence: 0 };

    // Check landmark confidence for reliability
    const avgConfidence = [
        screenProxy.left.hip, screenProxy.left.knee, screenProxy.left.ankle,
        screenProxy.right.hip, screenProxy.right.knee, screenProxy.right.ankle
    ].reduce((sum, lm) => sum + (lm.visibility || 0), 0) / 6;

    if (avgConfidence < 0.5) return { left: 0, right: 0, confidence: avgConfidence };

    // Method 1: Simple knee-to-midline deviation
    // Calculate the midline between hips and ankles
    const leftHip = screenProxy.left.hip;
    const rightHip = screenProxy.right.hip;
    const leftAnkle = screenProxy.left.ankle;
    const rightAnkle = screenProxy.right.ankle;
    const leftKnee = screenProxy.left.knee;
    const rightKnee = screenProxy.right.knee;

    // Expected knee position (straight line from hip to ankle)
    const leftExpectedKneeX = leftHip.x + 0.5 * (leftAnkle.x - leftHip.x);
    const rightExpectedKneeX = rightHip.x + 0.5 * (rightAnkle.x - rightHip.x);

    // Actual knee deviation from expected position
    const leftDeviation = Math.abs(leftKnee.x - leftExpectedKneeX);
    const rightDeviation = Math.abs(rightKnee.x - rightExpectedKneeX);

    // Normalize by torso width to account for different body sizes and camera distances
    const torsoWidth = Math.abs(rightHip.x - leftHip.x);
    const leftValgusRatio = torsoWidth > 0.01 ? leftDeviation / torsoWidth : 0;
    const rightValgusRatio = torsoWidth > 0.01 ? rightDeviation / torsoWidth : 0;

    // Only count as valgus if knee moves toward midline (inward)
    // For webcam (mirrored), left knee caving in means knee.x > expected
    // right knee caving in means knee.x < expected
    const leftValgus = (leftKnee.x > leftExpectedKneeX) ? leftValgusRatio : 0;
    const rightValgus = (rightKnee.x < rightExpectedKneeX) ? rightValgusRatio : 0;

    return {
        left: leftValgus,
        right: rightValgus,
        confidence: avgConfidence
    };
}

// --- Simplified function for LIVE feedback ONLY ---
export function getLivePoseStats(filteredLandmarks, filteredWorldLandmarks) {
    if (!filteredLandmarks) return { liveDepth: null, liveSymmetry: null, kneeValgus: false };

    const lmProxy = getLandmarkProxy(filteredLandmarks);
    const valgusState = calculateValgusState(filteredLandmarks, filteredWorldLandmarks);
    
    // Balanced valgus threshold for live feedback - detectable but not overly sensitive
    const kneeValgus = valgusState.confidence > 0.6 && (valgusState.left > 0.08 || valgusState.right > 0.08);

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

// IMPROVED: Much more lenient rep detection for debugging and real-world use
export function analyzeSession(allLandmarks, allWorldLandmarks) {
    console.log(`Starting analysis with ${allLandmarks.length} frames`);
    
    if (allLandmarks.length < 15) {
        console.log("Not enough frames for analysis");
        return [];
    }

    // Extract hip height with very lenient requirements
    const hipYTimeseries = allLandmarks.map((lm, index) => {
        if (!lm || !lm[23] || !lm[24]) return null;
        const leftHip = lm[23], rightHip = lm[24];
        // Much more lenient visibility requirement
        if (leftHip.visibility < 0.3 || rightHip.visibility < 0.3) return null;
        return (leftHip.y + rightHip.y) / 2;
    });
    
    const validFrames = hipYTimeseries.filter(val => val !== null).length;
    console.log(`Valid hip tracking in ${validFrames}/${hipYTimeseries.length} frames`);
    
    if (validFrames < 10) {
        console.log("Not enough valid hip tracking frames");
        return [];
    }
    
    // Simple moving average smoothing
    const smoothedHipY = [];
    const windowSize = 3; // Smaller window for responsiveness
    
    for(let i = 0; i < hipYTimeseries.length; i++){
        if(hipYTimeseries[i] === null) { 
            smoothedHipY.push(null); 
            continue; 
        }

        let sum = 0, count = 0;
        for(let j = -windowSize; j <= windowSize; j++){
            if(i+j >= 0 && i+j < hipYTimeseries.length && hipYTimeseries[i+j] !== null){
                sum += hipYTimeseries[i+j];
                count++;
            }
        }
        smoothedHipY.push(count > 0 ? sum / count : hipYTimeseries[i]);
    }

    // Much more lenient peak detection
    const MIN_REP_PROMINENCE = 0.03; // Very small prominence requirement
    const MIN_REP_DISTANCE = 8; // Allow for very fast reps
    const troughs = [];
    
    // Find all local maxima (deepest squat positions)
    for (let i = 1; i < smoothedHipY.length - 1; i++) {
        if (smoothedHipY[i] === null) continue;
        
        let isLocalMax = true;
        let neighborCount = 0;
        
        // Check immediate neighbors only
        for(let j = -1; j <= 1; j++) {
            if(j === 0) continue;
            if(i+j >= 0 && i+j < smoothedHipY.length && smoothedHipY[i+j] !== null) {
                neighborCount++;
                if(smoothedHipY[i+j] >= smoothedHipY[i]) {
                    isLocalMax = false;
                    break;
                }
            }
        }
        
        if(isLocalMax && neighborCount >= 1) {
            if (troughs.length === 0 || i - troughs[troughs.length - 1] > MIN_REP_DISTANCE) {
                troughs.push(i);
            }
        }
    }
    
    console.log(`Found ${troughs.length} potential squat positions at frames:`, troughs);

    if (troughs.length === 0) {
        console.log("No squat positions detected - trying alternative method");
        
        // Fallback: Look for significant hip movements
        const hipMovements = [];
        for (let i = 10; i < smoothedHipY.length - 10; i++) {
            if (smoothedHipY[i] === null) continue;
            
            // Look for frames where hip is significantly lower than surrounding frames
            let avgBefore = 0, avgAfter = 0, beforeCount = 0, afterCount = 0;
            
            for (let j = i - 10; j < i; j++) {
                if (smoothedHipY[j] !== null) {
                    avgBefore += smoothedHipY[j];
                    beforeCount++;
                }
            }
            for (let j = i + 1; j <= i + 10; j++) {
                if (smoothedHipY[j] !== null) {
                    avgAfter += smoothedHipY[j];
                    afterCount++;
                }
            }
            
            if (beforeCount > 3 && afterCount > 3) {
                avgBefore /= beforeCount;
                avgAfter /= afterCount;
                const avgSurrounding = (avgBefore + avgAfter) / 2;
                
                // If current position is significantly lower (higher Y value)
                if (smoothedHipY[i] - avgSurrounding > 0.02) {
                    hipMovements.push(i);
                }
            }
        }
        
        console.log(`Fallback method found ${hipMovements.length} potential movements`);
        troughs.push(...hipMovements);
    }

    if (troughs.length === 0) return [];

    const finalReps = [];
    console.log(`Processing ${troughs.length} potential reps`);
    
    for (const troughIndex of troughs) {
        const lmAtTrough = allLandmarks[troughIndex];
        if (!lmAtTrough) {
            console.log(`No landmarks at frame ${troughIndex}`);
            continue;
        }

        // VERY lenient visibility check
        const hipL = lmAtTrough[23]; const kneeL = lmAtTrough[25]; const ankleL = lmAtTrough[27];
        const hipR = lmAtTrough[24]; const kneeR = lmAtTrough[26]; const ankleR = lmAtTrough[28];
        
        const requiredVisibility = 0.4; // Very low threshold
        if (!hipL || !kneeL || !ankleL || !hipR || !kneeR || !ankleR) {
            console.log(`Missing landmarks at frame ${troughIndex}`);
            continue;
        }
        
        const avgVisibility = (hipL.visibility + kneeL.visibility + ankleL.visibility + 
                              hipR.visibility + kneeR.visibility + ankleR.visibility) / 6;
        
        if (avgVisibility < requiredVisibility) {
            console.log(`Low visibility (${avgVisibility.toFixed(2)}) at frame ${troughIndex}`);
            continue;
        }

        // Skip biomechanical check entirely for now - just check if we can calculate angles
        const proxyAtTrough = getLandmarkProxy(lmAtTrough);
        if (!proxyAtTrough) {
            console.log(`No proxy at frame ${troughIndex}`);
            continue;
        }

        // Calculate angles - accept any reasonable squat depth
        const leftDepth = calculateAngle(proxyAtTrough.left.hip, proxyAtTrough.left.knee, proxyAtTrough.left.ankle);
        const rightDepth = calculateAngle(proxyAtTrough.right.hip, proxyAtTrough.right.knee, proxyAtTrough.right.ankle);
        
        if (leftDepth === null && rightDepth === null) {
            console.log(`No angle calculation possible at frame ${troughIndex}`);
            continue;
        }
        
        // Use whichever angle we can calculate, or average if both available
        let avgDepth;
        if (leftDepth !== null && rightDepth !== null) {
            avgDepth = (leftDepth + rightDepth) / 2;
        } else {
            avgDepth = leftDepth !== null ? leftDepth : rightDepth;
        }
        
        // Very lenient depth requirement - accept almost any squat movement
        if (avgDepth > 150) { // Only reject very shallow movements
            console.log(`Too shallow (${avgDepth.toFixed(0)}°) at frame ${troughIndex}`);
            continue;
        }

        // Simplified rep boundary detection
        const startFrame = Math.max(0, troughIndex - 20);
        const endFrame = Math.min(allLandmarks.length - 1, troughIndex + 20);
        
        // Skip prominence check - we already found the movement
        
        // Simplified analysis - don't require perfect data
        let maxLeftValgus = 0, maxRightValgus = 0, totalSymmetryDiff = 0, symmetrySamples = 0;
        
        for (let i = startFrame; i <= endFrame; i++) {
            if (!allLandmarks[i]) continue;
            
            // Try to calculate valgus but don't fail if we can't
            try {
                const valgusState = calculateValgusState(allLandmarks[i], allWorldLandmarks[i]);
                if (valgusState.confidence > 0.3) { // Very low confidence threshold
                    maxLeftValgus = Math.max(maxLeftValgus, valgusState.left);
                    maxRightValgus = Math.max(maxRightValgus, valgusState.right);
                }
            } catch (e) {
                // Ignore valgus calculation errors
            }

            // Try to calculate symmetry
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

        console.log(`Adding rep at frame ${troughIndex} with depth ${avgDepth.toFixed(0)}°`);
        
        finalReps.push({
            startFrame, 
            endFrame, 
            depth: avgDepth,
            maxLeftValgus, 
            maxRightValgus,
            symmetry: symmetrySamples > 0 ? totalSymmetryDiff / symmetrySamples : 5, // Default to reasonable symmetry
            confidence: avgVisibility
        });
    }
    
    console.log(`Final analysis: ${finalReps.length} valid reps detected`);
    return finalReps;
}