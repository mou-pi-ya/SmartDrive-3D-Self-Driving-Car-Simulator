import * as THREE from 'three';

export class Car {
    constructor(scene, color = 0x00f2fe) {
        this.scene = scene;
        this.color = color;
        
        // Physics States
        this.x = 0;
        this.z = 0;
        this.y = 0;
        this.angle = 0; // heading angle in radians
        this.speed = 0; // m/s
        this.acceleration = 0; // m/s^2
        this.steering = 0; // radians
        
        // Settings & Constants
        this.maxSpeed = 22; // m/s (approx 80 km/h)
        this.maxReverseSpeed = -6;
        this.accelPower = 8.0; // m/s^2 acceleration force
        this.brakingPower = 20.0; // braking deceleration force
        this.friction = 1.8; // passive rolling resistance
        this.drag = 0.05; // aerodynamic drag
        this.maxSteering = 0.6; // max steering angle (approx 35 degrees)
        this.steeringSpeed = 4.0; // steering responsiveness
        this.wheelBase = 2.8; // distance between front and rear axles
        
        // Control flags
        this.controls = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            handbrake: false
        };
        
        // 3D Objects references
        this.mesh = null;
        this.wheels = {
            frontLeft: null,
            frontRight: null,
            backLeft: null,
            backRight: null
        };
        this.lights = {
            headLeft: null,
            headRight: null,
            tailLeft: null,
            tailRight: null
        };

