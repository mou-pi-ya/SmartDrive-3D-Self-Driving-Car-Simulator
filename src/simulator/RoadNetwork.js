import * as THREE from 'three';

export const FALLBACK_NODES = {
    0: { x: 0.0,   z: 0.0,   name: "Central Intersection", type: "junction_4way" },
    1: { x: 0.0,   z: -150.0, name: "North Junction",       type: "junction_3way" },
    2: { x: 150.0, z: 0.0,   name: "East Junction",        type: "junction_3way" },
    3: { x: 0.0,   z: 150.0,  name: "South Junction",       type: "junction_3way" },
    4: { x: -150.0, z: 0.0,   name: "West Junction",        type: "junction_3way" },
    5: { x: 150.0, z: -150.0, name: "North-East Turn",     type: "bend" },
    6: { x: 150.0, z: 150.0,  name: "South-East Turn",     type: "bend" },
    7: { x: -150.0, z: 150.0,  name: "South-West Turn",     type: "bend" },
    8: { x: -150.0, z: -150.0, name: "North-West Turn",     type: "bend" },
    
    // Parking bays off-road
    10: { x: -25.0,  z: -25.0,  name: "Central Parking Bay",  type: "parking" },
    11: { x: 0.0,    z: -170.0, name: "North Parking Bay",    type: "parking" },
    12: { x: 170.0,  z: 0.0,    name: "East Parking Bay",     type: "parking" },
    13: { x: 0.0,    z: 170.0,  name: "South Parking Bay",    type: "parking" },
    14: { x: -170.0, z: 0.0,    name: "West Parking Bay",     type: "parking" }
};

export const FALLBACK_EDGES = [
    { from: 0, to: 1, type: "straight" },
    { from: 0, to: 2, type: "straight" },
    { from: 0, to: 3, type: "straight" },
    { from: 0, to: 4, type: "straight" },
    { from: 1, to: 5, type: "straight" },
    { from: 5, to: 2, type: "straight" },
    { from: 2, to: 6, type: "straight" },
    { from: 6, to: 3, type: "straight" },
    { from: 3, to: 7, type: "straight" },
    { from: 7, to: 4, type: "straight" },
    { from: 4, to: 8, type: "straight" },
    { from: 8, to: 1, type: "straight" },
    
    // Parking connectors
    { from: 10, to: 0, type: "straight" },
    { from: 11, to: 1, type: "straight" },
    { from: 12, to: 2, type: "straight" },
    { from: 13, to: 3, type: "straight" },
    { from: 14, to: 4, type: "straight" }
];

