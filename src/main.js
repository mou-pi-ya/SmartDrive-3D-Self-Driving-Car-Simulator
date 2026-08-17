import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoadNetwork } from './simulator/RoadNetwork';
import { SelfDrivingCar } from './simulator/SelfDrivingCar';
import { TrafficManager } from './simulator/TrafficManager';

// Scene Variables
let scene, camera, renderer, controls;
let roadNetwork, mainCar, trafficManager;
let ambientLight, sunLight;
let carHeadlights = []; // spot lights attached to car for night driving

// Viewport / Camera settings
let currentCamMode = 'follow'; // follow, driver, top, orbit
const clock = new THREE.Clock();

// Telemetry Streaming Variables
let telemetryBatch = [];
let telemetryTimer = 0;
let streamingTimer = 0;
let backendOnline = false;

// DOM Elements
const speedValEl = document.getElementById('speed-val');
const dialProgressEl = document.getElementById('dial-progress');
const accelValEl = document.getElementById('accel-val');
const distValEl = document.getElementById('dist-val');
const collValEl = document.getElementById('coll-val');
const safetyValEl = document.getElementById('safety-val');
const collisionsCard = document.getElementById('collisions-card');
const safetyCard = document.getElementById('safety-card');
const driveModeEl = document.getElementById('driving-mode');
const backendStatusEl = document.getElementById('backend-status');
const fpsCounterEl = document.getElementById('fps-counter');

// Navigation Binds
const startNodeSelect = document.getElementById('start-node');
const endNodeSelect = document.getElementById('end-node');
const btnRoute = document.getElementById('btn-route');
const btnStopAutopilot = document.getElementById('btn-stop-autopilot');

// Settings Binds
const trafficSlider = document.getElementById('traffic-slider');
const trafficCountLabel = document.getElementById('traffic-count-label');
const toggleLidar = document.getElementById('toggle-lidar');
const togglePedestrians = document.getElementById('toggle-pedestrians');
const timeSlider = document.getElementById('time-slider');
const camButtons = document.querySelectorAll('.cam-btn');

