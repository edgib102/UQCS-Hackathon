
import { analyzeSession, STANDING_THRESHOLD } from "./posedata.js";
import { renderHipHeightChart } from "./chart.js";

const SCORE_WEIGHTS = { depth: 30, symmetry: 25, valgus: 20, consistency: 25 };
const PLAYBACK_FPS = 30;

/**
 * Updates the UI with detailed feedback for a specific metric.
 */
function updateBreakdown(metric, score, weight, values) {
    const breakdownItem = document.getElementById(`breakdown-item-${metric}`);
    const scoreEl = document.getElementById(`breakdown-score-${metric}`);
    const descEl = document.getElementById(`breakdown-desc-${metric}`);
    const progressBar = breakdownItem.querySelector('.progress-bar');

    scoreEl.innerText = `${Math.round(score)}/${weight}`;
    
    const scorePercentage = (score / weight) * 100;
    progressBar.style.setProperty('--progress', `${scorePercentage}%`);

    let description = '';
    const performanceTier = score / weight; // 0.0 to 1.0

    switch (metric) {
        case 'depth':
            const { avgAngle } = values;
            if (performanceTier > 0.9) {
                description = `Fantastic depth! Your average angle of ${avgAngle.toFixed(0)}° shows an excellent range of motion. This is key for maximizing muscle activation.`;
            } else if (performanceTier > 0.65) {
                description = `Good depth. You're reaching ${avgAngle.toFixed(0)}° on average. Focus on sinking your hips just a little lower to get parallel (90°) for even better results.`;
            } else {
                description = `Your depth is currently shallow at ${avgAngle.toFixed(0)}°. Work on flexibility and control to lower your hips until your thighs are parallel with the floor.`;
            }
            break;

        case 'symmetry':
            const { avgPercent } = values;
            if (performanceTier > 0.9) {
                description = `Excellent balance! With ${avgPercent.toFixed(0)}% symmetry, your form is very stable and weight is evenly distributed. Keep it up!`;
            } else if (performanceTier > 0.65) {
                description = `Good symmetry (${avgPercent.toFixed(0)}%). There's a slight imbalance. Try focusing on pushing the ground away with both feet equally, especially as you stand up.`;
            } else {
                description = `A significant imbalance was detected (${avgPercent.toFixed(0)}%). You might be favoring one side. This can lead to injury. Try squatting without weight to rebuild a stable foundation.`;
            }
            break;

        case 'valgus':
            const { count, totalReps } = values;
            if (count === 0) {
                description = `Perfect knee stability! Your knees tracked perfectly over your feet on all ${totalReps} reps. This is crucial for long-term joint health.`;
            } else if (count <= 2 && totalReps > 5) {
                description = `Good stability. Your knees caved in on ${count} rep${count > 1 ? 's' : ''}. This often happens with fatigue. Focus on actively pushing your knees outwards.`;
            } else {
                description = `Your knees caved inwards on ${count} of ${totalReps} reps. This is a common issue called "knee valgus" and increases injury risk. Strengthen your glutes and focus on pushing your knees out.`;
            }
            break;

        case 'consistency':
            const { stdDev } = values;
            if (performanceTier > 0.9) {
                description = `Incredibly consistent! Your depth varied by only ${stdDev.toFixed(1)}°. Every rep was a mirror of the last. This is professional-level form.`;
            } else if (performanceTier > 0.65) {
                description = `Good consistency. A variation of ${stdDev.toFixed(1)}° was detected. This is normal for most lifters. Focus on maintaining the same tempo and depth cues.`;
            } else {
                description = `Your form varied by ${stdDev.toFixed(1)}°. This suggests some inconsistency in your movement pattern. Try focusing on a consistent tempo and depth marker.`;
            }
            break;
    }
    descEl.innerText = description;
}


/**
 * Analyzes session data, calculates scores, and updates the report UI.
 * @param {object} sessionData - An object containing all the recorded data from the session.
 * @returns {object|null} An object with processed data and chart instance, or null if analysis fails.
 */
