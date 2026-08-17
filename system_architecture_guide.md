# 3D Self-Driving Simulator: Architecture & Technical Guide

This guide provides a deep-dive explanation of the codebase structure, technologies, physical systems, and mathematical algorithms implemented in the **SmartDrive 3D Self-Driving Car Simulator**.

---

## 🗺️ Architectural Overview

The simulator operates on a client-server architecture separating the **heavy pathfinding computation** (Python backend) from the **real-time 3D simulation and physics updates** (HTML5/Three.js frontend).

```mermaid
graph TD
    subgraph Frontend (Three.js / JavaScript)
        A[main.js - Sim Engine] --> B[SelfDrivingCar.js]
        A --> C[TrafficManager.js]
        A --> D[RoadNetwork.js]
        B -->|Sensor Casts| E[Raycaster Obstacles]
        C -->|NPC Loopers| A
    end
    subgraph Backend (Flask / Python)
        F[app.py - Flask Server] --> G[A* Pathfinding Router]
    end
    B -->|HTTP POST Request| F
    F -->|Nodes Path Array| B
```

---

## 🛠️ Technology Stack

1. **Three.js (WebGL Web Graphics Engine)**: Handles rendering of 3D entities, cameras, lighting, shadows, materials, and provides mathematical utilities like Vector calculations and Quadratic Bezier interpolation.
2. **Vite (Frontend Dev Server & Bundler)**: Hot-reloads ES Modules dynamically, ensuring seamless frontend updates during code adjustments.
3. **Python & Flask (Pathfinding Server)**: Lightweight backend API server responsible for hosting the road network topology and executing A* routing queries on request.
4. **HTML5 Canvas & Glassmorphism CSS**: Renders the telemetry indicators, navigation forms, camera viewport selectors, and manual keyboard shortcuts list as an overlaid UI.

---

## 📂 File Structure & Responsibilities

### 1. `app.py` (Python Routing Server)
* **Graph Network**: Represents the road circuit as nodes (intersections/turns/parking slots) and directional edges (connecting streets) with physical coordinates.
* **A* Pathfinding**: Implementation of the A* search algorithm using the standard Euclidean distance heuristic $h(n) = \sqrt{(x_2-x_1)^2 + (z_2-z_1)^2}$.
* **API Endpoint**: Listens at `/api/route` for JSON queries containing `start` and `end` node identifiers and returns a sequential node array.

### 2. `src/main.js` (Simulation Lifecycle Coordinator)
* **Three.js Setup**: Initializes the WebGL renderer, perspective cameras, scene lighting (directional sunlight casting shadows, ambient sky-light), and handles viewport resizing.
* **Coordinate Loop**: Runs the `requestAnimationFrame` loop, updating the delta-time ($dt$), physics states, sensor casting, traffic lights cycles, and rendering the scene.
* **Input Management**: Binds the keyboard event listeners (WASD and Arrow keys) to override the autopilot instantly, triggering the manual deceleration sequence.

### 3. `src/simulator/Car.js` (Vehicle Physics Base Class)
Implements custom Newtonian physics on a 2D plane projected into 3D space:
* **Forces**: Acceleration and braking adjust the vehicle's linear velocity. Friction and air resistance are simulated by decay factors:
  $$\text{speed} \leftarrow \text{speed} \times (1.0 - \text{friction} \times dt)$$
* **Steering & Yaw (Angle)**: Steering inputs rotate the vehicle's heading vector over time:
  $$\Delta \text{angle} = \text{speed} \times \sin(\text{steering}) \times dt$$
  $$\text{angle} \leftarrow \text{angle} + \Delta \text{angle}$$
* **Symmetry**: Holds coordinate updates and triggers 3D mesh translations (`mesh.position`) and rotations (`mesh.rotation.y`).

### 4. `src/simulator/SelfDrivingCar.js` (Autopilot Controller)
Contains the self-driving navigation logic, sensor mechanics, and recovery routines:
* **Look-Ahead Scaling (Pure Pursuit)**: To prevent steering oscillation at high speeds, the look-ahead distance scales linearly with speed:
  $$L = \text{speed} \times 0.85 + 4.5\text{ meters}$$
  The car steers towards the point on the path exactly $L$ meters in front of it.