// Charts Binds
const btnShowGraphs = document.getElementById('btn-show-graphs');
const btnResetData = document.getElementById('btn-reset-data');
const graphsModal = document.getElementById('graphs-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const summaryChartImg = document.getElementById('summary-chart-img');
const comfortChartImg = document.getElementById('comfort-chart-img');
const noDataWarning = document.getElementById('no-data-warning');
const graphsContainer = document.getElementById('graphs-container');

// FPS counter tracker
let frameCount = 0;
let lastFpsUpdate = 0;

// Main Init function
async function init() {
    // 1. Scene & Renderer Setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.FogExp2(0x0f172a, 0.002);

    const container = document.getElementById('canvas-container');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 2. Camera Setup
    camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 30, 50);

    // 3. Orbit Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.05; // don't go below ground

    // 4. Lights
    ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(100, 150, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 500;
    const d = 200;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    scene.add(sunLight);

    // 5. Initialize Simulator Components
    roadNetwork = new RoadNetwork(scene);
    await roadNetwork.init(); // loads nodes & edges

    mainCar = new SelfDrivingCar(scene, 0x00f2fe);
    // Position main car at North Parking Bay initially (Node 11)
    mainCar.reset(roadNetwork.nodes[11].x, roadNetwork.nodes[11].z, Math.PI);

    trafficManager = new TrafficManager(scene, roadNetwork);
    trafficManager.setCarCount(parseInt(trafficSlider.value));
    trafficManager.setPedestrianState(togglePedestrians.checked);

    // Populate Junction dropdowns
    populateJunctionDropdowns();

    // Check Backend connection status
    checkBackendHealth();

    // Setup input listeners
    setupInputListeners();

    // Start Loop
    animate();
}

// Check if Python Flask server is active
async function checkBackendHealth() {
    try {
        const res = await fetch('http://localhost:5000/api/network');
        if (res.ok) {
            backendOnline = true;
            backendStatusEl.innerText = "ONLINE";
            backendStatusEl.className = "val online";
        } else {
            throw new Error();
        }
    } catch (e) {
        backendOnline = false;
        backendStatusEl.innerText = "OFFLINE";
        backendStatusEl.className = "val offline";
    }
}

function populateJunctionDropdowns() {
    startNodeSelect.innerHTML = '';
    endNodeSelect.innerHTML = '';

    for (const key in roadNetwork.nodes) {
        const n = roadNetwork.nodes[key];
        const id = parseInt(key);

        // Exclude bends from selection
        if (n.type === 'bend') continue;

        // Exclude Central Intersection (0) and Central Parking Bay (10)
        if (id === 0 || id === 10) continue;

        // Populate Start List
        const optStart = document.createElement('option');
        optStart.value = key;
        optStart.innerText = `${n.name} (${key})`;
        startNodeSelect.appendChild(optStart);

        // Populate Destination List (exclude all parking bays)
        if (n.type !== 'parking' /*|| id === 12*/) {
            const optEnd = document.createElement('option');
            optEnd.value = key;
            optEnd.innerText = `${n.name} (${key})`;
            endNodeSelect.appendChild(optEnd);
        }
    }

    // Set default destinations (from North Parking Bay 11 to South Junction 3)
    startNodeSelect.value = '11';
    endNodeSelect.value = '3';
}

function setupInputListeners() {
    // Keyboard WASD Controls for manual overrides
    window.addEventListener('keydown', (e) => {
        let keyUsed = false;
        switch (e.key.toLowerCase()) {
            case 'w': case 'arrowup': mainCar.controls.forward = true; keyUsed = true; break;
            case 's': case 'arrowdown': mainCar.controls.backward = true; keyUsed = true; break;
            case 'a': case 'arrowleft': mainCar.controls.left = true; keyUsed = true; break;
            case 'd': case 'arrowright': mainCar.controls.right = true; keyUsed = true; break;
            case ' ': mainCar.controls.handbrake = true; keyUsed = true; break;
            case 'r':
                mainCar.reset(roadNetwork.nodes[11].x, roadNetwork.nodes[11].z, Math.PI);
                break;
        }

        // If manual key pressed, override autopilot instantly
        if (keyUsed && mainCar.isAutopilot) {
            disengageAutopilot();
        }
    });

    window.addEventListener('keyup', (e) => {
        switch (e.key.toLowerCase()) {
            case 'w': case 'arrowup': mainCar.controls.forward = false; break;
            case 's': case 'arrowdown': mainCar.controls.backward = false; break;
            case 'a': case 'arrowleft': mainCar.controls.left = false; break;
            case 'd': case 'arrowright': mainCar.controls.right = false; break;
            case ' ': mainCar.controls.handbrake = false; break;
        }
    });

    // Engages autopilot A* self-pathing
    btnRoute.addEventListener('click', async () => {
        const start = startNodeSelect.value;
        const end = endNodeSelect.value;

        if (start === end) {
            alert("Start and Destination cannot be the same junction!");
            return;
        }

        // Teleport car to start node before launching
        mainCar.reset(roadNetwork.nodes[start].x, roadNetwork.nodes[start].z, 0);

        btnRoute.innerText = "CALCULATING ROUTE...";
        btnRoute.disabled = true;

        try {
            // Request route from local Python A* backend
            const response = await fetch('http://localhost:5000/api/route', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ start: parseInt(start), end: parseInt(end) })
            });

            if (response.ok) {
                const data = await response.json();
                mainCar.setPath(data.nodes, roadNetwork);

                // Teleport to starting lane orientation
                if (mainCar.waypoints.length > 0) {
                    const wp0 = mainCar.waypoints[0];
                    const wp1 = mainCar.waypoints[1] || wp0;
                    const angle = Math.atan2(wp1.x - wp0.x, wp1.z - wp0.z);
                    mainCar.reset(wp0.x, wp0.z, angle);
                    mainCar.setPath(data.nodes, roadNetwork); // Set again after reset resets path flags
                }

                engageAutopilotUI();
            } else {
                throw new Error("Backend pathfinding failed.");
            }
        } catch (e) {
            console.error(e);
            alert("Failed to connect to Python backend for routing. Please make sure app.py is running!");
            btnRoute.innerText = "ENGAGE AUTOPILOT";
            btnRoute.disabled = false;
        }
    });

    btnStopAutopilot.addEventListener('click', () => {
        disengageAutopilot();
    });

    // Auto arrival handler
    window.addEventListener('autopilot-arrival', () => {
        disengageAutopilot();
        alert("Autopilot: Destination arrived successfully!");
    });

    // Settings adjustments
    trafficSlider.addEventListener('input', (e) => {
        const count = parseInt(e.target.value);
        trafficCountLabel.innerText = count;
        trafficManager.setCarCount(count);
    });

    toggleLidar.addEventListener('change', (e) => {
        mainCar.sensor.enabled = e.target.checked;
    });

    togglePedestrians.addEventListener('change', (e) => {
        trafficManager.setPedestrianState(e.target.checked);
    });

    timeSlider.addEventListener('input', (e) => {
        setLightingState(parseInt(e.target.value));
    });

    // Camera view button listeners
    camButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            camButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCamMode = btn.dataset.cam;
        });
    });

    // Telemetry and Graphs handlers (conditional based on UI elements presence)
    if (btnShowGraphs) {
        btnShowGraphs.addEventListener('click', async () => {
            if (graphsModal) graphsModal.classList.remove('hidden');
            if (noDataWarning) noDataWarning.classList.add('hidden');
            if (graphsContainer) graphsContainer.classList.add('hidden');

            btnShowGraphs.innerText = "CREATING PLOTS...";

            try {
                const res = await fetch('http://localhost:5000/api/generate-charts');
                if (res.ok) {
                    const data = await res.json();
                    if (summaryChartImg) summaryChartImg.src = `http://localhost:5000${data.charts.summary}?t=${Date.now()}`;
                    if (comfortChartImg) comfortChartImg.src = `http://localhost:5000${data.charts.comfort}?t=${Date.now()}`;
                    if (graphsContainer) graphsContainer.classList.remove('hidden');
                } else {
                    throw new Error("No data recorded");
                }
            } catch (e) {
                if (noDataWarning) noDataWarning.classList.remove('hidden');
            } finally {
                btnShowGraphs.innerText = "VIEW TELEMETRY REPORT";
            }
        });
    }

    if (btnResetData) {
        btnResetData.addEventListener('click', async () => {
            if (confirm("Are you sure you want to clear all Python telemetry logs?")) {
                mainCar.collisions = 0;
                mainCar.totalDistance = 0;
                mainCar.safetyScore = 100.0;

                try {
                    await fetch('http://localhost:5000/api/reset-telemetry', { method: 'POST' });
                } catch (e) { }

                updateTelemetryUI();
                alert("Telemetry logs successfully reset!");
            }
        });
    }

    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            if (graphsModal) graphsModal.classList.add('hidden');
        });
    }

    if (graphsModal) {
        graphsModal.addEventListener('click', (e) => {
            if (e.target === graphsModal) {
                graphsModal.classList.add('hidden');
            }
        });
    }
}

