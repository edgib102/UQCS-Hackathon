import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.157.0/build/three.module.js";
// ERROR REMOVED: The 'POSE_CONNECTIONS' constant is available globally from the script tag in index.html, so it doesn't need to be imported here.

let scene, camera, renderer, skeletonLine;

/**
 * Initializes the Three.js scene, camera, and renderer.
 * @param {HTMLCanvasElement} canvas - The canvas element to render the 3D scene on.
 */
export function init3DScene(canvas) {
    // --- Scene and Camera ---
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    camera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 2);

    // --- Renderer ---
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // --- Helpers ---
    const gridHelper = new THREE.GridHelper(10, 10, 0x888888, 0x444444);
    scene.add(gridHelper);

    // --- Skeleton Line ---
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
    const geometry = new THREE.BufferGeometry();
    skeletonLine = new THREE.LineSegments(geometry, material);
    scene.add(skeletonLine);

    // --- Resize Handler ---
    const resizeObserver = new ResizeObserver(entries => {
        const entry = entries[0];
        const { width, height } = entry.contentRect;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    });
    resizeObserver.observe(canvas.parentElement);

    // --- Render Loop ---
    function animate() {
        requestAnimationFrame(animate);
        renderer.render(scene, camera);
    }
    animate();
}

/**
 * Updates the 3D skeleton's joint positions based on MediaPipe landmarks.
 * @param {object[]} landmarks - The poseWorldLandmarks from MediaPipe results.
 */
export function updateSkeleton(landmarks) {
    if (!landmarks || !skeletonLine) return;

    const positions = [];
    
    // Create a line for each connection in the skeleton
    // 'POSE_CONNECTIONS' is used here directly from the global scope.
    POSE_CONNECTIONS.forEach(conn => {
        const start = landmarks[conn[0]];
        const end = landmarks[conn[1]];
        
        // Ensure both landmarks are visible before drawing a line
        if (start.visibility > 0.5 && end.visibility > 0.5) {
            positions.push((start.x - 0.5) * 2, -(start.y - 0.5) * 2, -start.z * 2);
            positions.push((end.x - 0.5) * 2, -(end.y - 0.5) * 2, -end.z * 2);
        }
    });
    
    skeletonLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    skeletonLine.geometry.computeBoundingSphere();

    // --- Auto-framing Camera ---
    const sphere = skeletonLine.geometry.boundingSphere;
    if (sphere) {
        const center = sphere.center;
        const radius = sphere.radius;
        
        camera.lookAt(center);

        const distance = radius * 2.5;
        camera.position.set(center.x, center.y, center.z + distance);
    }
}