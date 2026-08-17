import * as THREE from 'three';
import { Car } from './Car';

class TrafficCar extends Car {
    constructor(scene, color, loopSector, network) {
        super(scene, color);
        
        this.network = network;
        this.loopSector = loopSector; // 0, 1, 2, or 3
        this.targetSpeed = 7.0; // Cruise speed for traffic
        
        // Circular hemisphere loops (clockwise)
        const loops = [
            [1, 5, 2, 6, 3, 0], // Sector 0: Eastern Hemisphere (North -> East -> South -> Center -> North)
            [3, 7, 4, 8, 1, 0], // Sector 1: Western Hemisphere (South -> West -> North -> Center -> South)
            [4, 8, 1, 5, 2, 0], // Sector 2: Northern Hemisphere (West -> North -> East -> Center -> West)
            [2, 6, 3, 7, 4, 0]  // Sector 3: Southern Hemisphere (East -> South -> West -> Center -> East)
        ];
        
        this.loopNodes = loops[this.loopSector];
        this.currentLoopIdx = 0;
        
        this.waypoints = [];
        this.waypointIdx = 0;
        this.maxSpeed = 12.0;

        // Custom scale down slightly for traffic cars so they look distinct
        this.mesh.scale.set(0.9, 0.9, 0.9);
        this.mesh.userData = { type: 'traffic_car' };
        
        this.generateNextSegmentPath();
        
        // Teleport to starting waypoint
        if (this.waypoints.length > 0) {
            const startPt = this.waypoints[0];
            this.x = startPt.x;
            this.z = startPt.z;
            this.angle = this.calculateInitialAngle();
            this.mesh.position.set(this.x, this.y, this.z);
            this.mesh.rotation.y = this.angle;
        }
    }

    calculateInitialAngle() {
        if (this.waypoints.length < 2) return 0;
        const dx = this.waypoints[1].x - this.waypoints[0].x;
        const dz = this.waypoints[1].z - this.waypoints[0].z;
        return Math.atan2(dx, dz);
    }

    generateNextSegmentPath() {
        this.waypoints = [];
        this.waypointIdx = 0;
        
        const fromNodeId = this.loopNodes[this.currentLoopIdx];
        const nextIdx = (this.currentLoopIdx + 1) % this.loopNodes.length;
        const toNodeId = this.loopNodes[nextIdx];
        
        const n1 = this.network.nodes[fromNodeId];
        const n2 = this.network.nodes[toNodeId];
        
        // Indian standard: left lane offset (negative 3.2m from centerline)
        const laneOffsetDist = -3.2; 
        
        // If the next node is a bend (curve), we interpolate a smooth Bezier curve
        if (n2.type === 'bend') {
            const nextNextIdx = (this.currentLoopIdx + 2) % this.loopNodes.length;
            const thirdNodeId = this.loopNodes[nextNextIdx];
            const n3 = this.network.nodes[thirdNodeId];
            
            const p1 = new THREE.Vector3(n1.x, 0, n1.z);
            const pCtrl = new THREE.Vector3(n2.x, 0, n2.z);
            const p2 = new THREE.Vector3(n3.x, 0, n3.z);
            
            const curve = new THREE.QuadraticBezierCurve3(p1, pCtrl, p2);
            const points = curve.getPoints(16);
            
            for (let k = 0; k < points.length; k++) {
                const pt = points[k];
                const t = k / points.length;
                const tangent = curve.getTangentAt(t).normalize();
                const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                const lanePt = pt.clone().add(normal.multiplyScalar(laneOffsetDist));
                this.waypoints.push(lanePt);
            }
            
            this.currentLoopIdx = nextNextIdx;
        } else {
            // Straight road segment
            const p1 = new THREE.Vector3(n1.x, 0, n1.z);
            const p2 = new THREE.Vector3(n2.x, 0, n2.z);
            
            const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
            const normal = new THREE.Vector3(-dir.z, 0, dir.x); // Right normal
            
            const length = p1.distanceTo(p2);
            const steps = Math.max(2, Math.floor(length / 2.0)); // waypoint every 2 meters

            for (let k = 0; k <= steps; k++) {
                const pt = new THREE.Vector3().lerpVectors(p1, p2, k / steps);
                const lanePt = pt.clone().add(normal.clone().multiplyScalar(laneOffsetDist));
                this.waypoints.push(lanePt);
            }
            
            this.currentLoopIdx = nextIdx;
        }
    }