function engageAutopilotUI() {
    driveModeEl.innerText = "AUTOPILOT ENGAGED";
    driveModeEl.className = "val auto";

    btnRoute.classList.add('hidden');
    btnStopAutopilot.classList.remove('hidden');
}

function disengageAutopilot() {
    mainCar.isAutopilot = false;
    mainCar.manualBrakingToStop = true;
    mainCar.steering = 0;

    // Reset control inputs and lock handbrake until stopped
    mainCar.controls.forward = false;
    mainCar.controls.backward = false;
    mainCar.controls.left = false;
    mainCar.controls.right = false;
    mainCar.controls.handbrake = true;

    driveModeEl.innerText = "MANUAL OVERRIDE";
    driveModeEl.className = "val manual";

    btnRoute.classList.remove('hidden');
    btnRoute.innerText = "ENGAGE AUTOPILOT";
    btnRoute.disabled = false;

    btnStopAutopilot.classList.add('hidden');
}

// Lighting modes controller (Day, Sunset, Night)
function setLightingState(state) {
    // Remove existing spot lights to avoid leaks
    carHeadlights.forEach(light => mainCar.mesh.remove(light));
    carHeadlights = [];

    if (state === 0) { // Day
        scene.background.setHex(0x0f172a);
        scene.fog.color.setHex(0x0f172a);
        ambientLight.color.setHex(0xffffff);
        ambientLight.intensity = 0.6;
        sunLight.color.setHex(0xffffff);
        sunLight.intensity = 1.2;

        mainCar.setHeadlightState(0);
        trafficManager.cars.forEach(c => c.setHeadlightState(0));
    } else if (state === 1) { // Sunset
        scene.background.setHex(0x5c2e16);
        scene.fog.color.setHex(0x5c2e16);
        ambientLight.color.setHex(0xffaa44);
        ambientLight.intensity = 0.4;
        sunLight.color.setHex(0xff5500);
        sunLight.intensity = 0.7;

        mainCar.setHeadlightState(1);
        trafficManager.cars.forEach(c => c.setHeadlightState(1));
    } else { // Night
        scene.background.setHex(0x020617);
        scene.fog.color.setHex(0x020617);
        ambientLight.color.setHex(0x111827);
        ambientLight.intensity = 0.15;
        sunLight.color.setHex(0x0c1e3f);
        sunLight.intensity = 0.1;

        mainCar.setHeadlightState(2);
        trafficManager.cars.forEach(c => c.setHeadlightState(2));

        // Create SpotLights on front bumper of Main Car pointing forward in 3D
        const createSpotlight = (x, z) => {
            const light = new THREE.SpotLight(0xffffff, 40, 60, Math.PI / 6, 0.5, 1);
            light.position.set(x, 0.5, z);

            // Set Target
            const target = new THREE.Object3D();
            target.position.set(x, 0, z + 15);
            mainCar.mesh.add(target);
            light.target = target;

            light.castShadow = true;
            light.shadow.mapSize.width = 512;
            light.shadow.mapSize.height = 512;

            mainCar.mesh.add(light);
            carHeadlights.push(light);
        };

        createSpotlight(-0.7, 2.2);
        createSpotlight(0.7, 2.2);
    }
}

