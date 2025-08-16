// pose3d.js

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.157.0/build/three.module.js";

// --- Configuration for the Skeleton ---
const CONNECTIONS = [
    [11, 13], [13, 15], [23, 25], [25, 27], [27, 29], [29, 31], [11, 23],
    [12, 14], [14, 16], [24, 26], [26, 28], [28, 30], [30, 32], [12, 24],
    [11, 12], [23, 24]
];
const LANDMARK_COLORS = {
    LEFT: new THREE.Color(0x00CFFF),
    RIGHT: new THREE.Color(0xFF9E00),
    CENTER: new THREE.Color(0xe0e0e0)
};
const LEFT_INDICES = [11, 13, 15, 23, 25, 27, 29, 31];
const RIGHT_INDICES = [12, 14, 16, 24, 26, 28, 30, 32];
const FOOT_INDICES = [29, 30, 31, 32];

const LEG_CONNECTIONS = [
    [23, 25], [25, 27], // Left Leg
    [24, 26], [26, 28]  // Right Leg
];
const legConnectionSet = new Set(LEG_CONNECTIONS.map(conn => JSON.stringify(conn.sort())));

class PoseScene {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.options = { autoRotate: false, ...options };
        this.jointSpheres = [];
        this.boneLines = [];
        this._init();
    }

    _init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);
        this.camera = new THREE.PerspectiveCamera(75, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 1.5, 2.5);
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        
        this.scene.add(new THREE.DirectionalLight(0xffffff, 0.8));
        this.scene.add(new THREE.AmbientLight(0x404040, 2));
        this.scene.add(new THREE.GridHelper(5, 10, 0x888888, 0x444444));

        this.skeletonGroup = new THREE.Group();
        this.scene.add(this.skeletonGroup);

        this._createSkeleton();

        const animate = () => {
            requestAnimationFrame(animate);
            if (this.options.autoRotate) {
                this.skeletonGroup.rotation.y += 0.005;
            }
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }

    _createSkeleton() {
        const sphereGeo = new THREE.SphereGeometry(0.025, 8, 8);
        for (let i = 0; i < 33; i++) {
            let color = LANDMARK_COLORS.CENTER;
            if (LEFT_INDICES.includes(i)) color = LANDMARK_COLORS.LEFT;
            else if (RIGHT_INDICES.includes(i)) color = LANDMARK_COLORS.RIGHT;
            const sphere = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color }));
            this.jointSpheres.push(sphere);
            this.skeletonGroup.add(sphere);
        }

        CONNECTIONS.forEach(conn => {
            let color;
            const isShoulderLine = (conn.includes(11) && conn.includes(12));
            const isHipLine = (conn.includes(23) && conn.includes(24));

            if (isShoulderLine || isHipLine) {
                color = LANDMARK_COLORS.CENTER; 
            } else if (LEFT_INDICES.includes(conn[0])) { 
                color = LANDMARK_COLORS.LEFT;
            } else if (RIGHT_INDICES.includes(conn[0])) { 
                color = LANDMARK_COLORS.RIGHT;
            } else {
                color = LANDMARK_COLORS.CENTER; 
            }

            const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, linewidth: 2 }));
            this.boneLines.push(line);
            this.skeletonGroup.add(line);
        });
    }

    update(landmarks) {
        if (!landmarks || this.jointSpheres.length === 0) return;

        let lowestY = Infinity;

        landmarks.forEach((lm, i) => {
            const joint = this.jointSpheres[i];
            // --- FIX: Safely handle null landmarks ---
            if (lm) {
                joint.position.set(-lm.x, -lm.y, -lm.z);
                joint.visible = lm.visibility > 0.5;
                if (FOOT_INDICES.includes(i) && joint.visible && joint.position.y < lowestY) {
                    lowestY = joint.position.y;
                }
            } else {
                joint.visible = false;
            }
        });

        CONNECTIONS.forEach((conn, idx) => {
            const start = landmarks[conn[0]];
            const end = landmarks[conn[1]];
            const line = this.boneLines[idx];
            // --- FIX: Safely handle null start/end landmarks for connections ---
            if (start && end && start.visibility > 0.5 && end.visibility > 0.5) {
                line.geometry.setFromPoints([this.jointSpheres[conn[0]].position, this.jointSpheres[conn[1]].position]);
                line.visible = true;
            } else {
                line.visible = false;
            }
        });

        if (isFinite(lowestY)) {
            this.skeletonGroup.position.y = -lowestY;
        }
        
        const leftHip = this.jointSpheres[23];
        const rightHip = this.jointSpheres[24];
        if (leftHip.visible && rightHip.visible) {
            const hipCenter = new THREE.Vector3().addVectors(leftHip.position, rightHip.position).multiplyScalar(0.5);
            hipCenter.y += this.skeletonGroup.position.y;
            this.camera.lookAt(hipCenter);
        }
    }
    
    updateColors(hasKneeValgus) {
        const valgusColor = new THREE.Color(0xFF4136);
        
        CONNECTIONS.forEach((conn, idx) => {
            const line = this.boneLines[idx];
            const connKey = JSON.stringify(conn.slice().sort());

            if (legConnectionSet.has(connKey)) {
                let originalColor;
                if (LEFT_INDICES.includes(conn[0])) {
                    originalColor = LANDMARK_COLORS.LEFT;
                } else if (RIGHT_INDICES.includes(conn[0])) {
                    originalColor = LANDMARK_COLORS.RIGHT;
                } else {
                    originalColor = LANDMARK_COLORS.CENTER;
                }
                line.material.color.set(hasKneeValgus ? valgusColor : originalColor);
            }
        });
    }
}

export function createLiveScene(canvas) {
    return new PoseScene(canvas, { autoRotate: true });
}

export function createPlaybackScene(canvas) {
    return new PoseScene(canvas, { autoRotate: false });
}