    updateAI(dt, allVehicles) {
        if (this.waypoints.length === 0) return;

        // 1. Advance waypoints
        const buffer = 4.0;
        while (this.waypointIdx < this.waypoints.length) {
            const wp = this.waypoints[this.waypointIdx];
            const dist = Math.sqrt((this.x - wp.x)**2 + (this.z - wp.z)**2);
            if (dist < buffer) {
                this.waypointIdx++;
            } else {
                break;
            }
        }

        // 2. Select next segment in loop if completed current segment
        if (this.waypointIdx >= this.waypoints.length) {
            this.generateNextSegmentPath();
            
            // Skip initial waypoints of the new path that are behind the car or too close,
            // preventing the car from turning in circles to reach a missed start point!
            const headingVec = new THREE.Vector2(Math.sin(this.angle), Math.cos(this.angle)).normalize();
            while (this.waypointIdx < this.waypoints.length) {
                const wp = this.waypoints[this.waypointIdx];
                const relX = wp.x - this.x;
                const relZ = wp.z - this.z;
                const dist = Math.sqrt(relX*relX + relZ*relZ);
                const relVec = new THREE.Vector2(relX, relZ).normalize();
                const dot = headingVec.dot(relVec);
                
                // Skip if point is close (within 6 meters) or behind the car
                if (dot < 0.4 || dist < 6.0) {
                    this.waypointIdx++;
                } else {
                    break;
                }
            }
            
            if (this.waypointIdx >= this.waypoints.length) {
                this.waypointIdx = this.waypoints.length - 1;
            }
            return;
        }

        // 3. Proportional steering (Pure Pursuit style look-ahead)
        const lookahead = Math.abs(this.speed) * 0.8 + 4.5;
        let targetIdx = this.waypointIdx;
        while (targetIdx < this.waypoints.length) {
            const wp = this.waypoints[targetIdx];
            const dist = Math.sqrt((this.x - wp.x)**2 + (this.z - wp.z)**2);
            if (dist >= lookahead) {
                break;
            }
            targetIdx++;
        }
        if (targetIdx >= this.waypoints.length) {
            targetIdx = this.waypoints.length - 1;
        }

        const targetPt = this.waypoints[targetIdx];
        const dx = targetPt.x - this.x;
        const dz = targetPt.z - this.z;
        const angleToTarget = Math.atan2(dx, dz);
        
        let angleDiff = angleToTarget - this.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        this.steering = THREE.MathUtils.lerp(
            this.steering, 
            THREE.MathUtils.clamp(angleDiff * 2.5, -this.maxSteering, this.maxSteering), 
            this.steeringSpeed * dt
        );

        // 4. Collision avoidance & Traffic lights speed limits
        let speedLimit = this.targetSpeed;

        // Dynamic speed scaling: slow down in turns to prevent skidding off-road
        speedLimit = Math.min(speedLimit, this.targetSpeed * (1.0 - (Math.abs(this.steering) / this.maxSteering) * 0.55));

        // Check distance to vehicle ahead
        let leadVehicleDist = Infinity;
        allVehicles.forEach(other => {
            if (other === this) return;
            const dist = Math.sqrt((other.x - this.x)**2 + (other.z - this.z)**2);
            if (dist < 30.0) {
                // Check if other vehicle is heading in the same general direction (not oncoming)
                const thisHeading = new THREE.Vector2(Math.sin(this.angle), Math.cos(this.angle)).normalize();
                const otherHeading = new THREE.Vector2(Math.sin(other.angle), Math.cos(other.angle)).normalize();
                const headingDot = thisHeading.dot(otherHeading);
                
                // Ignore oncoming traffic (headingDot < 0)
                if (headingDot >= 0.0) {
                    const relativeVec = new THREE.Vector2(other.x - this.x, other.z - this.z).normalize();
                    const dot = thisHeading.dot(relativeVec);
                    if (dot > 0.8 && dist < leadVehicleDist) {
                        leadVehicleDist = dist;
                    }
                }
            }
        });

        if (leadVehicleDist < 12.0) {
            speedLimit = 0; // Emergency brake
        } else if (leadVehicleDist < 25.0) {
            speedLimit = Math.min(speedLimit, ((leadVehicleDist - 12.0) / 13.0) * this.targetSpeed);
        }

        // Traffic Light Stop
        const distToCenter = Math.sqrt(this.x*this.x + this.z*this.z);
        if (distToCenter < 35.0 && distToCenter > 10.0) {
            const headingVec = new THREE.Vector2(Math.sin(this.angle), Math.cos(this.angle)).normalize();
            const toCenterVec = new THREE.Vector2(-this.x, -this.z).normalize();
            const headingDotCenter = headingVec.dot(toCenterVec);

            if (headingDotCenter > 0.3) {
                let approachDir = '';
                if (this.x < -10.0 && Math.abs(this.z) < 15.0) approachDir = 'west';
                else if (this.x > 10.0 && Math.abs(this.z) < 15.0) approachDir = 'east';
                else if (this.z < -10.0 && Math.abs(this.x) < 15.0) approachDir = 'north';
                else if (this.z > 10.0 && Math.abs(this.x) < 15.0) approachDir = 'south';

                if (approachDir) {
                    const currentCycle = this.network.lightCycles[this.network.lightState];
                    const lightColor = approachDir === 'north' || approachDir === 'south' ? currentCycle.ns : currentCycle.ew;
                    
                    if (lightColor === 'red' || lightColor === 'yellow') {
                        const stopLineDist = distToCenter - 14.0;
                        if (stopLineDist > 0) {
                            speedLimit = Math.min(speedLimit, (stopLineDist / 20.0) * this.targetSpeed);
                        } else {
                            speedLimit = 0;
                        }
                    }
                }
            }
        }

        // Zebra Crossing compliance
        this.network.zebraCrossings.forEach(zc => {
            const zcDist = Math.sqrt((this.x - zc.x)**2 + (this.z - zc.z)**2);
            if (zcDist < 25.0 && zcDist > 5.0 && zc.pedestrianCrossingActive) {
                const relativeVec = new THREE.Vector2(zc.x - this.x, zc.z - this.z).normalize();
                const headingVec = new THREE.Vector2(Math.sin(this.angle), Math.cos(this.angle)).normalize();
                const dot = headingVec.dot(relativeVec);
                if (dot > 0.8) {
                    const stopDist = zcDist - 6.0;
                    if (stopDist > 0) {
                        speedLimit = Math.min(speedLimit, (stopDist / 15.0) * this.targetSpeed);
                    } else {
                        speedLimit = 0;
                    }
                }
            }
        });

        // Apply control forces
        if (this.speed < speedLimit) {
            this.controls.forward = true;
            this.controls.backward = false;
        } else if (this.speed > speedLimit + 1.0) {
            this.controls.forward = false;
            this.controls.backward = true;
        } else {
            this.controls.forward = false;
            this.controls.backward = false;
        }

        // Apply physics engine update
        this.applyPhysics(dt);
        this.animateMesh(dt);
    }