export class RoadNetwork {
    constructor(scene) {
        this.scene = scene;
        this.nodes = FALLBACK_NODES;
        this.edges = FALLBACK_EDGES;
        
        this.roadWidth = 14;      // Width of a 2-lane road
        this.laneWidth = 6.5;     // Width of a single lane
        this.shoulderWidth = 0.5; // Shoulder markings
        
        this.trafficLights = [];   // List of traffic light objects
        this.zebraCrossings = [];  // List of zebra crossing zones
        this.curbMeshes = [];      // Invisible border collision meshes for Lidar
        
        // Traffic light status tracker
        // Directional groups: 0 = North-South, 1 = East-West
        this.lightState = 0;       // 0: NS Green/EW Red, 1: NS Yellow/EW Red, 2: NS Red/EW Green, 3: NS Red/EW Yellow
        this.lightTimer = 0;
        this.lightCycles = [
            { duration: 16.0, ns: 'green',  ew: 'red' },
            { duration: 4.0,  ns: 'yellow', ew: 'red' },
            { duration: 16.0, ns: 'red',    ew: 'green' },
            { duration: 4.0,  ns: 'red',    ew: 'yellow' }
        ];

        this.roadMaterials = {
            asphalt: new THREE.MeshStandardMaterial({ color: 0x1f2430, roughness: 0.8 }),
            grass: new THREE.MeshStandardMaterial({ color: 0x1e3a27, roughness: 0.9 }),
            markingWhite: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
            markingYellow: new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.6 }),
            curb: new THREE.MeshStandardMaterial({ color: 0x7f8c8d, roughness: 0.7 })
        };
    }

    async init() {
        try {
            const res = await fetch('http://localhost:5000/api/network');
            if (res.ok) {
                const data = await res.json();
                this.nodes = data.nodes;
                this.edges = data.edges;
                console.log("RoadNetwork loaded from Flask backend successfully.");
            }
        } catch (e) {
            console.warn("Flask backend offline, using local road network fallback.", e);
        }
        
        this.buildEnvironment();
        this.buildRoads();
        this.setupTrafficLights();
        this.setupZebraCrossings();
    }

    // A simple grid grass terrain
    buildEnvironment() {
        const terrainGeo = new THREE.PlaneGeometry(1000, 1000);
        const terrain = new THREE.Mesh(terrainGeo, this.roadMaterials.grass);
        terrain.rotation.x = -Math.PI / 2;
        terrain.position.y = -0.05; // Slightly below road
        terrain.receiveShadow = true;
        this.scene.add(terrain);

        // Add visual grid gridlines to look high tech
        const gridHelper = new THREE.GridHelper(800, 80, 0x00f2fe, 0x1e293b);
        gridHelper.position.y = -0.04;
        gridHelper.material.opacity = 0.15;
        gridHelper.material.transparent = true;
        this.scene.add(gridHelper);
    }

    buildRoads() {
        // Build 4-way central intersection
        this.buildJunction(this.nodes[0], this.roadWidth, this.roadWidth);
        
        // Build 3-way junctions
        this.buildJunction(this.nodes[1], this.roadWidth, this.roadWidth);
        this.buildJunction(this.nodes[2], this.roadWidth, this.roadWidth);
        this.buildJunction(this.nodes[3], this.roadWidth, this.roadWidth);
        this.buildJunction(this.nodes[4], this.roadWidth, this.roadWidth);

        // Build connecting straight roads
        // Nodes 0 to 1,2,3,4
        this.buildStraightRoad(this.nodes[0], this.nodes[1]);
        this.buildStraightRoad(this.nodes[0], this.nodes[2]);
        this.buildStraightRoad(this.nodes[0], this.nodes[3]);
        this.buildStraightRoad(this.nodes[0], this.nodes[4]);

        // Outer straight roads:
        // 1 to 5 to 2 (North-East Corner through 5)
        this.buildCurveRoad(this.nodes[1], this.nodes[5], this.nodes[2]);
        // 2 to 6 to 3 (South-East Corner through 6)
        this.buildCurveRoad(this.nodes[2], this.nodes[6], this.nodes[3]);
        // 3 to 7 to 4 (South-West Corner through 7)
        this.buildCurveRoad(this.nodes[3], this.nodes[7], this.nodes[4]);
        // 4 to 8 to 1 (North-West Corner through 8)
        this.buildCurveRoad(this.nodes[4], this.nodes[8], this.nodes[1]);

        // Build parking connectors (narrower roads: 8m wide)
        const oldWidth = this.roadWidth;
        this.roadWidth = 8.0; // narrow connector
        this.buildStraightRoad(this.nodes[10], this.nodes[0]);
        this.buildStraightRoad(this.nodes[11], this.nodes[1]);
        this.buildStraightRoad(this.nodes[12], this.nodes[2]);
        this.buildStraightRoad(this.nodes[13], this.nodes[3]);
        this.buildStraightRoad(this.nodes[14], this.nodes[4]);
        this.roadWidth = oldWidth; // restore

        // Build Visual Parking Bay Graphics at nodes 10, 11, 12, 13, 14
        this.buildParkingBayVisual(this.nodes[10]);
        this.buildParkingBayVisual(this.nodes[11]);
        this.buildParkingBayVisual(this.nodes[12]);
        this.buildParkingBayVisual(this.nodes[13]);
        this.buildParkingBayVisual(this.nodes[14]);
    }

    buildJunction(node, widthX, widthZ) {
        const x = parseFloat(node.x);
        const z = parseFloat(node.z);
        const junctionGeo = new THREE.BoxGeometry(widthX, 0.05, widthZ);
        const junction = new THREE.Mesh(junctionGeo, this.roadMaterials.asphalt);
        junction.position.set(x, 0.01, z);
        junction.receiveShadow = true;
        this.scene.add(junction);
        
        // Curbs for intersections
        // Just small spheres/boxes at the corners of junctions
        const cornerOffset = widthX / 2;
        const corners = [
            [x - cornerOffset, z - cornerOffset],
            [x + cornerOffset, z - cornerOffset],
            [x - cornerOffset, z + cornerOffset],
            [x + cornerOffset, z + cornerOffset]
        ];
        
        const curbGeo = new THREE.BoxGeometry(1.2, 0.25, 1.2);
        corners.forEach(([cx, cz]) => {
            // Keep center junction corners open for road flow
            if (node.type === "junction_4way") return;
            const curb = new THREE.Mesh(curbGeo, this.roadMaterials.curb);
            curb.position.set(cx, 0.1, cz);
            this.scene.add(curb);
        });
    }

    buildStraightRoad(n1, n2) {
        const x1 = parseFloat(n1.x);
        const z1 = parseFloat(n1.z);
        const x2 = parseFloat(n2.x);
        const z2 = parseFloat(n2.z);

        const dx = x2 - x1;
        const dz = z2 - z1;
        const length = Math.sqrt(dx*dx + dz*dz);
        const angle = Math.atan2(dx, dz);

        // Asphalt plane
        const roadGeo = new THREE.BoxGeometry(this.roadWidth, 0.04, length);
        const road = new THREE.Mesh(roadGeo, this.roadMaterials.asphalt);
        
        // Midpoint
        const mx = (x1 + x2) / 2;
        const mz = (z1 + z2) / 2;
        road.position.set(mx, 0.01, mz);
        road.rotation.y = angle;
        road.receiveShadow = true;
        this.scene.add(road);

        // Center lane markings (dashed white lines)
        const markerCount = Math.floor(length / 8);
        const dashGeo = new THREE.BoxGeometry(0.2, 0.05, 3.5);
        for (let i = 0; i < markerCount; i++) {
            const dash = new THREE.Mesh(dashGeo, this.roadMaterials.markingWhite);
            // Interpolate position
            const t = (i + 0.5) / markerCount;
            const px = x1 + dx * t;
            const pz = z1 + dz * t;
            dash.position.set(px, 0.035, pz);
            dash.rotation.y = angle;
            this.scene.add(dash);
        }

        // Side solid yellow lines
        const yellowLineGeo = new THREE.BoxGeometry(0.15, 0.05, length);
        [-1, 1].forEach(side => {
            const line = new THREE.Mesh(yellowLineGeo, this.roadMaterials.markingYellow);
            // Offset perpendicular to road heading
            const px = mx + Math.cos(angle) * (this.roadWidth / 2 - 0.2) * side;
            const pz = mz - Math.sin(angle) * (this.roadWidth / 2 - 0.2) * side;
            line.position.set(px, 0.032, pz);
            line.rotation.y = angle;
            this.scene.add(line);
        });

        // Create left and right curb collision walls (shortened to keep intersections clear)
        const isN1Junction = (n1.type.includes('junction') || n1.type === 'parking');
        const isN2Junction = (n2.type.includes('junction') || n2.type === 'parking');
        
        let startOffset = isN1Junction ? 7.0 : 0.0;
        let endOffset = isN2Junction ? 7.0 : 0.0;
        
        if (length - startOffset - endOffset < 2.0) {
            startOffset = 0;
            endOffset = 0;
        }
        
        const wallLength = length - startOffset - endOffset;
        const tStart = startOffset / length;
        const tEnd = (length - endOffset) / length;
        const tMid = (tStart + tEnd) / 2;
        
        const wmx = x1 + dx * tMid;
        const wmz = z1 + dz * tMid;

        const wallGeo = new THREE.BoxGeometry(0.2, 1.0, wallLength);
        const wallMat = new THREE.MeshBasicMaterial({ visible: false });
        
        [-1, 1].forEach(side => {
            const wall = new THREE.Mesh(wallGeo, wallMat);
            const px = wmx + Math.cos(angle) * (this.roadWidth / 2) * side;
            const pz = wmz - Math.sin(angle) * (this.roadWidth / 2) * side;
            wall.position.set(px, 0.5, pz);
            wall.rotation.y = angle;
            wall.userData = { type: 'curb' };
            this.scene.add(wall);
            this.curbMeshes.push(wall);
        });
    }

    // Creates a smooth quadratic Bezier bend road in 3D
    buildCurveRoad(nStart, nCtrl, nEnd) {
        const p1 = new THREE.Vector3(parseFloat(nStart.x), 0.01, parseFloat(nStart.z));
        const pCtrl = new THREE.Vector3(parseFloat(nCtrl.x), 0.01, parseFloat(nCtrl.z));
        const p2 = new THREE.Vector3(parseFloat(nEnd.x), 0.01, parseFloat(nEnd.z));
        
        const curve = new THREE.QuadraticBezierCurve3(p1, pCtrl, p2);
        const divisions = 24;
        const points = curve.getPoints(divisions);
        
        // Create road geometry using Extrude or small overlapping box segments
        // Overlapping small straight segments is highly robust and handles lane markings easily
        for (let i = 0; i < divisions; i++) {
            const pt1 = points[i];
            const pt2 = points[i+1];
            
            const dx = pt2.x - pt1.x;
            const dz = pt2.z - pt1.z;
            const segmentLength = Math.sqrt(dx*dx + dz*dz) + 0.1; // Add tiny overlap to prevent cracks
            const angle = Math.atan2(dx, dz);
            
            const segmentGeo = new THREE.BoxGeometry(this.roadWidth, 0.04, segmentLength);
            const segment = new THREE.Mesh(segmentGeo, this.roadMaterials.asphalt);
            segment.position.set((pt1.x + pt2.x)/2, 0.01, (pt1.z + pt2.z)/2);
            segment.rotation.y = angle;
            segment.receiveShadow = true;
            this.scene.add(segment);
            
            // Dashed center line in bends (solid in curves sometimes, but let's make tiny dash marks)
            if (i % 3 === 0) {
                const dashGeo = new THREE.BoxGeometry(0.2, 0.05, 1.2);
                const dash = new THREE.Mesh(dashGeo, this.roadMaterials.markingWhite);
                dash.position.set(pt1.x, 0.035, pt1.z);
                dash.rotation.y = angle;
                this.scene.add(dash);
            }
            
            // Yellow lines on edge of curves
            const yellowGeo = new THREE.BoxGeometry(0.15, 0.05, segmentLength);
            [-1, 1].forEach(side => {
                const line = new THREE.Mesh(yellowGeo, this.roadMaterials.markingYellow);
                const px = ((pt1.x + pt2.x)/2) + Math.cos(angle) * (this.roadWidth / 2 - 0.2) * side;
                const pz = ((pt1.z + pt2.z)/2) - Math.sin(angle) * (this.roadWidth / 2 - 0.2) * side;
                line.position.set(px, 0.032, pz);
                line.rotation.y = angle;
                this.scene.add(line);
            });

            // Curb walls for curves - skip first 2 and last 2 divisions to clear junctions
            if (i >= 2 && i < divisions - 2) {
                const wallGeo = new THREE.BoxGeometry(0.2, 1.0, segmentLength);
                const wallMat = new THREE.MeshBasicMaterial({ visible: false });
                [-1, 1].forEach(side => {
                    const wall = new THREE.Mesh(wallGeo, wallMat);
                    const px = ((pt1.x + pt2.x)/2) + Math.cos(angle) * (this.roadWidth / 2) * side;
                    const pz = ((pt1.z + pt2.z)/2) - Math.sin(angle) * (this.roadWidth / 2) * side;
                    wall.position.set(px, 0.5, pz);
                    wall.rotation.y = angle;
                    wall.userData = { type: 'curb' };
                    this.scene.add(wall);
                    this.curbMeshes.push(wall);
                });
            }
        }
    }

    setupTrafficLights() {
        // Place traffic lights at Central Intersection (Node 0, at x:0, z:0)
        // We place 4 traffic lights, one for each approaching road segment
        const offsets = [
            { x: -9, z: -9, angle: 0,           dir: 'north' }, // Controls traffic coming from North (Z negative) heading South
            { x: 9,  z: -9, angle: Math.PI / 2,  dir: 'east' },  // Controls traffic coming from East (X positive) heading West
            { x: 9,  z: 9,  angle: Math.PI,      dir: 'south' }, // Controls traffic coming from South (Z positive) heading North
            { x: -9, z: 9,  angle: -Math.PI / 2, dir: 'west' }   // Controls traffic coming from West (X negative) heading East
        ];

        offsets.forEach(opt => {
            const tl = this.createTrafficLightMesh();
            tl.position.set(opt.x, 0, opt.z);
            tl.rotation.y = opt.angle;
            this.scene.add(tl);
            
            this.trafficLights.push({
                mesh: tl,
                direction: opt.dir,
                stopX: opt.x + Math.sin(opt.angle) * 2, // stop line estimation
                stopZ: opt.z + Math.cos(opt.angle) * 2,
                lights: {
                    red: tl.getObjectByName('red_bulb'),
                    yellow: tl.getObjectByName('yellow_bulb'),
                    green: tl.getObjectByName('green_bulb')
                }
            });
        });
    }

    createTrafficLightMesh() {
        const group = new THREE.Group();
        
        // Metal Pole
        const poleGeo = new THREE.CylinderGeometry(0.2, 0.2, 5, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x34495e, metalness: 0.8, roughness: 0.2 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 2.5;
        group.add(pole);

        const boomGeo = new THREE.CylinderGeometry(0.15, 0.15, 2.5, 8);
        const boom = new THREE.Mesh(boomGeo, poleMat);
        boom.position.set(0, 5, 0.8);
        boom.rotation.x = Math.PI / 2;
        group.add(boom);

        // Light Box
        const boxGeo = new THREE.BoxGeometry(0.6, 1.8, 0.6);
        const boxMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(0, 4.6, 2.0);
        group.add(box);

        // Bulbs (red, yellow, green)
        const bulbGeo = new THREE.SphereGeometry(0.2, 16, 16);
        const makeBulb = (color, name, yOffset) => {
            const mat = new THREE.MeshBasicMaterial({ color: color });
            const bulb = new THREE.Mesh(bulbGeo, mat);
            bulb.name = name;
            bulb.position.set(0, yOffset, 2.3);
            return bulb;
        };

        const redBulb = makeBulb(0x550000, 'red_bulb', 5.1);
        const yellowBulb = makeBulb(0x555500, 'yellow_bulb', 4.6);
        const greenBulb = makeBulb(0x005500, 'green_bulb', 4.1);

        group.add(redBulb);
        group.add(yellowBulb);
        group.add(greenBulb);

        return group;
    }

    setupZebraCrossings() {
        // We will create two Zebra crossings.
        // Crossing 1: On the West-bound road (Node 0 to Node 4), positioned at x: -40.0, z: 0.0
        // Crossing 2: On the South-bound road (Node 0 to Node 3), positioned at x: 0.0, z: 40.0
        this.createCrossingMesh(-45.0, 0.0, 0); // vertical stripes (along Z direction, crossing X-road)
        this.createCrossingMesh(0.0, 45.0, Math.PI / 2); // horizontal stripes (along X direction, crossing Z-road)
    }

    createCrossingMesh(x, z, angle) {
        const group = new THREE.Group();
        group.position.set(x, 0.02, z);
        group.rotation.y = angle;

        const stripeWidth = 1.0;
        const stripeLength = 10.0;
        const count = 7;
        const spacing = 1.8;

        const stripeGeo = new THREE.PlaneGeometry(stripeLength, stripeWidth);
        const whiteMat = this.roadMaterials.markingWhite;

        for (let i = 0; i < count; i++) {
            const stripe = new THREE.Mesh(stripeGeo, whiteMat);
            stripe.rotation.x = -Math.PI / 2;
            stripe.position.z = (i - (count - 1)/2) * spacing;
            group.add(stripe);
        }

        // Add a pedestrian pole/indicator on either side of crossing
        const pole1 = this.createPedestrianIndicatorPole();
        pole1.position.set(-6, 0, -6);
        group.add(pole1);

        const pole2 = this.createPedestrianIndicatorPole();
        pole2.position.set(-6, 0, 6);
        group.add(pole2);

        this.scene.add(group);

        // Save pedestrian light reference for crossing
        this.zebraCrossings.push({
            x: x,
            z: z,
            angle: angle,
            range: 8.0, // collision radius
            indicator1: pole1.getObjectByName('p_bulb'),
            indicator2: pole2.getObjectByName('p_bulb'),
            pedestrianCrossingActive: false, // Pedestrians crossing trigger
            timer: 0
        });
    }

    createPedestrianIndicatorPole() {
        const group = new THREE.Group();
        
        const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.5, 8);
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.25;
        group.add(pole);

        const boxGeo = new THREE.BoxGeometry(0.4, 0.5, 0.4);
        const box = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x111111 }));
        box.position.y = 2.4;
        group.add(box);

        const bulbGeo = new THREE.SphereGeometry(0.12, 8, 8);
        const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xff416c })); // Default red (don't cross)
        bulb.name = 'p_bulb';
        bulb.position.set(0, 2.4, 0.22);
        group.add(bulb);

        return group;
    }

    update(dt) {
        // Update Central Junction Traffic Lights
        this.lightTimer += dt;
        const currentCycle = this.lightCycles[this.lightState];
        if (this.lightTimer >= currentCycle.duration) {
            this.lightTimer = 0;
            this.lightState = (this.lightState + 1) % this.lightCycles.length;
            this.applyTrafficLightColors();
        }

        // Update Zebra Crossings Pedestrian lights
        this.zebraCrossings.forEach(zc => {
            zc.timer += dt;
            // Every 12 seconds, toggle pedestrian crossing mode for 5 seconds
            const cycleTime = zc.timer % 17;
            const previousState = zc.pedestrianCrossingActive;
            
            if (cycleTime < 5.0) {
                zc.pedestrianCrossingActive = true;
            } else {
                zc.pedestrianCrossingActive = false;
            }

            if (zc.pedestrianCrossingActive !== previousState) {
                // Update indicator bulb colors: Green (0x00ff87) when crossing, Red (0xff416c) when closed
                const color = zc.pedestrianCrossingActive ? 0x00ff87 : 0xff416c;
                if (zc.indicator1) zc.indicator1.material.color.setHex(color);
                if (zc.indicator2) zc.indicator2.material.color.setHex(color);
            }
        });
    }

    applyTrafficLightColors() {
        const currentCycle = this.lightCycles[this.lightState];
        
        this.trafficLights.forEach(tl => {
            const isNS = (tl.direction === 'north' || tl.direction === 'south');
            const state = isNS ? currentCycle.ns : currentCycle.ew;

            // Dim everything first
            tl.lights.red.material.color.setHex(0x330000);
            tl.lights.yellow.material.color.setHex(0x333300);
            tl.lights.green.material.color.setHex(0x003300);

            // Light up active one
            if (state === 'red') {
                tl.lights.red.material.color.setHex(0xff0000);
            } else if (state === 'yellow') {
                tl.lights.yellow.material.color.setHex(0xffaa00);
            } else if (state === 'green') {
                tl.lights.green.material.color.setHex(0x00ff00);
            }
        });
    }

    buildParkingBayVisual(node) {
        const x = parseFloat(node.x);
        const z = parseFloat(node.z);
        const id = this.getClosestNode(x, z);
        
        // Orient parking bays parallel to loop roads
        // If North (11) or South (13), it extends vertically but slots are horizontal: width=12, length=8
        // If East (12) or West (14) or Central (10), it extends horizontally but slots are vertical: width=8, length=12
        const isHorizontal = (id === 11 || id === 13);
        const width = isHorizontal ? 12 : 8;
        const length = isHorizontal ? 8 : 12;
        
        const bayGeo = new THREE.BoxGeometry(width, 0.051, length);
        const bay = new THREE.Mesh(bayGeo, this.roadMaterials.asphalt);
        bay.position.set(x, 0.005, z);
        bay.receiveShadow = true;
        this.scene.add(bay);
        
        // Add yellow border lines
        const borderGeo = new THREE.BoxGeometry(width, 0.06, length);
        const edges = new THREE.EdgesGeometry(borderGeo);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffcc00 }));
        line.position.set(x, 0.015, z);
        this.scene.add(line);
        
        // White line partitioning to make 2 parking slots
        const slotWidth = isHorizontal ? (width - 1.0) : 0.15;
        const slotLength = isHorizontal ? 0.15 : (length - 1.0);
        const slotLineGeo = new THREE.BoxGeometry(slotWidth, 0.06, slotLength);
        const slotLine = new THREE.Mesh(slotLineGeo, this.roadMaterials.markingWhite);
        slotLine.position.set(x, 0.016, z);
        this.scene.add(slotLine);
        
        // Draw letter 'P' in yellow (small lines)
        const pGroup = new THREE.Group();
        const line1 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 1.2), this.roadMaterials.markingYellow);
        line1.position.set(-0.3, 0.017, 0);
        pGroup.add(line1);
        
        const line2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.15), this.roadMaterials.markingYellow);
        line2.position.set(0, 0.017, 0.6);
        pGroup.add(line2);
        
        const line3 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.15), this.roadMaterials.markingYellow);
        line3.position.set(0, 0.017, 0);
        pGroup.add(line3);
        
        const line4 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.6), this.roadMaterials.markingYellow);
        line4.position.set(0.3, 0.017, 0.3);
        pGroup.add(line4);
        
        if (isHorizontal) {
            pGroup.position.set(x - 2, 0.01, z);
        } else {
            pGroup.position.set(x, 0.01, z - 2);
        }
        this.scene.add(pGroup);
    }

    // Helper: Find closest node to coordinates
    getClosestNode(x, z) {
        let minDist = Infinity;
        let closestId = null;
        for (const idStr in this.nodes) {
            const id = parseInt(idStr);
            const n = this.nodes[id];
            const dx = n.x - x;
            const dz = n.z - z;
            const dist = dx*dx + dz*dz;
            if (dist < minDist) {
                minDist = dist;
                closestId = id;
            }
        }
        return closestId;
    }
}
