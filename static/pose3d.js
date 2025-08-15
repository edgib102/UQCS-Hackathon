// --- Constants ---
// This is used by MediaPipe's drawing utils and needs to be available globally.
window.POSE_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,7], [0,4],[4,5],[5,6],[6,8], [9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[11,23],[12,24],
  [23,24],[23,25],[24,26],[25,27],[26,28],[27,29],[28,30],
  [29,31],[30,32]
];

// --- THREE.js Scene Variables ---
let scene, camera, renderer;
const joints = [];
const lines = [];

/**
 * Initializes the THREE.js scene, camera, and renderer for 3D pose visualization.
 */
export function init3DScene() {
    const canvas = document.getElementById('pose3dCanvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
    camera.position.set(0, 0, 1.5); // Adjusted camera position for better view

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(canvas.width, canvas.height);

    // Create spheres for each landmark joint
    const jointGeometry = new THREE.SphereGeometry(0.015, 16, 16);
    const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    for (let i = 0; i < 33; i++) {
        const joint = new THREE.Mesh(jointGeometry, jointMaterial);
        joints.push(joint);
        scene.add(joint);
    }

    // Create lines for bone connections
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
    POSE_CONNECTIONS.forEach(([startIdx, endIdx]) => {
        const points = [new THREE.Vector3(), new THREE.Vector3()];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, lineMaterial);
        lines.push({ line, startIdx, endIdx });
        scene.add(line);
    });
    
    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
    animate();
}

/**
 * Updates the positions of the 3D joints and lines based on new landmark data.
 * @param {object[]} landmarks - The array of pose landmarks from MediaPipe.
 */
export function update3DScene(landmarks) {
    if (!landmarks || joints.length === 0) return;

    // Update joint positions
    landmarks.forEach((lm, idx) => {
        // Center the pose and invert Y-axis for correct orientation
        joints[idx].position.set(lm.x - 0.5, -lm.y + 0.5, -lm.z);
    });

    // Update line positions
    lines.forEach(({ line, startIdx, endIdx }) => {
        const startPos = joints[startIdx].position;
        const endPos = joints[endIdx].position;
        const positions = line.geometry.attributes.position;
        positions.setXYZ(0, startPos.x, startPos.y, startPos.z);
        positions.setXYZ(1, endPos.x, endPos.y, endPos.z);
        positions.needsUpdate = true;
    });
}