* **Lidar Sensor array**: Casts multiple raycasts outward in a radial fan (spread over 90 degrees) to calculate obstacle distances (traffic cars, pedestrians, and curbs).
* **Off-Road Recovery**: A state-machine that triggers if the car deviates $>12.0\text{m}$ from the waypoints. It shifts to reverse gear, backs up to realign, and shifts forward to return to the lane.

### 5. `src/simulator/RoadNetwork.js` (Procedural Layout Constructor)
* **Road Surfaces**: Creates horizontal and vertical plane meshes with tarmac textures, lane dividers, zebra crossings, and parking slot guides.
* **Boundaries & Curbs**: Spawns physical curb walls on either side of the roads. Shortens straight curbs by 7 meters at junctions to prevent intersecting and causing false Lidar detections.
* **Traffic Lights**: Manages intersection traffic light meshes. Operates a state timer cycling through green, yellow, and red phases.

### 6. `src/simulator/TrafficManager.js` (NPC Looping Coordinator)
* **Hemisphere Segmentation**: Controls 4 distinct cars locked to independent, clockwise D-shaped sector loops (East, West, North, South hemispheres).
* **Bezier Curve Pathing**: Generates smooth Bezier curves for NPC turns inside `generateNextSegmentPath()`, forcing them to align with curved roads.
* **Transition Donut Fix**: Skips initial waypoints of a new segment if they lie behind the car or are within 6.0m, preventing cars from spinning in circles on segment shifts.

---

## 🧮 Detailed Algorithmic Explanations

### 1. Pure Pursuit Steering Angle calculation
Inside `SelfDrivingCar.js`, the steer angle calculation is done as follows:
```javascript
const relativeTargetX = dx * Math.cos(-this.angle) - dz * Math.sin(-this.angle);
const relativeTargetZ = dx * Math.sin(-this.angle) + dz * Math.cos(-this.angle);

// Calculate steering angle based on look-ahead curvature
const angleDiff = Math.atan2(relativeTargetX, relativeTargetZ);
this.controls.left = angleDiff < -0.05;
this.controls.right = angleDiff > 0.05;
```
This projects the target waypoint into the vehicle's local frame of reference. The heading error is then calculated, driving the steering rate.

### 2. Intersection Bezier Curve Smoothing
To navigate 90-degree corners smoothly, straight road segments are clipped 12 meters before a turn, and a quadratic Bezier curve is interpolated:
$$\mathbf{B}(t) = (1-t)^2\mathbf{P}_0 + 2(1-t)t\mathbf{P}_{\text{control}} + t^2\mathbf{P}_1, \quad t \in [0, 1]$$
* $\mathbf{P}_0$: End of the incoming straight segment (12m before intersection).
* $\mathbf{P}_{\text{control}}$: The actual intersection node coordinate.
* $\mathbf{P}_1$: Start of the outgoing straight segment (12m after intersection).

### 3. Dot-Product Direction Filters
Used to prevent vehicles from stopping inside intersections due to adjacent red lights, and to ignore oncoming vehicles:
```javascript
const headingVec = new THREE.Vector2(Math.sin(this.angle), Math.cos(this.angle)).normalize();
const toCenterVec = new THREE.Vector2(-this.x, -this.z).normalize();
const headingDotCenter = headingVec.dot(toCenterVec);
```
If `headingDotCenter < 0.3`, it means the vehicle is moving perpendicular to or away from the central intersection, meaning it has already entered or is exiting it, so it ignores the traffic lights.

For collision checks:
```javascript
const headingDot = thisHeading.dot(otherHeading);
if (headingDot >= 0.0) {
    // Both cars heading in the same direction -> check lead distance
} else {
    // Oncoming car in adjacent lane -> ignore
}
```

---

## 🎨 UI & Spacing Customization

1. **Left-Hand Drive offset**: The offset distance from the centerline is set to `-3.2m` (left side of road direction), matching Indian Standard.
2. **Glassmorphism Panels**: Uses CSS backdrop filter blur, semi-transparent dark backgrounds (`rgba(15, 22, 38, 0.55)`), and thin borders to create high-end visual cards.
3. **Responsive Sidebars**: Positioned on the left side (Manual Control instructions) and right side (Telemetry data, routing controls, simulation options) to avoid overlay clutter.