    // selectNextRandomEdge removed
}


class Pedestrian {
    constructor(scene, zebraCrossing) {
        this.scene = scene;
        this.zc = zebraCrossing;
        this.progress = Math.random(); // 0 to 1 along crosswalk line
        this.direction = Math.random() > 0.5 ? 1 : -1;
        this.speed = 1.6; // walk speed m/s
        this.active = true;

        this.mesh = null;
        this.buildMesh();
    }

    buildMesh() {
        // Red color pill mesh representing pedestrian
        const group = new THREE.Group();
        const pGeo = new THREE.CapsuleGeometry(0.3, 1.2, 4, 8);
        const pMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.8 });
        const pill = new THREE.Mesh(pGeo, pMat);
        pill.position.y = 0.9;
        pill.castShadow = true;
        group.add(pill);

        // Give pedestrian unique ID tag for raycasting
        group.userData = { type: 'pedestrian' };
        
        this.mesh = group;
        this.scene.add(this.mesh);
        
        this.updatePosition();
    }

    update(dt) {
        // If pedestrian light is RED and pedestrian is close to either side (curb), they step completely off the road and wait
        const isAtSide = this.progress <= 0.05 || this.progress >= 0.95;
        if (!this.zc.pedestrianCrossingActive && isAtSide) {
            this.progress = this.progress < 0.5 ? 0.0 : 1.0;
            this.updatePosition();
            return;
        }

        // Walk back and forth across crosswalk bounds
        // Crosswalk is 10m long.
        this.progress += (this.speed / 10.0) * this.direction * dt;
        
        if (this.progress >= 1.0) {
            this.progress = 1.0;
            this.direction = -1;
        } else if (this.progress <= 0.0) {
            this.progress = 0.0;
            this.direction = 1;
        }

        this.updatePosition();
    }

    updatePosition() {
        // Position lies along zebra crossing coordinate line.
        // Zebra crossing is located at (zc.x, zc.z). Line of crossing is along zc.angle + PI/2.
        // Crossing length is approx 12.0m. We map progress [0, 1] to offset [-6.0, 6.0]
        const crosswalkLength = 10.0;
        const offset = (this.progress - 0.5) * crosswalkLength;

        // Perpendicular angle to cross the road width
        const walkAngle = this.zc.angle + Math.PI / 2;

        this.mesh.position.set(
            this.zc.x + Math.sin(walkAngle) * offset,
            0.02,
            this.zc.z + Math.cos(walkAngle) * offset
        );
    }

    destroy() {
        this.scene.remove(this.mesh);
    }
}


