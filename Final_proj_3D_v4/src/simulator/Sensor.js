import * as THREE from 'three';

export class Sensor {
    constructor(scene, car, rayCount = 7, rayLength = 50, raySpread = Math.PI / 2) {
        this.scene = scene;
        this.car = car;
        this.rayCount = rayCount;
        this.rayLength = rayLength;
        this.raySpread = raySpread;

        this.rays = [];
        this.readings = [];
        this.visualLines = [];
        this.enabled = true; // Visual toggle

        this.lineMaterial = new THREE.LineBasicMaterial({
            color: 0x00f2fe,
            transparent: true,
            opacity: 0.5
        });
        
        this.alertMaterial = new THREE.LineBasicMaterial({
            color: 0xff416c,
            transparent: true,
            opacity: 0.8
        });
    }

    update(obstacles) {
        this.castRays();
        this.getReadings(obstacles);
        this.drawVisuals();
    }

    castRays() {
        this.rays = [];
        
        // Raycasting from slightly above the bumper
        const carFrontY = 0.42; 
        
        for (let i = 0; i < this.rayCount; i++) {
            // Distribute ray angles symmetrically around heading direction
            const rayAngle = THREE.MathUtils.lerp(
                this.raySpread / 2,
                -this.raySpread / 2,
                this.rayCount === 1 ? 0.5 : i / (this.rayCount - 1)
            ) + this.car.angle;

            // Start of ray: front bumper region
            // Offset slightly forward from center of car
            const start = new THREE.Vector3(
                this.car.x + Math.sin(this.car.angle) * 2.2,
                carFrontY,
                this.car.z + Math.cos(this.car.angle) * 2.2
            );

            // End of ray
            const end = new THREE.Vector3(
                start.x + Math.sin(rayAngle) * this.rayLength,
                carFrontY,
                start.z + Math.cos(rayAngle) * this.rayLength
            );

            this.rays.push({ start, end, angle: rayAngle - this.car.angle });
        }
    }

    getReadings(obstacles) {
        this.readings = [];
        const raycaster = new THREE.Raycaster();

        for (let i = 0; i < this.rays.length; i++) {
            const ray = this.rays[i];
            
            // Set ray direction vector
            const direction = new THREE.Vector3().subVectors(ray.end, ray.start).normalize();
            raycaster.set(ray.start, direction);
            raycaster.far = this.rayLength;

            // Intersect with obstacles in scene (other cars, traffic lights, pedestrians)
            const intersects = raycaster.intersectObjects(obstacles, true);

            if (intersects.length === 0) {
                this.readings.push(null);
            } else {
                // Find closest intersection
                let closest = intersects[0];
                for (let j = 1; j < intersects.length; j++) {
                    if (intersects[j].distance < closest.distance) {
                        closest = intersects[j];
                    }
                }
                
                // Traverse up parent chain to extract userData type if any
                let obstacleType = 'unknown';
                let parent = closest.object;
                while (parent) {
                    if (parent.userData && parent.userData.type) {
                        obstacleType = parent.userData.type;
                        break;
                    }
                    parent = parent.parent;
                }

                this.readings.push({
                    x: closest.point.x,
                    y: closest.point.y,
                    z: closest.point.z,
                    distance: closest.distance,
                    type: obstacleType,
                    object: closest.object
                });
            }
        }
    }

    drawVisuals() {
        // Clear previous lines
        this.visualLines.forEach(line => this.scene.remove(line));
        this.visualLines = [];

        if (!this.enabled) return;

        for (let i = 0; i < this.rayCount; i++) {
            const ray = this.rays[i];
            const reading = this.readings[i];
            
            let endPoint = ray.end;
            let isAlert = false;

            if (reading) {
                endPoint = new THREE.Vector3(reading.x, reading.y, reading.z);
                // Alert if obstacle is within 15 meters
                if (reading.distance < 15.0) {
                    isAlert = true;
                }
            }

            // Draw line from car bumper to endpoint
            const points = [ray.start, endPoint];
            const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
            
            const line = new THREE.Line(
                lineGeo, 
                isAlert ? this.alertMaterial : this.lineMaterial
            );
            
            this.scene.add(line);
            this.visualLines.push(line);

            // If sensor hit something, draw a small glowing indicator dot at collision point
            if (reading) {
                const dotGeo = new THREE.SphereGeometry(0.15, 8, 8);
                const dotMat = new THREE.MeshBasicMaterial({ 
                    color: isAlert ? 0xff416c : 0x00ff87 
                });
                const dot = new THREE.Mesh(dotGeo, dotMat);
                dot.position.copy(endPoint);
                this.scene.add(dot);
                this.visualLines.push(dot);
            }
        }
    }

    getMinDistance() {
        let minDist = this.rayLength;
        this.readings.forEach(r => {
            if (r && r.distance < minDist) {
                minDist = r.distance;
            }
        });
        return minDist;
    }

    destroy() {
        this.visualLines.forEach(line => this.scene.remove(line));
    }
}