// Bounding box collision checker
function checkCollisions() {
    // Generate bounding box for Main Car
    const mainBox = new THREE.Box3().setFromObject(mainCar.mesh);

    // Scale box slightly inwards to avoid minor clipping triggers
    mainBox.expandByScalar(-0.1);

    // Collision check against traffic cars
    trafficManager.cars.forEach(other => {
        const otherBox = new THREE.Box3().setFromObject(other.mesh);
        otherBox.expandByScalar(-0.1);
        if (mainBox.intersectsBox(otherBox)) {
            // Apply bounce physics logic
            mainCar.triggerCollision();
            other.speed = -2; // bounce traffic backwards slightly

            // Trigger UI warning state
            collisionsCard.classList.add('active');
            setTimeout(() => collisionsCard.classList.remove('active'), 1000);
        }
    });

    // Collision check against crossing pedestrians
    trafficManager.pedestrians.forEach(ped => {
        const pedBox = new THREE.Box3().setFromObject(ped.mesh);
        if (mainBox.intersectsBox(pedBox)) {
            mainCar.triggerCollision();
            ped.progress = 0.0; // reset pedestrian to side of road

            collisionsCard.classList.add('active');
            setTimeout(() => collisionsCard.classList.remove('active'), 1000);
        }
    });
}

// Core Loop
function animate() {
    requestAnimationFrame(animate);

    const dt = clock.getDelta();
    // Clamp delta time to avoid physics explodes on tab suspension
    const clampedDt = Math.min(dt, 0.1);

    // 1. Update Road Network (Traffic light cycles & zebra cycles)
    roadNetwork.update(clampedDt);

    // 2. Fetch obstacles (traffic cars + pedestrians + curbs) for Lidar sensors
    const obstacles = [...trafficManager.getObstacleMeshes(), ...roadNetwork.curbMeshes];

    // 3. Update Main Driving Car
    mainCar.update(clampedDt, obstacles, roadNetwork);

    // 4. Update AI Traffic Cars & Pedestrians
    trafficManager.update(clampedDt, mainCar);

    // 5. Collision checks
    checkCollisions();

    // 6. Camera following updates
    updateCameraView();

    // 7. Telemetry & FPS dashboards updates
    updateTelemetryUI();
    logTelemetryPeriodic(clampedDt);
    updateFPS();

    renderer.render(scene, camera);
}