        this.buildMesh();
    }

    buildMesh() {
        this.mesh = new THREE.Group();

        // 1. Chassis (Lower Body)
        const chassisGeo = new THREE.BoxGeometry(2.0, 0.6, 4.5);
        const chassisMat = new THREE.MeshStandardMaterial({ 
            color: this.color, 
            roughness: 0.2, 
            metalness: 0.8 
        });
        const chassis = new THREE.Mesh(chassisGeo, chassisMat);
        chassis.position.y = 0.5;
        chassis.castShadow = true;
        chassis.receiveShadow = true;
        this.mesh.add(chassis);

        // 2. Cabin (Upper Body)
        const cabinGeo = new THREE.BoxGeometry(1.8, 0.6, 2.4);
        const cabinMat = new THREE.MeshStandardMaterial({ 
            color: 0x111827, 
            roughness: 0.1, 
            metalness: 0.9 
        });
        const cabin = new THREE.Mesh(cabinGeo, cabinMat);
        cabin.position.set(0, 1.1, -0.2); // Slipped slightly backward
        cabin.castShadow = true;
        this.mesh.add(cabin);

        // Windshields / Windows (Details)
        const windowMat = new THREE.MeshPhysicalMaterial({
            color: 0x00c6ff,
            transparent: true,
            opacity: 0.4,
            roughness: 0.1,
            metalness: 0.1,
            transmission: 0.9
        });
        const frontWindowGeo = new THREE.PlaneGeometry(1.7, 0.5);
        const frontWindow = new THREE.Mesh(frontWindowGeo, windowMat);
        frontWindow.position.set(0, 1.1, 1.01);
        frontWindow.rotation.x = -Math.PI / 6;
        this.mesh.add(frontWindow);

        // 3. Wheels
        const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.4, 16);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9 });
        
        // Wheel Hubcaps
        const capGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.42, 8);
        const capMat = new THREE.MeshStandardMaterial({ color: 0xbdc3c7, metalness: 0.8 });

        const createWheel = (x, z) => {
            const wheelGroup = new THREE.Group();
            
            const tire = new THREE.Mesh(wheelGeo, wheelMat);
            tire.rotation.z = Math.PI / 2;
            tire.castShadow = true;
            wheelGroup.add(tire);
            
            const cap = new THREE.Mesh(capGeo, capMat);
            cap.rotation.z = Math.PI / 2;
            wheelGroup.add(cap);

            wheelGroup.position.set(x, 0.42, z);
            this.mesh.add(wheelGroup);
            return wheelGroup;
        };

        // Axle positions: front=1.4m forward, back=1.4m backward, width=1.05m
        this.wheels.frontLeft = createWheel(-1.05, 1.4);
        this.wheels.frontRight = createWheel(1.05, 1.4);
        this.wheels.backLeft = createWheel(-1.05, -1.4);
        this.wheels.backRight = createWheel(1.05, -1.4);

        // 4. Headlights (White/Yellow bulbs)
        const headlightGeo = new THREE.BoxGeometry(0.3, 0.15, 0.15);
        const headbulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        
        const hl = new THREE.Mesh(headlightGeo, headbulbMat);
        hl.position.set(-0.7, 0.5, 2.26);
        this.mesh.add(hl);
        this.lights.headLeft = hl;

        const hr = new THREE.Mesh(headlightGeo, headbulbMat);
        hr.position.set(0.7, 0.5, 2.26);
        this.mesh.add(hr);
        this.lights.headRight = hr;

        // 5. Taillights (Red bulbs)
        const taillightGeo = new THREE.BoxGeometry(0.3, 0.12, 0.15);
        const tailbulbMat = new THREE.MeshBasicMaterial({ color: 0x550000 }); // dull red
        
        const tl = new THREE.Mesh(taillightGeo, tailbulbMat);
        tl.position.set(-0.7, 0.5, -2.26);
        this.mesh.add(tl);
        this.lights.tailLeft = tl;

        const tr = new THREE.Mesh(taillightGeo, tailbulbMat);
        tr.position.set(0.7, 0.5, -2.26);
        this.mesh.add(tr);
        this.lights.tailRight = tr;

        this.scene.add(this.mesh);
    }

    update(dt) {
        this.applyPhysics(dt);
        this.animateMesh(dt);
    }

    applyPhysics(dt) {
        const lastSpeed = this.speed;
        
        // Accelerate / Brake logic
        if (this.controls.forward) {
            if (this.speed < 0) {
                // Braking backward momentum
                this.speed += this.brakingPower * dt;
            } else {
                this.speed += this.accelPower * dt;
            }
        } else if (this.controls.backward) {
            if (this.speed > 0) {
                // Braking forward momentum
                this.speed -= this.brakingPower * dt;
            } else {
                this.speed -= this.accelPower * dt;
            }
        } else {
            // Apply passive friction/drag
            const decel = (this.friction + Math.abs(this.speed) * this.drag) * dt;
            if (Math.abs(this.speed) < decel) {
                this.speed = 0;
            } else {
                this.speed -= Math.sign(this.speed) * decel;
            }
        }

        // Clamp Speed
        this.speed = THREE.MathUtils.clamp(this.speed, this.maxReverseSpeed, this.maxSpeed);

        // Handbrake stops vehicle instantly (for safety override)
        if (this.controls.handbrake) {
            const brake = this.brakingPower * 2 * dt;
            if (Math.abs(this.speed) < brake) {
                this.speed = 0;
            } else {
                this.speed -= Math.sign(this.speed) * brake;
            }
        }

        // Steer turning angle logic
        const targetSteer = this.controls.left ? this.maxSteering : 
                             (this.controls.right ? -this.maxSteering : 0);
        
        // Linear interpolation to steer smoothly
        this.steering += (targetSteer - this.steering) * this.steeringSpeed * dt;

        // Kinematic bicycle model updates:
        // angle + speed are used to shift position
        if (this.speed !== 0) {
            // Calculate distance traversed
            const distance = this.speed * dt;
            // Angle change depends on steering and wheelbase
            const dAngle = (distance / this.wheelBase) * Math.sin(this.steering);
            this.angle += dAngle;
            
            // Move position (X is positive to the right, Z is positive forwards in the model)
            // Three.js coordinates: +X right, +Z down, -Z up. Let's map heading to Z-axis.
            this.x += Math.sin(this.angle) * distance;
            this.z += Math.cos(this.angle) * distance;
        }

        // Record acceleration for telemetry (approximated)
        this.acceleration = dt > 0 ? (this.speed - lastSpeed) / dt : 0;
    }

    animateMesh(dt) {
        // Position car group
        this.mesh.position.set(this.x, this.y, this.z);
        this.mesh.rotation.y = this.angle;

        // Steering animations for front wheels
        this.wheels.frontLeft.rotation.y = this.steering;
        this.wheels.frontRight.rotation.y = this.steering;

        // Wheel rolling animations based on speed
        // circumference = 2 * pi * r (approx 2.6m)
        const rotationAngle = (this.speed * dt) / 0.42;
        this.wheels.frontLeft.rotation.x += rotationAngle;
        this.wheels.frontRight.rotation.x += rotationAngle;
        this.wheels.backLeft.rotation.x += rotationAngle;
        this.wheels.backRight.rotation.x += rotationAngle;

        // Update brake lights glow
        const isBraking = (this.controls.backward && this.speed > 0) || 
                          (this.controls.forward && this.speed < 0) || 
                          this.controls.handbrake;

        if (isBraking) {
            this.lights.tailLeft.material.color.setHex(0xff0000); // bright red
            this.lights.tailRight.material.color.setHex(0xff0000);
        } else {
            this.lights.tailLeft.material.color.setHex(0x550000); // dim red
            this.lights.tailRight.material.color.setHex(0x550000);
        }
    }

    setHeadlightState(state) {
        // state = 0 (Day - off), 1 (Sunset - dim), 2 (Night - bright)
        if (state === 0) {
            this.lights.headLeft.material.color.setHex(0xaaaaaa);
            this.lights.headRight.material.color.setHex(0xaaaaaa);
        } else if (state === 1) {
            this.lights.headLeft.material.color.setHex(0xffe066);
            this.lights.headRight.material.color.setHex(0xffe066);
        } else {
            this.lights.headLeft.material.color.setHex(0xffffff);
            this.lights.headRight.material.color.setHex(0xffffff);
        }
    }

    reset(x = 0, z = 0, angle = 0) {
        this.x = x;
        this.z = z;
        this.angle = angle;
        this.speed = 0;
        this.acceleration = 0;
        this.steering = 0;
        this.controls.forward = false;
        this.controls.backward = false;
        this.controls.left = false;
        this.controls.right = false;
        this.controls.handbrake = false;
        
        this.mesh.position.set(this.x, this.y, this.z);
        this.mesh.rotation.y = this.angle;
    }

    destroy() {
        this.scene.remove(this.mesh);
    }
}
