import * as THREE from 'three';

/**
 * Creates and manages an interactive 3D particle network background.
 * The particles and lines react to mouse movement.
 * Includes methods to start and stop the animation loop to save resources.
 */
class LandingBackground {
    constructor(canvas) {
        this.canvas = canvas;
        this.mouse = new THREE.Vector2();
        this.target = new THREE.Vector3();
        this.raycaster = new THREE.Raycaster();
        this.animationId = null; // To hold the requestAnimationFrame ID
        this.init();
    }

    /**
     * Initializes the scene, camera, renderer, and objects.
     */
    init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x030712); // gray-950

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 15;

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.createParticles();
        this.createLines();

        window.addEventListener('mousemove', this.onMouseMove.bind(this));
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start the animation automatically
        this.start();
    }

    /**
     * Starts the animation loop if it's not already running.
     */
    start() {
        if (!this.animationId) {
            this.animate();
        }
    }

    /**
     * Stops the animation loop to conserve browser resources.
     */
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    /**
     * Creates the particle system (the points in the network).
     */
    createParticles() {
        this.particleCount = 300;
        const positions = new Float32Array(this.particleCount * 3);
        this.velocities = new Float32Array(this.particleCount * 3);
        this.initialPositions = new Float32Array(this.particleCount * 3);

        const spread = 20;
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            positions[i3] = (Math.random() - 0.5) * spread;
            positions[i3 + 1] = (Math.random() - 0.5) * spread;
            positions[i3 + 2] = (Math.random() - 0.5) * spread;

            this.initialPositions[i3] = positions[i3];
            this.initialPositions[i3 + 1] = positions[i3 + 1];
            this.initialPositions[i3 + 2] = positions[i3 + 2];
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0x818cf8, // indigo-400
            size: 0.1,
            transparent: true,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
    }

    /**
     * Creates the lines connecting the particles (the "plexus" effect).
     */
    createLines() {
        const particlePositions = this.particles.geometry.attributes.position.array;
        const connectionDistance = 2.5;
        this.lineConnections = [];

        for (let i = 0; i < this.particleCount; i++) {
            for (let j = i + 1; j < this.particleCount; j++) {
                const i3 = i * 3;
                const j3 = j * 3;
                const dx = particlePositions[i3] - particlePositions[j3];
                const dy = particlePositions[i3 + 1] - particlePositions[j3 + 1];
                const dz = particlePositions[i3 + 2] - particlePositions[j3 + 2];
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (distance < connectionDistance) {
                    this.lineConnections.push(i, j);
                }
            }
        }

        const linePositions = new Float32Array(this.lineConnections.length * 3);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

        const material = new THREE.LineBasicMaterial({
            color: 0x4f46e5, // indigo-700
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending
        });

        this.lines = new THREE.LineSegments(geometry, material);
        this.scene.add(this.lines);
    }

    /**
     * Updates the mouse position on move.
     */
    onMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    /**
     * Handles window resizing to keep the scene responsive.
     */
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }

    /**
     * The main animation loop, called on every frame.
     */
    animate() {
        this.animationId = requestAnimationFrame(this.animate.bind(this));

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        this.raycaster.ray.intersectPlane(plane, this.target);
        
        const particlePositions = this.particles.geometry.attributes.position.array;
        const linePositions = this.lines.geometry.attributes.position.array;
        
        for (let i = 0; i < this.particleCount; i++) {
            const i3 = i * 3;
            const p = new THREE.Vector3(particlePositions[i3], particlePositions[i3 + 1], particlePositions[i3 + 2]);

            const distanceToMouse = this.target.distanceTo(p);
            const mouseForce = Math.max(0, 1 - distanceToMouse / 8);
            this.velocities[i3] += (this.target.x - p.x) * 0.0002 * mouseForce;
            this.velocities[i3 + 1] += (this.target.y - p.y) * 0.0002 * mouseForce;

            this.velocities[i3] += (this.initialPositions[i3] - p.x) * 0.0001;
            this.velocities[i3 + 1] += (this.initialPositions[i3 + 1] - p.y) * 0.0001;
            this.velocities[i3 + 2] += (this.initialPositions[i3 + 2] - p.z) * 0.0001;

            particlePositions[i3] += this.velocities[i3];
            particlePositions[i3 + 1] += this.velocities[i3 + 1];
            particlePositions[i3 + 2] += this.velocities[i3 + 2];

            this.velocities[i3] *= 0.96;
            this.velocities[i3 + 1] *= 0.96;
            this.velocities[i3 + 2] *= 0.96;
        }

        for (let i = 0; i < this.lineConnections.length / 2; i++) {
            const i2 = i * 2;
            const startIdx = this.lineConnections[i2];
            const endIdx = this.lineConnections[i2 + 1];
            const start3 = startIdx * 3;
            const end3 = endIdx * 3;
            const lineStart3 = i * 6;
            const lineEnd3 = lineStart3 + 3;
            linePositions[lineStart3] = particlePositions[start3];
            linePositions[lineStart3 + 1] = particlePositions[start3 + 1];
            linePositions[lineStart3 + 2] = particlePositions[start3 + 2];
            linePositions[lineEnd3] = particlePositions[end3];
            linePositions[lineEnd3 + 1] = particlePositions[end3 + 1];
            linePositions[lineEnd3 + 2] = particlePositions[end3 + 2];
        }

        this.particles.geometry.attributes.position.needsUpdate = true;
        this.lines.geometry.attributes.position.needsUpdate = true;
        
        this.camera.position.x += (this.mouse.x * 0.5 - this.camera.position.x) * 0.05;
        this.camera.position.y += (this.mouse.y * 0.5 - this.camera.position.y) * 0.05;
        this.camera.lookAt(this.scene.position);

        this.renderer.render(this.scene, this.camera);
    }
}

// Instantiate the class and export the instance so it can be controlled from script.js
const canvas = document.getElementById('landing-bg-canvas');
const landingBackground = canvas ? new LandingBackground(canvas) : null;
export default landingBackground;