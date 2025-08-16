import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.157.0/build/three.module.js";

let scene, camera, renderer, skeletonGroup;
const jointSpheres = [];
const boneLines = [];

/** 
 * Define left, right, and center landmark connections (based on MediaPipe Pose indexes).
 */
const LEFT_CONNECTIONS = [
  [11, 13], [13, 15],   // left arm
  [23, 25], [25, 27],   // left leg
  [27, 29], [29, 31],   // left foot
  [11, 23]              // left torso
];

const RIGHT_CONNECTIONS = [
  [12, 14], [14, 16],   // right arm
  [24, 26], [26, 28],   // right leg
  [28, 30], [30, 32],   // right foot
  [12, 24]              // right torso
];

const CENTER_CONNECTIONS = [
  [11, 12], // shoulders
  [23, 24], // hips
  [11, 23], [12, 24]    // vertical torso
];

/**
 * Assign landmark indices to left/right/center for coloring joints.
 */
const LEFT_LANDMARKS = [11, 13, 15, 23, 25, 27, 29, 31];
const RIGHT_LANDMARKS = [12, 14, 16, 24, 26, 28, 30, 32];
const CENTER_LANDMARKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24];

/**
 * Initializes the Three.js scene, camera, and renderer.
 * @param {HTMLCanvasElement} canvas - The canvas element to render the 3D scene on.
 */
export function init3DScene(canvas) {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    // Camera
    camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 2);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Lights
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(0, 5, 5);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040, 1.5));

    // Ground grid
    const gridHelper = new THREE.GridHelper(5, 10, 0x888888, 0x444444);
    scene.add(gridHelper);

    // Skeleton container
    skeletonGroup = new THREE.Group();
    scene.add(skeletonGroup);

    // Materials
    const leftMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff });  // cyan
    const rightMaterial = new THREE.LineBasicMaterial({ color: 0xffa500 }); // orange
    const centerMaterial = new THREE.LineBasicMaterial({ color: 0xff00ff }); // magenta

    const leftSphereMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const rightSphereMat = new THREE.MeshBasicMaterial({ color: 0xffa500 });
    const centerSphereMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });

    // Create joint spheres (33 landmarks in Mediapipe Pose)
    const sphereGeo = new THREE.SphereGeometry(0.02, 8, 8);
    for (let i = 0; i < 33; i++) {
        let mat;
        if (LEFT_LANDMARKS.includes(i)) {
            mat = leftSphereMat;
        } else if (RIGHT_LANDMARKS.includes(i)) {
            mat = rightSphereMat;
        } else {
            mat = centerSphereMat;
        }
        const sphere = new THREE.Mesh(sphereGeo, mat);
        jointSpheres.push(sphere);
        skeletonGroup.add(sphere);
    }

    // Helper function to add bone lines
    function addConnections(connections, material) {
        connections.forEach(() => {
            const points = [new THREE.Vector3(), new THREE.Vector3()];
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const line = new THREE.Line(geometry, material);
            boneLines.push(line);
            skeletonGroup.add(line);
        });
    }

    // Create bone lines
    addConnections(LEFT_CONNECTIONS, leftMaterial);
    addConnections(RIGHT_CONNECTIONS, rightMaterial);
    addConnections(CENTER_CONNECTIONS, centerMaterial);

    // Render loop
    function animate() {
        requestAnimationFrame(animate);
        if (skeletonGroup) {
            skeletonGroup.rotation.y += 0.005; // slow rotation
        }
        renderer.render(scene, camera);
    }
    animate();
}

/**
 * Updates the 3D skeleton's joint positions based on MediaPipe landmarks.
 * @param {object[]} landmarks - The poseWorldLandmarks from MediaPipe results.
 */
export function updateSkeleton(landmarks) {
    if (!landmarks || jointSpheres.length === 0) return;

    // Find min Y (lowest point) for foot alignment
    let minY = Infinity;
    landmarks.forEach(lm => {
        if (lm.visibility > 0.5) {
            const y = -(lm.y - 0.5) * 2;
            if (y < minY) minY = y;
        }
    });

    // Update joint positions
    landmarks.forEach((lm, i) => {
        if (lm.visibility > 0.5) {
            const x = (lm.x - 0.5) * 2;
            const y = (-(lm.y - 0.5) * 2) - minY; // shift so feet at ground
            const z = -lm.z * 2;
            jointSpheres[i].position.set(x, y, z);
        }
    });

    // Update bone positions in correct order
    const allConnections = [...LEFT_CONNECTIONS, ...RIGHT_CONNECTIONS, ...CENTER_CONNECTIONS];
    allConnections.forEach((conn, idx) => {
        const start = landmarks[conn[0]];
        const end = landmarks[conn[1]];
        if (start.visibility > 0.5 && end.visibility > 0.5) {
            const startPos = new THREE.Vector3(
                (start.x - 0.5) * 2,
                (-(start.y - 0.5) * 2) - minY,
                -start.z * 2
            );
            const endPos = new THREE.Vector3(
                (end.x - 0.5) * 2,
                (-(end.y - 0.5) * 2) - minY,
                -end.z * 2
            );
            boneLines[idx].geometry.setFromPoints([startPos, endPos]);
        }
    });

    // Auto-frame camera to skeleton center
    const box = new THREE.Box3().setFromObject(skeletonGroup);
    const center = box.getCenter(new THREE.Vector3());
    camera.lookAt(center);
}
