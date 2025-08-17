// pose3d.js

// Use the mapped imports, which are now resolved by the import map
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";


// --- VISUAL ENHANCEMENT: Softer, more professional color palette ---
const CONNECTIONS = [
    [11, 13], [13, 15], [23, 25], [25, 27], [27, 29], [29, 31], [11, 23],
    [12, 14], [14, 16], [24, 26], [26, 28], [28, 30], [30, 32], [12, 24],
    [11, 12], [23, 24]
];
const LANDMARK_COLORS = {
    LEFT: new THREE.Color(0x6495ED), // Cornflower Blue
    RIGHT: new THREE.Color(0xFFB347), // Apricot Orange
    CENTER: new THREE.Color(0xD3D3D3) // Light Gray
};
const LEFT_INDICES = [11, 13, 15, 23, 25, 27, 29, 31];
const RIGHT_INDICES = [12, 14, 16, 24, 26, 28, 30, 32];
const FOOT_INDICES = [29, 30, 31, 32];
// --- HEAD CIRCLE: Define head landmark indices ---
const HEAD_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];


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
        this.controls = null;

        this.deviationVectorL = null;
        this.deviationVectorR = null;
        this.comIndicator = null;
        this.comPlumbLine = null;
        this.depthLaser = null;
        this.headCircle = null;
        this.floor = null;
        this.grid = null;
        this.isDepthLaserEnabled = true; // Start with the laser on by default

        this.depthLaserMaterial = new THREE.MeshBasicMaterial({
            color: 0xff0000,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.2
        });
        
        this._init();
    }

    _init() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);
        
        this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
        this.camera.position.set(0.5, 1.8, 3.0);
        
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true; 
        this.controls.dampingFactor = 0.08;
        this.controls.target.set(0, 1, 0); 

        this.scene.add(new THREE.HemisphereLight(0x888888, 0x444444, 1.5));
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
        directionalLight.position.set(2, 5, 3);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 1024;
        directionalLight.shadow.mapSize.height = 1024;
        this.scene.add(directionalLight);
        
        this.floor = new THREE.Mesh(
            new THREE.PlaneGeometry(10, 10),
            new THREE.MeshPhongMaterial({ color: 0x333333, depthWrite: false })
        );
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.receiveShadow = true;
        this.scene.add(this.floor);
        
        this.grid = new THREE.GridHelper(10, 20, 0x555555, 0x555555);
        this.scene.add(this.grid);


        this.skeletonGroup = new THREE.Group();
        this.scene.add(this.skeletonGroup);

        this._createSkeleton();
        this._createVisualHelpers();

        const resizeObserver = new ResizeObserver(entries => {
            if (entries && entries.length > 0) {
                const { width, height } = entries[0].contentRect;
                if (width > 0 && height > 0) {
                    this.camera.aspect = width / height;
                    this.camera.updateProjectionMatrix();
                    this.renderer.setSize(width, height);
                }
            }
        });
        resizeObserver.observe(this.canvas);

        const animate = () => {
            requestAnimationFrame(animate);
            this.controls.update(); 
            this.renderer.render(this.scene, this.camera);
        };
        animate();
    }

    _createSkeleton() {
        const sphereGeo = new THREE.SphereGeometry(0.025, 16, 12);
        for (let i = 0; i < 33; i++) {
            let color = LANDMARK_COLORS.CENTER;
            if (LEFT_INDICES.includes(i)) color = LANDMARK_COLORS.LEFT;
            else if (RIGHT_INDICES.includes(i)) color = LANDMARK_COLORS.RIGHT;
            
            const material = new THREE.MeshPhongMaterial({ color, shininess: 30 });
            const sphere = new THREE.Mesh(sphereGeo, material);
            sphere.castShadow = true;
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
                color = LANDMARK_COLORS.LEFT.clone().multiplyScalar(0.7);
            } else if (RIGHT_INDICES.includes(conn[0])) { 
                color = LANDMARK_COLORS.RIGHT.clone().multiplyScalar(0.7);
            } else {
                color = LANDMARK_COLORS.CENTER; 
            }

            const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, linewidth: 2 }));
            this.boneLines.push(line);
            this.skeletonGroup.add(line);
        });
    }

    _createVisualHelpers() {
        const errorMaterial = new THREE.LineBasicMaterial({ color: 0xFF4136, linewidth: 4 });
        this.deviationVectorL = new THREE.Line(new THREE.BufferGeometry(), errorMaterial);
        this.deviationVectorR = new THREE.Line(new THREE.BufferGeometry(), errorMaterial);
        this.deviationVectorL.visible = false;
        this.deviationVectorR.visible = false;
        this.skeletonGroup.add(this.deviationVectorL, this.deviationVectorR);
        
        const comMaterial = new THREE.MeshPhongMaterial({ color: 0x39CCCC, shininess: 50 });
        this.comIndicator = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), comMaterial);
        this.comIndicator.castShadow = true;
        this.comIndicator.visible = false;
        this.skeletonGroup.add(this.comIndicator);

        const plumbLineMaterial = new THREE.LineBasicMaterial({ color: 0x39CCCC, transparent: true, opacity: 0.5 });
        this.comPlumbLine = new THREE.Line(new THREE.BufferGeometry(), plumbLineMaterial);
        this.comPlumbLine.visible = false;
        this.skeletonGroup.add(this.comPlumbLine);
        
        const laserGeometry = new THREE.PlaneGeometry(2, 2);
        this.depthLaser = new THREE.Mesh(laserGeometry, this.depthLaserMaterial);
        this.depthLaser.rotation.x = -Math.PI / 2;
        this.depthLaser.visible = false;
        this.skeletonGroup.add(this.depthLaser);

        // --- FINAL FIX: Reverted size, removed incorrect initial rotation ---
        const headGeometry = new THREE.TorusGeometry(0.1, 0.015, 12, 24); // Size reverted to 0.1
        const headMaterial = new THREE.MeshPhongMaterial({ 
            color: LANDMARK_COLORS.CENTER, 
            shininess: 30
        });
        this.headCircle = new THREE.Mesh(headGeometry, headMaterial);
        this.headCircle.castShadow = true;
        this.headCircle.visible = false;
        this.skeletonGroup.add(this.headCircle);
    }

    update(landmarks, formState = {}) {
        if (!landmarks || this.jointSpheres.length === 0) return;

        let lowestY = Infinity;
        const leftEar = this.jointSpheres[7];
        const rightEar = this.jointSpheres[8];
        const leftShoulder = this.jointSpheres[11];
        const rightShoulder = this.jointSpheres[12];

        landmarks.forEach((lm, i) => {
            const joint = this.jointSpheres[i];
            if (lm) {
                joint.position.set(-lm.x, -lm.y, -lm.z);
                
                if (HEAD_INDICES.includes(i)) {
                    joint.visible = false;
                } else {
                    joint.visible = lm.visibility > 0.5;
                }

                if (FOOT_INDICES.includes(i) && joint.visible && joint.position.y < lowestY) {
                    lowestY = joint.position.y;
                }
            } else {
                joint.visible = false;
            }
        });

        // --- FINAL FIX: New logic for stable position and correct rotation ---
        const leftEarVisible = landmarks[7] && landmarks[7].visibility > 0.5;
        const rightEarVisible = landmarks[8] && landmarks[8].visibility > 0.5;
        const shouldersVisible = (landmarks[11] && landmarks[11].visibility > 0.5) && (landmarks[12] && landmarks[12].visibility > 0.5);

        if (this.headCircle && leftEarVisible && rightEarVisible && shouldersVisible) {
            this.headCircle.visible = true;
            
            const shoulderMidpoint = new THREE.Vector3().addVectors(leftShoulder.position, rightShoulder.position).multiplyScalar(0.5);
            const shoulderWidth = leftShoulder.position.distanceTo(rightShoulder.position);
            
            // 1. POSITION: Place the head a fixed 15% gap above the shoulders
            const gap = shoulderWidth * 0.40;
            const headCenter = new THREE.Vector3(shoulderMidpoint.x, shoulderMidpoint.y + gap, shoulderMidpoint.z);
            this.headCircle.position.copy(headCenter);

            // 2. ROTATION: Align the ring with the vector between the ears
            const earVector = new THREE.Vector3().subVectors(rightEar.position, leftEar.position).normalize();
            const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), earVector);
            this.headCircle.quaternion.copy(quaternion);

        } else if (this.headCircle) {
            this.headCircle.visible = false;
        }

        CONNECTIONS.forEach((conn, idx) => {
            const start = landmarks[conn[0]];
            const end = landmarks[conn[1]];
            const line = this.boneLines[idx];
            if (start && end && start.visibility > 0.5 && end.visibility > 0.5) {
                line.geometry.setFromPoints([this.jointSpheres[conn[0]].position, this.jointSpheres[conn[1]].position]);
                line.visible = true;
            } else {
                line.visible = false;
            }
        });

        if (isFinite(lowestY)) {
            const sphereRadius = 0.025; // Radius of the joint spheres
            // Adjust the skeleton's position to place the bottom of the lowest sphere on the grid (y=0)
            this.skeletonGroup.position.y = -(lowestY - sphereRadius);
        }
        
        const leftHip = this.jointSpheres[23];
        const rightHip = this.jointSpheres[24];
        if (leftHip.visible && rightHip.visible) {
            const hipCenter = new THREE.Vector3().addVectors(leftHip.position, rightHip.position).multiplyScalar(0.5);
            hipCenter.y += this.skeletonGroup.position.y;
            this.controls.target.copy(hipCenter);
        }

        this.updateVisualizations(formState);
    }
    
    updateVisualizations(formState) {
        const { valgus, balance, depth } = formState;
        if (valgus) {
            this.deviationVectorL.visible = valgus.left?.hasError;
            if (valgus.left?.hasError && valgus.left.idealPoint) {
                const kneeL = this.jointSpheres[25].position;
                const idealL = new THREE.Vector3(-valgus.left.idealPoint.x, -valgus.left.idealPoint.y, -valgus.left.idealPoint.z);
                this.deviationVectorL.geometry.setFromPoints([kneeL, idealL]);
            }
            this.deviationVectorR.visible = valgus.right?.hasError;
            if (valgus.right?.hasError && valgus.right.idealPoint) {
                const kneeR = this.jointSpheres[26].position;
                const idealR = new THREE.Vector3(-valgus.right.idealPoint.x, -valgus.right.idealPoint.y, -valgus.right.idealPoint.z);
                this.deviationVectorR.geometry.setFromPoints([kneeR, idealR]);
            }
        } else {
             this.deviationVectorL.visible = false;
             this.deviationVectorR.visible = false;
        }

        if (balance?.centerOfMass) {
            this.comIndicator.visible = true;
            this.comPlumbLine.visible = true;
            const com = balance.centerOfMass;
            const comPosition = new THREE.Vector3(-com.x, -com.y, -com.z);
            this.comIndicator.position.copy(comPosition);

            const floorY = -this.skeletonGroup.position.y;
            const floorPoint = new THREE.Vector3(comPosition.x, floorY, comPosition.z);
            this.comPlumbLine.geometry.setFromPoints([comPosition, floorPoint]);
        } else {
            this.comIndicator.visible = false;
            this.comPlumbLine.visible = false;
        }

        if (this.isDepthLaserEnabled && depth?.kneeY !== null) {
            this.depthLaser.visible = true;
            this.depthLaser.position.y = -depth.kneeY;
            this.depthLaserMaterial.color.set(depth.isParallel ? 0xff0000 : 0x00ff00);
            this.depthLaserMaterial.opacity = depth.isParallel ? 0.2 : 0.35;
        } else {
            this.depthLaser.visible = false;
        }
    }
    
    setDepthLaserVisibility(isVisible) {
        this.isDepthLaserEnabled = !!isVisible;
    }
}

export function createLiveScene(canvas) {
    return new PoseScene(canvas, { autoRotate: false });
}

export function createPlaybackScene(canvas) {
    return new PoseScene(canvas, { autoRotate: false });
}