export class TrafficManager {
    constructor(scene, network) {
        this.scene = scene;
        this.network = network;
        this.cars = [];
        this.pedestrians = [];
        this.maxCars = 5;
        this.simulatePedestrians = true;

        this.carColors = [
            0x2ecc71, // green
            0xe74c3c, // red
            0xf1c40f, // yellow
            0x9b59b6, // purple
            0xe67e22, // orange
            0x95a5a6, // gray
            0xffffff  // white
        ];
    }

    update(dt, mainCar) {
        // Sync traffic car count
        this.syncCarCount();

        // Sync pedestrian presence
        this.syncPedestrians();

        // Compile all vehicles for obstacle calculations
        const allVehicles = [mainCar, ...this.cars];

        // Update traffic cars
        this.cars.forEach(car => {
            car.updateAI(dt, allVehicles);
        });

        // Update pedestrians
        if (this.simulatePedestrians) {
            this.pedestrians.forEach(ped => {
                ped.update(dt);
            });
        }
    }

    syncCarCount() {
        // Locked to exactly 4 cars, each in its own hemisphere loop sector
        if (this.cars.length === 0) {
            const colors = [0xff3366, 0x33ff66, 0x3366ff, 0xffff33]; // Red, Green, Blue, Yellow
            for (let i = 0; i < 4; i++) {
                const tc = new TrafficCar(this.scene, colors[i], i, this.network);
                this.cars.push(tc);
            }
        }
    }

    syncPedestrians() {
        if (!this.simulatePedestrians) {
            this.pedestrians.forEach(ped => ped.destroy());
            this.pedestrians = [];
            return;
        }

        // Ensure there is 1 pedestrian per zebra crossing
        if (this.pedestrians.length === 0 && this.network.zebraCrossings.length > 0) {
            this.network.zebraCrossings.forEach(zc => {
                const ped = new Pedestrian(this.scene, zc);
                this.pedestrians.push(ped);
            });
        }
    }

    getObstacleMeshes() {
        // Return 3D meshes of all traffic cars and pedestrians for raycasting
        const meshes = [];
        this.cars.forEach(car => {
            // Add car chassis mesh (which has userData)
            meshes.push(car.mesh);
        });
        this.pedestrians.forEach(ped => {
            meshes.push(ped.mesh);
        });
        return meshes;
    }

    setCarCount(count) {
        this.maxCars = count;
    }

    setPedestrianState(state) {
        this.simulatePedestrians = state;
    }

    clear() {
        this.cars.forEach(c => c.destroy());
        this.cars = [];
        this.pedestrians.forEach(p => p.destroy());
        this.pedestrians = [];
    }
}
