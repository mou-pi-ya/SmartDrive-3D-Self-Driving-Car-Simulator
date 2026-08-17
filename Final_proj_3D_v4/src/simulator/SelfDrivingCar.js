import * as THREE from 'three';
import { Car } from './Car';
import { Sensor } from './Sensor';

export class SelfDrivingCar extends Car {
    constructor(scene, color = 0x00f2fe) {
        super(scene, color);
        
        this.sensor = new Sensor(this.scene, this);
        this.waypoints = [];        // High-density points to follow
        this.currentWaypointIdx = 0;
        this.targetSpeed = 10.0;     // m/s (default cruising speed)
        this.isAutopilot = false;
        this.manualBrakingToStop = false;
        
        this.safetyDistance = 12.0;  // m to trigger hard braking
        
        // Track stats for telemetry
        this.totalDistance = 0;
        this.collisions = 0;
        this.safetyScore = 100.0;
        
        this.lastX = this.x;
        this.lastZ = this.z;
    }

    setPath(nodesList, network) {
        this.waypoints = [];
        this.currentWaypointIdx = 0;
        
        if (nodesList.length < 2) return;

        const laneOffsetDist = -3.2;

        // 1. Build list of centerline segments
        const segments = [];
        for (let idx = 0; idx < nodesList.length - 1; idx++) {
            const uId = nodesList[idx];
            const vId = nodesList[idx + 1];
            
            const n1 = network.nodes[uId];
            const n2 = network.nodes[vId];

            const p1 = new THREE.Vector3(n1.x, 0, n1.z);
            const p2 = new THREE.Vector3(n2.x, 0, n2.z);
            
            const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
            const normal = new THREE.Vector3(-dir.z, 0, dir.x); // Right normal
            const length = p1.distanceTo(p2);
            
            const isN2Bend = n2.type === 'bend';
            
            segments.push({
                fromId: uId,
                toId: vId,
                p1,
                p2,
                dir,
                normal,
                length,
                isBend: isN2Bend
            });
        }

        // 2. Generate waypoints by processing segments and turns
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            
            // Curve corner bend: Node U -> Node V (bend) -> Node W
            if (seg.isBend && i < segments.length - 1) {
                const nextSeg = segments[i+1];
                const p1 = seg.p1;
                const pCtrl = seg.p2; 
                const p2 = nextSeg.p2;

                const curve = new THREE.QuadraticBezierCurve3(p1, pCtrl, p2);
                const points = curve.getPoints(20);

                for (let k = 0; k < points.length; k++) {
                    const pt = points[k];
                    const t = k / points.length;
                    const tangent = curve.getTangentAt(t).normalize();
                    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
                    
                    const lanePt = pt.clone().add(normal.multiplyScalar(laneOffsetDist));
                    this.waypoints.push(lanePt);
                }
                
                i++; // skip next segment
                continue;
            }

            const hasNext = (i < segments.length - 1);
            
            if (hasNext) {
                const nextSeg = segments[i+1];
                const dot = seg.dir.dot(nextSeg.dir);
                
                if (dot < 0.95) {
                    // Turn at junction detected!
                    // Clip straight segments to insert a smooth quadratic Bezier turn in the intersection
                    const turnDist = Math.min(12.0, seg.length * 0.45);
                    const nextTurnDist = Math.min(12.0, nextSeg.length * 0.45);
                    
                    // Generate straight waypoints up to turn start
                    const straightLength = seg.length - turnDist;
                    const steps = Math.max(2, Math.floor(straightLength / 2.0));
                    
                    for (let k = 0; k < steps; k++) {
                        const t = (k / steps) * (straightLength / seg.length);
                        const pt = new THREE.Vector3().lerpVectors(seg.p1, seg.p2, t);
                        const lanePt = pt.clone().add(seg.normal.clone().multiplyScalar(laneOffsetDist));
                        this.waypoints.push(lanePt);
                    }
                    
                    // Generate Bezier turn curves
                    const pStart = seg.p2.clone().add(seg.dir.clone().multiplyScalar(-turnDist)).add(seg.normal.clone().multiplyScalar(laneOffsetDist));
                    const pEnd = nextSeg.p1.clone().add(nextSeg.dir.clone().multiplyScalar(nextTurnDist)).add(nextSeg.normal.clone().multiplyScalar(laneOffsetDist));
                    const pCtrl = seg.p2.clone().add(seg.normal.clone().multiplyScalar(laneOffsetDist)).add(nextSeg.normal.clone().multiplyScalar(laneOffsetDist));
                    
                    const curve = new THREE.QuadraticBezierCurve3(pStart, pCtrl, pEnd);
                    const points = curve.getPoints(12);
                    
                    for (let k = 0; k < points.length; k++) {
                        this.waypoints.push(points[k]);
                    }
                    
                    // Adjust next segment to start after the turn curve
                    nextSeg.p1.add(nextSeg.dir.clone().multiplyScalar(nextTurnDist));
                    nextSeg.length -= nextTurnDist;
                    
                    continue;
                }
            }

            // Normal straight road segment waypoints
            const steps = Math.max(2, Math.floor(seg.length / 2.0));
            for (let k = 0; k <= steps; k++) {
                const pt = new THREE.Vector3().lerpVectors(seg.p1, seg.p2, k / steps);
                const lanePt = pt.clone().add(seg.normal.clone().multiplyScalar(laneOffsetDist));
                this.waypoints.push(lanePt);
            }
        }

