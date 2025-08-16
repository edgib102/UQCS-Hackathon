import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.157.0/build/three.module.js";

let scene, camera, renderer, skeletonGroup;
const jointSpheres = [];
const boneLines = [];

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

    // Ground
    const gridHelper = new THREE.GridHelper(5, 10, 0x888888, 0x444444);
    scene.add(gridHelper);

    // Skeleton container
    skeletonGroup = new THREE.Group();
    scene.add(skeletonGroup);

    // Create joint spheres (33 landmarks in Mediapipe Pose)
    const jointMaterial = new THREE.MeshBasicMaterial({ color: 0x9D00FF });
    const sphereGeo = new THREE.SphereGeometry(0.02, 8, 8);
    for (let i = 0; i < 33; i++) {
        const sphere = new THREE.Mesh(sphereGeo, jointMaterial);
        jointSpheres.push(sphere);
        skeletonGroup.add(sphere);
    }

    // Create bone lines for POSE_CONNECTIONS
    const boneMaterial = new THREE.LineBasicMaterial({ color: 0x9D00FF });
    POSE_CONNECTIONS.forEach(() => {
        const points = [new THREE.Vector3(), new THREE.Vector3()];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, boneMaterial);
        boneLines.push(line);
        skeletonGroup.add(line);
    });

    // Render loop
    function animate() {
        requestAnimationFrame(animate);
            // Rotate the skeleton group slowly
        if (skeletonGroup) {
            skeletonGroup.rotation.y += 0.01; // rotate around Y axis
            // skeletonGroup.rotation.x += 0.005; // uncomment if you also want tilt
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

    // Update bone positions
    POSE_CONNECTIONS.forEach((conn, idx) => {
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

    // Auto-frame camera
    const box = new THREE.Box3().setFromObject(skeletonGroup);
    const center = box.getCenter(new THREE.Vector3());
    camera.lookAt(center);
}