export function processAndRenderReport(sessionData) {
    let { recordedPoseLandmarks, recordedWorldLandmarks, hipHeightData, symmetryData, valgusData, frameCounter } = sessionData;

    const finalRepHistory = analyzeSession(recordedPoseLandmarks, recordedWorldLandmarks);
    if (finalRepHistory.length === 0) {
        console.error("No valid squats were detected in the session.");
        return null; // This null value is what the script.js check relies on
    }

    // --- Data Cropping ---
    const firstSquatStartFrame = finalRepHistory[0].startFrame;
    const lastSquatEndFrame = finalRepHistory[finalRepHistory.length - 1].endFrame;
    const bufferFrames = Math.round(0.1 * PLAYBACK_FPS);
    const cropStartFrame = Math.max(0, firstSquatStartFrame - bufferFrames);
    const cropEndFrame = Math.min(frameCounter, lastSquatEndFrame + bufferFrames);

    const playbackOffset = cropStartFrame;
    recordedWorldLandmarks = recordedWorldLandmarks.slice(cropStartFrame, cropEndFrame);
    recordedPoseLandmarks = recordedPoseLandmarks.slice(cropStartFrame, cropEndFrame);
    hipHeightData = hipHeightData.slice(cropStartFrame, cropEndFrame);
    symmetryData = symmetryData.slice(cropStartFrame, cropEndFrame);
    valgusData = valgusData.slice(cropStartFrame, cropEndFrame);

    // --- Scoring Logic ---
    const SQUAT_IDEAL_DEPTH = 90;
    const SQUAT_ATG_DEPTH = 75;
    const avgDepthAngle = finalRepHistory.reduce((sum, rep) => sum + rep.depth, 0) / finalRepHistory.length;
    const getDepthProgress = (angle) => {
        if (angle >= STANDING_THRESHOLD) return 0;
        if (angle <= SQUAT_IDEAL_DEPTH) return 1.0;
        return Math.sqrt((STANDING_THRESHOLD - angle) / (STANDING_THRESHOLD - SQUAT_IDEAL_DEPTH));
    };
    const baseProgress = getDepthProgress(avgDepthAngle);
    const atgBonus = avgDepthAngle < SQUAT_IDEAL_DEPTH ? ((SQUAT_IDEAL_DEPTH - Math.max(SQUAT_ATG_DEPTH, avgDepthAngle)) / (SQUAT_IDEAL_DEPTH - SQUAT_ATG_DEPTH)) * 0.1 : 0;
    const depthScore = Math.min(1.0, baseProgress + atgBonus) * SCORE_WEIGHTS.depth;
    const avgSymmetryDiff = finalRepHistory.reduce((s, r) => s + r.symmetry, 0) / finalRepHistory.length;
    const avgSymmetryPercent = 100 * Math.exp(-0.05 * avgSymmetryDiff);
    const symmetryScore = (avgSymmetryPercent / 100) * SCORE_WEIGHTS.symmetry;
    const VALGUS_THRESHOLD = 0.12;
    const SEVERE_VALGUS = 0.25;
    let valgusScore = SCORE_WEIGHTS.valgus;
    let valgusCount = 0;
    finalRepHistory.forEach(rep => {
        const maxValgus = Math.max(rep.maxLeftValgus, rep.maxRightValgus);
        if (maxValgus > VALGUS_THRESHOLD) {
            valgusCount++;
            let penalty = SCORE_WEIGHTS.valgus / Math.max(8, finalRepHistory.length);
            if (maxValgus > SEVERE_VALGUS) penalty *= 2.0;
            else if (maxValgus > VALGUS_THRESHOLD * 1.5) penalty *= 1.5;
            valgusScore -= penalty;
        }
    });
    valgusScore = Math.max(0, valgusScore);
    const depths = finalRepHistory.map(r => r.depth);
    const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
    const stdDev = depths.length > 1 ? Math.sqrt(depths.map(x => Math.pow((x - avgDepth) * 1.2, 2)).reduce((a, b) => a + b) / (depths.length - 1)) : 0;
    const EXCELLENT_STD_DEV = 5, GOOD_STD_DEV = 12, MAX_ACCEPTABLE_STD_DEV = 20;
    let consistencyProgress;
    if (stdDev <= EXCELLENT_STD_DEV) consistencyProgress = 1.0;
    else if (stdDev <= GOOD_STD_DEV) consistencyProgress = 0.8 + 0.2 * (GOOD_STD_DEV - stdDev) / (GOOD_STD_DEV - EXCELLENT_STD_DEV);
    else if (stdDev <= MAX_ACCEPTABLE_STD_DEV) consistencyProgress = 0.3 + 0.5 * (MAX_ACCEPTABLE_STD_DEV - stdDev) / (MAX_ACCEPTABLE_STD_DEV - GOOD_STD_DEV);
    else consistencyProgress = Math.max(0, 0.3 * Math.exp(-0.1 * (stdDev - MAX_ACCEPTABLE_STD_DEV)));
    const consistencyScore = consistencyProgress * SCORE_WEIGHTS.consistency;
    
    // MODIFIED: The overall score is now a direct sum of the individual scores.
    const totalScore = Math.round(depthScore + symmetryScore + valgusScore + consistencyScore);

    // --- UI Updates ---
    const scoreValueEl = document.getElementById('report-score-value');
    const scoreCircle = document.querySelector('.score-circle');
    const endScore = totalScore;
    const duration = 1500; // Animation duration in milliseconds

    // 1. Animate the score number using JavaScript
    let startTime = null;
    const animateNumber = (timestamp) => {
        if (!startTime) startTime = timestamp;
        const elapsedTime = timestamp - startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        const currentScore = Math.round(progress * endScore);
        
        scoreValueEl.innerText = currentScore;

        if (progress < 1) {
            requestAnimationFrame(animateNumber);
        }
    };
    requestAnimationFrame(animateNumber);

    // 2. Trigger the CSS animation for the circle and the nub
    // A small delay helps ensure the browser registers the initial state before animating
    setTimeout(() => {
        scoreCircle.style.setProperty('--p', endScore);
    }, 10);


    let qualityText = "Needs Improvement";
    if (totalScore > 85) qualityText = "Excellent";
    else if (totalScore > 75) qualityText = "Very Good";
    else if (totalScore > 60) qualityText = "Good";
    else if (totalScore > 45) qualityText = "Fair";

    document.getElementById('report-quality-overall').innerText = qualityText;
    document.getElementById('report-depth-avg').innerText = `${avgDepthAngle.toFixed(0)}°`;
    document.getElementById('report-symmetry-avg').innerText = `${avgSymmetryPercent.toFixed(0)}%`;
    document.getElementById('report-valgus-count').innerText = `${valgusCount} of ${finalRepHistory.length} reps`;

    updateBreakdown('depth', depthScore, SCORE_WEIGHTS.depth, { avgAngle: avgDepthAngle });
    updateBreakdown('symmetry', symmetryScore, SCORE_WEIGHTS.symmetry, { avgPercent: avgSymmetryPercent });
    updateBreakdown('valgus', valgusScore, SCORE_WEIGHTS.valgus, { count: valgusCount, totalReps: finalRepHistory.length });
    updateBreakdown('consistency', consistencyScore, SCORE_WEIGHTS.consistency, { stdDev });

    // --- Generate and Display Summary and Improvement Text ---
    const summaryEl = document.getElementById('summary-text');
    const improvementEl = document.getElementById('improvement-text');

    let summary = '';
    if (totalScore > 85) {
        summary = `This was an excellent set of ${finalRepHistory.length} reps. Your form is solid across the board, showing great control and technique. Keep up the fantastic work!`;
    } else if (totalScore > 60) {
        summary = `A solid performance over ${finalRepHistory.length} reps. Your overall form is good, but there are a few key areas where you can make improvements to increase your score and reduce injury risk.`;
    } else {
        summary = `This set of ${finalRepHistory.length} reps is a good starting point. We've identified some significant areas for improvement that will help you build a stronger, safer squat.`;
    }
    summaryEl.innerText = summary;

    const scores = {
        depth: depthScore / SCORE_WEIGHTS.depth,
        symmetry: symmetryScore / SCORE_WEIGHTS.symmetry,
        valgus: valgusScore / SCORE_WEIGHTS.valgus,
        consistency: consistencyScore / SCORE_WEIGHTS.consistency
    };

    const lowestMetric = Object.keys(scores).reduce((a, b) => scores[a] < scores[b] ? a : b);

    let improvement = '';
    switch (lowestMetric) {
        case 'depth':
            improvement = 'Your biggest opportunity is in achieving greater depth. Focus on ankle and hip mobility exercises. Try to lower your hips until they are at least parallel with your knees.';
            break;
        case 'symmetry':
            improvement = 'Improving your symmetry is the top priority. You may be shifting your weight to one side. Try focusing on a "tripod foot" cue (big toe, little toe, and heel) to distribute pressure evenly.';
            break;
        case 'valgus':
            improvement = 'Focus on knee stability. The tendency for your knees to cave inward (valgus) is the most critical area to address. Strengthen your glutes with exercises like banded side walks and consciously push your knees out during the entire squat.';
            break;
        case 'consistency':
            improvement = 'Work on making every rep look the same. Your form varies between reps, which can lead to instability. Try using a consistent tempo (e.g., counting "3-2-1" down and "1" up) to standardize your movement.';
            break;
    }
    improvementEl.innerText = improvement;


    // --- Chart Rendering ---
    const hipHeightChartCanvas = document.getElementById('hipHeightChart');
    const chartInstance = renderHipHeightChart(hipHeightChartCanvas, hipHeightData, symmetryData, valgusData);

    // --- Return Processed Data ---
    return {
        finalRepHistory,
        playbackOffset,
        chartInstance,
        croppedData: {
            recordedWorldLandmarks,
            recordedPoseLandmarks,
            hipHeightData,
            symmetryData,
            valgusData,
        }
    };
}