        this.isAutopilot = true;
        this.currentWaypointIdx = 0;
    }

    update(dt, obstacles, network) {
        if (!this.isAutopilot) {
            if (this.manualBrakingToStop) {
                this.controls.forward = false;
                this.controls.backward = false;
                this.controls.left = false;
                this.controls.right = false;
                this.controls.handbrake = true;
                
                if (Math.abs(this.speed) < 0.1) {
                    this.speed = 0;
                    this.controls.handbrake = false;
                    this.manualBrakingToStop = false;
                }
            }

            super.update(dt);
            this.sensor.update(obstacles);
            this.updateStats(dt);
            return;
        }

        // --- Autopilot Control Loop ---
        this.sensor.update(obstacles);

        if (this.waypoints.length === 0) {
            this.speed = 0;
            super.update(dt);
            return;
        }

        // Find nearest waypoint index
        this.advanceWaypoints();

        if (this.currentWaypointIdx >= this.waypoints.length) {
            // Arrived at destination!
            this.isAutopilot = false;
            this.controls.forward = false;
            this.controls.backward = false;
            this.controls.handbrake = true;
            this.speed = 0;
            super.update(dt);
            // Notify arrival via UI event
            const event = new CustomEvent('autopilot-arrival');
            window.dispatchEvent(event);
            return;
        }

        // 1. Steering & Target Math (Dynamic Look-Ahead / Pure Pursuit)
        // Lookahead distance scales with speed to stabilize steering at high speed and allow sharp turns at low speed.
        const lookahead = Math.abs(this.speed) * 0.85 + 4.5;
        let targetIdx = this.currentWaypointIdx;
        
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
        
        // Steering calculation towards lookahead target
        const dx = targetPt.x - this.x;
        const dz = targetPt.z - this.z;
        const angleToTarget = Math.atan2(dx, dz);
        
        let angleDiff = angleToTarget - this.angle;
        // Normalize angle difference to -PI to PI
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        // 2. Off-Road / Wrong-Orientation Recovery Logic
        // Check distance to closest active waypoint (not lookahead) to detect off-path state
        const closestWp = this.waypoints[this.currentWaypointIdx];
        const distanceToTarget = closestWp ? Math.sqrt((this.x - closestWp.x)**2 + (this.z - closestWp.z)**2) : 0;
        const isOffPath = distanceToTarget > 12.0;
        let speedLimit = this.targetSpeed;

        if (isOffPath) {
            speedLimit = 2.8; // Low speed for corrections
            
            // Check if target is behind us. If so, put it in reverse!
            if (Math.abs(angleDiff) > Math.PI * 0.5) {
                this.controls.forward = false;
                this.controls.backward = true; // REVERSE
                this.controls.handbrake = false;
                
                // Steering is inverted when backing up
                this.steering = THREE.MathUtils.lerp(
                    this.steering,
                    THREE.MathUtils.clamp(-angleDiff * 2.5, -this.maxSteering, this.maxSteering),
                    this.steeringSpeed * dt
                );
                
                this.applyPhysics(dt);
                this.animateMesh(dt);
                this.updateStats(dt);
                return;
            }
        }

        /*
        // FUTURE REFERENCE: Lidar Curb Avoidance & Lane-Keep Assist (LKA)
        let leftCurbDist = Infinity;
        let rightCurbDist = Infinity;
        let frontCurbDist = Infinity;

        for (let i = 0; i < this.sensor.readings.length; i++) {
            const r = this.sensor.readings[i];
            if (r && r.type === 'curb') {
                const angle = this.sensor.rays[i].angle;
                if (i === 0) {
                    frontCurbDist = r.distance;
                } else if (angle > 0) {
                    leftCurbDist = Math.min(leftCurbDist, r.distance);
                } else {
                    rightCurbDist = Math.min(rightCurbDist, r.distance);
                }
            }
        }

        let curbSteeringCorrection = 0;
        const curbThreshold = 2.6;
        if (leftCurbDist < curbThreshold) {
            const factor = (curbThreshold - leftCurbDist) / curbThreshold;
            curbSteeringCorrection = -factor * 0.3;
        } else if (rightCurbDist < curbThreshold) {
            const factor = (curbThreshold - rightCurbDist) / curbThreshold;
            curbSteeringCorrection = factor * 0.3;
        }
        */

        // Apply smooth steering proportional control for forward driving
        this.steering = THREE.MathUtils.lerp(
            this.steering, 
            THREE.MathUtils.clamp(angleDiff * 2.5, -this.maxSteering, this.maxSteering), 
            this.steeringSpeed * dt
        );

        // 3. Dynamic speed scaling: Slow down in sharp curves to prevent sliding off-road
        // Scales speed down by up to 55% during extreme turns
        speedLimit = Math.min(speedLimit, this.targetSpeed * (1.0 - (Math.abs(this.steering) / this.maxSteering) * 0.55));

        // 4. Speed Control & Safety Logic (IDM)
        // Proximity detection via sensors
        let sensorReading = null;
        let sensorMinDist = this.sensor.rayLength;
        for (let i = 0; i < this.sensor.readings.length; i++) {
            const r = this.sensor.readings[i];
            if (r && r.distance < sensorMinDist) {
                sensorMinDist = r.distance;
                sensorReading = r;
            }
        }

        // Act on sensor triggers
        if (sensorReading) {
            const dist = sensorReading.distance;
            
            if (sensorReading.type === 'traffic_car') {
                // Slow down or stop behind front car
                if (dist < this.safetyDistance) {
                    speedLimit = 0; // stop!
                } else {
                    // Match speed proportional to distance
                    speedLimit = Math.min(speedLimit, ((dist - this.safetyDistance) / 15) * this.targetSpeed);
                }
            } else if (sensorReading.type === 'pedestrian') {
                // Pedestrian detected at crossing
                if (dist < 20.0) {
                    speedLimit = 0; // stop and wait
                }
            }
        }

        // 3. Traffic Lights Compliance (Global Intersection node 0)
        // If the car is heading towards central node (0, 0) and light is not Green
        const distToCenter = Math.sqrt(this.x*this.x + this.z*this.z);
        if (distToCenter < 35.0 && distToCenter > 10.0) {
            const headingVec = new THREE.Vector2(Math.sin(this.angle), Math.cos(this.angle)).normalize();
            const toCenterVec = new THREE.Vector2(-this.x, -this.z).normalize();
            const headingDotCenter = headingVec.dot(toCenterVec);

            if (headingDotCenter > 0.3) {
                // Determine heading direction
                let approachDir = '';
                if (this.x < -10.0 && Math.abs(this.z) < 15.0) approachDir = 'west';
                else if (this.x > 10.0 && Math.abs(this.z) < 15.0) approachDir = 'east';
                else if (this.z < -10.0 && Math.abs(this.x) < 15.0) approachDir = 'north';
                else if (this.z > 10.0 && Math.abs(this.x) < 15.0) approachDir = 'south';

                if (approachDir) {
                    const matchingLight = network.trafficLights.find(tl => tl.direction === approachDir);
                    if (matchingLight) {
                        const currentCycle = network.lightCycles[network.lightState];
                        const lightColor = approachDir === 'north' || approachDir === 'south' ? currentCycle.ns : currentCycle.ew;
                        
                        if (lightColor === 'red' || lightColor === 'yellow') {
                            // Slow down to a stop before the stop line (about 12 meters from center)
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
        }

        // 4. Zebra Crossing stops
        // Scan for zebra crossings nearby in the path direction
        network.zebraCrossings.forEach(zc => {
            const zcDist = Math.sqrt((this.x - zc.x)**2 + (this.z - zc.z)**2);
            if (zcDist < 25.0 && zcDist > 5.0 && zc.pedestrianCrossingActive) {
                // Check if car is heading towards it
                // Dot product of heading vector and relative vector to zebra
                const relativeVec = new THREE.Vector2(zc.x - this.x, zc.z - this.z).normalize();
                const headingVec = new THREE.Vector2(Math.sin(this.angle), Math.cos(this.angle)).normalize();
                const dot = headingVec.dot(relativeVec);
                
                if (dot > 0.8) {
                    // Slow down to stop before zebra crossing (5m buffer)
                    const stopDist = zcDist - 6.0;
                    if (stopDist > 0) {
                        speedLimit = Math.min(speedLimit, (stopDist / 15.0) * this.targetSpeed);
                    } else {
                        speedLimit = 0;
                    }
                }
            }
        });

        // 5. Apply throttle / brake based on target speed limit
        if (this.speed < speedLimit) {
            this.controls.forward = true;
            this.controls.backward = false;
            this.controls.handbrake = false;
        } else if (this.speed > speedLimit + 1.0) {
            this.controls.forward = false;
            this.controls.backward = true; // Brake
            this.controls.handbrake = false;
        } else {
            this.controls.forward = false;
            this.controls.backward = false;
            this.controls.handbrake = false;
        }

        // Run kinematic updates
        this.applyPhysics(dt);
        this.animateMesh(dt);
        this.updateStats(dt);
    }

    advanceWaypoints() {
        // Find if we are close to current waypoint, if so advance
        const buffer = 4.0; // meters threshold
        while (this.currentWaypointIdx < this.waypoints.length) {
            const wp = this.waypoints[this.currentWaypointIdx];
            const dist = Math.sqrt((this.x - wp.x)**2 + (this.z - wp.z)**2);
            
            const isLastWp = (this.currentWaypointIdx === this.waypoints.length - 1);
            const activeBuffer = isLastWp ? 6.5 : buffer;

            if (dist < activeBuffer) {
                this.currentWaypointIdx++;
            } else {
                break;
            }
        }
    }

    updateStats(dt) {
        // 1. Distance accumulation
        const dx = this.x - this.lastX;
        const dz = this.z - this.lastZ;
        const frameDist = Math.sqrt(dx*dx + dz*dz);
        this.totalDistance += frameDist;
        
        this.lastX = this.x;
        this.lastZ = this.z;

        // 2. Collision checks (against traffic)
        // Handled in main.js, which increments this.collisions

        // 3. Safety Score deduction logic
        // Starts at 100%. Deducts for:
        // - Collisions: -20% each
        // - Hard braking / G-Force spike: -0.5% each
        // - Running close to obstacles: proportional deduction
        if (this.acceleration < -10.0) {
            this.safetyScore = Math.max(0, this.safetyScore - 0.1 * dt);
        }
        
        const minLidar = this.sensor.getMinDistance();
        if (minLidar < 6.0 && this.speed > 3.0) {
            this.safetyScore = Math.max(0, this.safetyScore - 0.2 * dt);
        }
        
        // Decay collision penalties slowly, or hard lock it
        this.safetyScore = Math.max(0, 100.0 - (this.collisions * 25.0));
    }

    triggerCollision() {
        this.collisions++;
        this.speed = 0; // stop car on crash
        this.safetyScore = Math.max(0, this.safetyScore - 25.0);
    }

    reset(x = 0, z = 0, angle = 0) {
        super.reset(x, z, angle);
        this.totalDistance = 0;
        this.collisions = 0;
        this.safetyScore = 100.0;
        this.lastX = x;
        this.lastZ = z;
        this.isAutopilot = false;
        this.waypoints = [];
        this.currentWaypointIdx = 0;
        this.manualBrakingToStop = false;
    }
}
