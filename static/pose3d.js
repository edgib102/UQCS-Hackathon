import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.157.0/build/three.module.js";

let scene, camera, renderer, skeletonGroup;
const jointSpheres = [];
const boneLines = [];

// Landmark connections based on MediaPipe Pose indexes
const CONNECTIONS = [
    // Left side
    [11, 13], [13, 15], [23, 25], [25, 27], [27, 29], [29, 31], [11, 23],
    // Right side
    [12, 14], [14, 16], [24, 26], [26, 28], [28, 30], [30, 32], [12, 24],
    // Center
    [11, 12], [23, 24]
];

// Define landmark colors and indices for styling the skeleton
const LANDMARK_COLORS = {
    LEFT: new THREE.Color(0x00CFFF),   // Cyan
    RIGHT: new THREE.Color(0xFF9E00),  // Orange
    CENTER: new THREE.Color(0xDDDDDD) // White
};
const LEFT_INDICES = [11, 13, 15, 23, 25, 27, 29, 31];
const RIGHT_INDICES = [12, 14, 16, 24, 26, 28, 30, 32];
const FOOT_INDICES = [29, 30, 31, 32]; // Heels and foot tips

export function init3DScene(canvas) {
    // --- Scene Setup ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    // --- Camera ---
    camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 2.5);

    // --- Renderer ---
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // --- Lighting ---
    scene.add(new THREE.DirectionalLight(0xffffff, 0.8));
    scene.add(new THREE.AmbientLight(0x404040, 2));

    // --- Ground ---
    const gridHelper = new THREE.GridHelper(5, 10, 0x888888, 0x444444);
    scene.add(gridHelper);

    // --- Skeleton Group (container for all joints and bones) ---
    skeletonGroup = new THREE.Group();
    scene.add(skeletonGroup);

    // --- Create Skeleton ---
    const sphereGeo = new THREE.SphereGeometry(0.025, 8, 8);
    for (let i = 0; i < 33; i++) {
        let color = LANDMARK_COLORS.CENTER;
        if (LEFT_INDICES.includes(i)) color = LANDMARK_COLORS.LEFT;
        else if (RIGHT_INDICES.includes(i)) color = LANDMARK_COLORS.RIGHT;

        const sphere = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color }));
        jointSpheres.push(sphere);
        skeletonGroup.add(sphere);
    }

    CONNECTIONS.forEach(conn => {
        let color = LANDMARK_COLORS.CENTER;
        if (LEFT_INDICES.includes(conn[0])) color = LANDMARK_COLORS.LEFT;
        else if (RIGHT_INDICES.includes(conn[0])) color = LANDMARK_COLORS.RIGHT;

        const line = new THREE.Line(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color, linewidth: 2 })
        );
        boneLines.push(line);
        skeletonGroup.add(line);
    });

    // --- Render Loop ---
    const animate = () => {
        requestAnimationFrame(animate);
        skeletonGroup.rotation.y += 0.005; // slow rotation
        renderer.render(scene, camera);
    };
    animate();
}

/**
 * Updates the 3D skeleton's joint positions based on MediaPipe landmarks.
 * @param {object[]} landmarks - The poseWorldLandmarks from MediaPipe results.
 */
export function updateSkeleton(landmarks) {
    if (!landmarks || jointSpheres.length === 0) return;

    let lowestY = Infinity;

    // --- Update joint positions relative to the skeleton's container ---
    landmarks.forEach((lm, i) => {
        const joint = jointSpheres[i];
        joint.position.set(-lm.x, -lm.y, -lm.z);
        joint.visible = lm.visibility > 0.5;

        // **FIX**: Find the lowest point among the feet for stable grounding
        if (FOOT_INDICES.includes(i) && joint.visible && joint.position.y < lowestY) {
            lowestY = joint.position.y;
        }
    });

    // --- Update bone connections ---
    CONNECTIONS.forEach((conn, idx) => {
        const start = landmarks[conn[0]];
        const end = landmarks[conn[1]];
        const line = boneLines[idx];
        
        if (start.visibility > 0.5 && end.visibility > 0.5) {
            line.geometry.setFromPoints([
                jointSpheres[conn[0]].position,
                jointSpheres[conn[1]].position
            ]);
            line.visible = true;
        } else {
            line.visible = false;
        }
    });

    // **FIX**: Position the entire skeleton group based on the lowest foot point.
    // This is stable and prevents the rapid vertical flickering.
    if (isFinite(lowestY)) {
        skeletonGroup.position.y = -lowestY;
    }

    // **IMPROVEMENT**: Make the camera smoothly track the hips for a better view.
    const leftHip = jointSpheres[23].position;
    const rightHip = jointSpheres[24].position;
    if (jointSpheres[23].visible && jointSpheres[24].visible) {
        const hipCenterX = (leftHip.x + rightHip.x) / 2;
        const hipCenterY = (leftHip.y + rightHip.y) / 2 + skeletonGroup.position.y;
        const hipCenterZ = (leftHip.z + rightHip.z) / 2;
        camera.lookAt(hipCenterX, hipCenterY, hipCenterZ);
    }
}