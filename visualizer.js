/**
 * 3D GPU Visualizer and Spatial Audio Interactive Sphere
 * Uses global THREE object from CDN
 */
export class Visualizer {
    constructor(audioEngine) {
        this.engine = audioEngine;
        this.canvas = document.getElementById('visualizer-canvas');

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 15;
        this.camera.position.y = 5;
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        this.particles = null;
        this.sourceSphere = null;
        this.listenerObject = null;

        this.autoFloat = false;
        this.autoFloatAngle = 0;

        this.initVisuals();
        this.bindEvents();

        // Render Loop
        this.animate = this.animate.bind(this);
        requestAnimationFrame(this.animate);
    }

    initVisuals() {
        // 1. The Listener (Center)
        const listenerGeo = new THREE.OctahedronGeometry(1, 0);
        const listenerMat = new THREE.MeshBasicMaterial({ color: 0x888888, wireframe: true });
        this.listenerObject = new THREE.Mesh(listenerGeo, listenerMat);
        this.scene.add(this.listenerObject);

        // 2. The Sound Source (Interactive Sphere)
        const sphereGeo = new THREE.SphereGeometry(1.5, 32, 32);
        const sphereMat = new THREE.MeshPhongMaterial({
            color: 0x3498db, // Will be overridden by theme engine later
            emissive: 0x111111,
            shininess: 100,
            transparent: true,
            opacity: 0.8
        });
        this.sourceSphere = new THREE.Mesh(sphereGeo, sphereMat);
        this.sourceSphere.position.set(0, 0, -5); // Default pos
        this.scene.add(this.sourceSphere);

        // Lights
        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);
        this.pointLight = new THREE.PointLight(0xffffff, 2, 50);
        this.sourceSphere.add(this.pointLight); // Light moves with the sound source

        // 3. Audio Reactive Particle Ring
        const particleCount = 256; // Matching a subset of FFT size
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            pPos[i * 3] = Math.cos(angle) * 10;
            pPos[i * 3 + 1] = 0;
            pPos[i * 3 + 2] = Math.sin(angle) * 10;
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));

        const pMat = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.2,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0.6
        });

        this.particles = new THREE.Points(pGeo, pMat);
        this.scene.add(this.particles);

        // Raycaster for dragging
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.isDragging = false;
        this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Ground plane for dragging
    }

    updateAccentColor(hexString) {
        if (this.sourceSphere) {
            this.sourceSphere.material.color.set(hexString);
            this.pointLight.color.set(hexString);
            this.particles.material.color.set(hexString);
        }
    }

    bindEvents() {
        window.addEventListener('resize', () => {
            if (this.camera && this.renderer) {
                this.camera.aspect = window.innerWidth / window.innerHeight;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(window.innerWidth, window.innerHeight);
            }
        });

        const autoFloatBox = document.getElementById('auto-float-mode');
        if (autoFloatBox) {
            autoFloatBox.addEventListener('change', (e) => {
                this.autoFloat = e.target.checked;
            });
        }

        // Mouse Dragging for Spatial Placement
        this.canvas.addEventListener('mousedown', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.camera);

            const intersects = this.raycaster.intersectObject(this.sourceSphere);
            if (intersects.length > 0 && !this.autoFloat) {
                this.isDragging = true;
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
                this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
                this.raycaster.setFromCamera(this.mouse, this.camera);

                const target = new THREE.Vector3();
                this.raycaster.ray.intersectPlane(this.plane, target);

                // Bound it roughly to sensible limits
                target.x = Math.max(-10, Math.min(10, target.x));
                target.z = Math.max(-10, Math.min(10, target.z));
                target.y = 0; // Keeping mostly on horizon for simplicity, though HRTF supports Y

                this.sourceSphere.position.copy(target);
                this.syncToAudioEngine();
            }
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
        });

        // Sync from sliders
        const binds = ['x', 'y', 'z'];
        binds.forEach(axis => {
            document.getElementById(`spatial-${axis}`).addEventListener('input', (e) => {
                if (!this.isDragging && !this.autoFloat) {
                    this.sourceSphere.position[axis] = parseFloat(e.target.value);
                }
            });
        });
    }

    syncToAudioEngine() {
        // Update panner
        if (this.engine.nodes.panner) {
            const p = this.sourceSphere.position;
            this.engine.nodes.panner.positionX.value = p.x;
            this.engine.nodes.panner.positionY.value = p.y;
            this.engine.nodes.panner.positionZ.value = p.z;
        }

        // Update UI Sliders
        const updateSlider = (axis, val) => {
            const el = document.getElementById(`spatial-${axis}`);
            const valEl = document.getElementById(`val-spatial-${axis}`);
            if (el) el.value = val;
            if (valEl) valEl.textContent = val.toFixed(1);
        };
        updateSlider('x', this.sourceSphere.position.x);
        updateSlider('y', this.sourceSphere.position.y);
        updateSlider('z', this.sourceSphere.position.z);
    }

    animate() {
        requestAnimationFrame(this.animate);

        // 1. Process Auto-Float Mode
        if (this.autoFloat) {
            this.autoFloatAngle += 0.01;
            // Lissajous curve for 8D audio feel
            this.sourceSphere.position.x = Math.sin(this.autoFloatAngle) * 8;
            this.sourceSphere.position.z = Math.cos(this.autoFloatAngle * 0.5) * 8;
            this.sourceSphere.position.y = Math.sin(this.autoFloatAngle * 2) * 2;
            this.syncToAudioEngine();
        }

        // 2. Audio Reactivity
        if (this.engine.isPlaying) {
            this.engine.analyser.getByteFrequencyData(this.engine.analyserData);

            // Pulse source sphere based on bass (roughly bins 0-10)
            let bassSum = 0;
            for (let i = 0; i < 10; i++) bassSum += this.engine.analyserData[i];
            const bassAvg = Math.max(0.1, bassSum / 10 / 255);

            const scale = 1 + bassAvg * 0.5;
            this.sourceSphere.scale.set(scale, scale, scale);

            // Deform particle ring
            const positions = this.particles.geometry.attributes.position.array;
            for (let i = 0; i < 256; i++) {
                const angle = (i / 256) * Math.PI * 2;
                const freqVal = this.engine.analyserData[i] / 255.0; // 0 to 1
                const radius = 10 + freqVal * 5;

                positions[i * 3] = Math.cos(angle) * radius;
                positions[i * 3 + 1] = freqVal * 3; // Vertical height
                positions[i * 3 + 2] = Math.sin(angle) * radius;
            }
            this.particles.geometry.attributes.position.needsUpdate = true;

            // Slowly rotate particles
            this.particles.rotation.y += 0.002;
        } else {
            // Relax sphere back to 1.0 scale
            this.sourceSphere.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
        }

        this.renderer.render(this.scene, this.camera);
    }
}