function updateCameraView() {
    if (currentCamMode === 'follow') {
        controls.enabled = false;
        // Follow position: behind and above the car relative to car direction
        const offsetDist = 12.0;
        const offsetHeight = 5.0;
        const angle = mainCar.angle;

        const targetX = mainCar.x - Math.sin(angle) * offsetDist;
        const targetZ = mainCar.z - Math.cos(angle) * offsetDist;

        // Smooth interpolation
        camera.position.x += (targetX - camera.position.x) * 0.1;
        camera.position.z += (targetZ - camera.position.z) * 0.1;
        camera.position.y += ((mainCar.y + offsetHeight) - camera.position.y) * 0.1;

        camera.lookAt(mainCar.x, mainCar.y + 1.0, mainCar.z);
    } else if (currentCamMode === 'driver') {
        controls.enabled = false;
        // Driver position: inside cabin looking forward
        const angle = mainCar.angle;
        // Front dashboard vector offset
        camera.position.set(
            mainCar.x + Math.sin(angle) * 0.2,
            mainCar.y + 1.1,
            mainCar.z + Math.cos(angle) * 0.2
        );

        const targetLookX = mainCar.x + Math.sin(angle) * 30.0;
        const targetLookZ = mainCar.z + Math.cos(angle) * 30.0;
        camera.lookAt(targetLookX, mainCar.y + 1.0, targetLookZ);
    } else if (currentCamMode === 'top') {
        controls.enabled = false;
        // Bird-eye straight down view
        camera.position.set(mainCar.x, mainCar.y + 80.0, mainCar.z);
        camera.lookAt(mainCar.x, mainCar.y, mainCar.z);
        camera.rotation.z = -mainCar.angle; // align top down with car heading
    } else {
        // Orbit view
        controls.enabled = true;
        controls.target.set(mainCar.x, mainCar.y, mainCar.z);
        controls.update();
    }
}

function updateTelemetryUI() {
    // 1. Digital Telemetries
    const speedKmh = Math.floor(Math.abs(mainCar.speed) * 3.6);
    speedValEl.innerText = speedKmh;

    accelValEl.innerHTML = `${mainCar.acceleration.toFixed(2)} <span class="m-unit">m/s²</span>`;
    distValEl.innerHTML = `${mainCar.totalDistance.toFixed(1)} <span class="m-unit">m</span>`;
    collValEl.innerText = mainCar.collisions;

    const safety = Math.round(mainCar.safetyScore);
    safetyValEl.innerText = `${safety}%`;

    // Apply color states to Safety Card
    if (safety > 75) {
        safetyValEl.className = "m-val font-mono success-text";
    } else if (safety > 40) {
        safetyValEl.className = "m-val font-mono"; // normal
    } else {
        safetyValEl.className = "m-val font-mono danger-text";
    }

    // 2. Speedometer Dial progress animation (251.2 is max stroke dasharray circumference)
    // Map speed to fill [0, 80] -> [0, 188.4] (about 3/4 circumference)
    const maxTrackVal = 188.4;
    const progress = (Math.min(speedKmh, 80) / 80) * maxTrackVal;
    dialProgressEl.style.strokeDashoffset = 251.2 - progress;
}

// Periodically pack logs and POST to Flask server
function logTelemetryPeriodic(dt) {
    telemetryTimer += dt;
    streamingTimer += dt;

    // Capture point every 0.25 seconds
    if (telemetryTimer >= 0.25) {
        telemetryTimer = 0;
        const speedKmh = Math.abs(mainCar.speed) * 3.6;

        telemetryBatch.push({
            timestamp: Date.now() / 1000,
            speed: speedKmh,
            acceleration: mainCar.acceleration,
            distance: mainCar.totalDistance,
            collisions: mainCar.collisions,
            safety_score: mainCar.safetyScore,
            lidar_min_dist: mainCar.sensor.getMinDistance()
        });
    }

    // Post to Python backend every 2.0 seconds if backend is online
    if (streamingTimer >= 2.0) {
        streamingTimer = 0;
        if (backendOnline && telemetryBatch.length > 0) {
            fetch('http://localhost:5000/api/telemetry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(telemetryBatch)
            }).then(res => {
                if (res.ok) telemetryBatch = []; // successfully logged
            }).catch(e => {
                backendOnline = false;
                backendStatusEl.innerText = "OFFLINE";
                backendStatusEl.className = "val offline";
            });
        } else if (!backendOnline) {
            // Keep buffer capped to avoid memory bloating
            if (telemetryBatch.length > 100) {
                telemetryBatch.shift();
            }

            // Try checking connection again
            checkBackendHealth();
        }
    }
}

function updateFPS() {
    frameCount++;
    const now = Date.now();
    if (now - lastFpsUpdate >= 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
        fpsCounterEl.innerText = fps;
        frameCount = 0;
        lastFpsUpdate = now;
    }
}

// Window resizing handler
window.addEventListener('resize', () => {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
});

// Launch on page load
window.onload = init;
