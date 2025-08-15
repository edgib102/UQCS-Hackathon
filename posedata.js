// This function receives pose landmarks from script.js
function handlePoseData(landmarks) {
    // landmarks is an array of 33 objects, each with {x, y, z, visibility}
    // Example: log hip position
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    console.log("Left Hip:", leftHip);
    console.log("Right Hip:", rightHip);

    // TODO: Add squat counting, depth calculation, and ankle mobility here
}
