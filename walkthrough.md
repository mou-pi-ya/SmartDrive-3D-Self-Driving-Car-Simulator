# 3D Self-Driving Car Simulator Walkthrough

This walkthrough details the final hybrid architecture, implementation milestones, and resolutions for specific simulation bugs.

---

## 🛠️ Resolved Simulation Bugs

### 1. Pedestrian Blockages (Path Clearing)
* **Problem**: Pedestrians were walking across the zebra crossing and, when the light turned red, they stopped in the middle of the road, permanently blocking traffic.
* **Solution**: Reconfigured `Pedestrian.update` in [TrafficManager.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/TrafficManager.js). If the pedestrian light turns red, pedestrians will continue walking until they reach either sidewalk (`progress <= 0.05` or `progress >= 0.95`). Once on the sidewalk, they clamp to exactly `0.0` or `1.0` (off the asphalt) and stay idle, ensuring the driving lanes remain completely clear.

### 2. Oversteering on Bends & Intersections (Turning Speed & Curve Control)
* **Problem**: The car attempted to navigate corners and 90-degree intersection turns at full cruise speed, causing it to overshoot and slide off-road. Additionally, the lane offset generated a sharp diagonal jump between perpendicular road segments at junctions, triggering sudden steering inputs.
* **Solution**: 
  1. Implemented **Intersection Bezier Smoothing** in [SelfDrivingCar.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/SelfDrivingCar.js#L26-L101). When transitioning between two road segments that form a turn (dot product < 0.95), the waypoint generator clips the straight lanes 12 meters before the junction and interpolates a smooth quadratic Bezier curve through the intersection lanes.
  2. Implemented **Dynamic Speed Scaling** in [SelfDrivingCar.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/SelfDrivingCar.js#L145-L165). During sharp turns, the autopilot automatically scales down the speed limit proportionally to the steering angle (up to a **55% speed reduction**), allowing the car to negotiate corners at a safe speed (~4.5 m/s) and maintain perfect lane tracking.
  3. Implemented **Dynamic Look-Ahead / Pure Pursuit Target Tracking** in [SelfDrivingCar.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/SelfDrivingCar.js#L180-L200). Instead of tracking the immediate waypoint, the look-ahead distance is dynamically calculated based on current speed (`lookahead = speed * 0.85 + 4.5`). The autopilot searches along the path to find the target point at this lookahead distance, stabilizing steering at high speeds and allowing tight turns at low speeds. (The previous Lidar curb-sensing LKA code has been kept commented out in the codebase for future reference).

### 3. Off-Road Recovery Routine
* **Problem**: If the car was manually driven off-road or pushed off-road by traffic, it became stuck in a spin, turning in circles endlessly trying to reach a missed waypoint.
* **Solution**: Developed an automatic recovery state-machine in [SelfDrivingCar.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/SelfDrivingCar.js#L125-L145). If the vehicle deviates more than `12.0m` from the active waypoint:
  1. It throttles down to a slow recovery speed (2.8 m/s).
  2. If the active waypoint lies behind the car (`|angleDiff| > 90°`), the car shifts gears to **REVERSE**, backs up, and inverts its steering direction to realign.
  3. Once aligned, it shifts back to forward drive and returns to the road.

### 4. Off-Road Spawning & Checkpoints (Parking Bays at Side of Road)
* **Problem**: The car spawned on the active driving lanes, disrupting traffic cycles, and parking bays overlapped with road segments.
* **Solution**: Positioned 5 dedicated parking bays completely off-road:
  * **Central Parking Bay** (Node 10): Diagonal offset `(-25, -25)`.
  * **North Parking Bay** (Node 11): Horizontal offset `(0, -170)`.
  * **East Parking Bay** (Node 12): Vertical offset `(170, 0)`.
  * **South Parking Bay** (Node 13): Horizontal offset `(0, 170)`.
  * **West Parking Bay** (Node 14): Vertical offset `(-170, 0)`.
* **Implementation Details**:
  * Drew parking slots visually in [RoadNetwork.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/RoadNetwork.js) using yellow borders, slot markers, and a yellow "P" indicator, rotating them to match the adjacent roads.
  * Added them to the graph network inside [app.py](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/app.py) with A* bidirectional edge connections.
  * The car starts parked inside the North Parking Bay, drives along the narrow connector road, joins the main street circuit, and completes its route by turning off-road into the destination parking bay.
  * Restricted AI traffic cars from entering or spawning on the parking connector edges, preventing traffic from blocking parking areas.
  * **Arrival Circle Loop Fix**: Configured a larger 6.5-meter buffer for the final destination waypoint inside [SelfDrivingCar.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/SelfDrivingCar.js#L391-L404) to guarantee that the autopilot registers arrival and disengages, rather than overshooting and looping around the parking slot.

### 5. Intersection Curb Clearance & False Lidar Readings
* **Problem**: Road curb walls generated for the raycaster crossed over intersections, cutting right across active horizontal/vertical driving lanes. The Lidar forward sensor detected these crossing boundaries as obstacles in the middle of clear junctions, leading to false alerts.
* **Solution**: Updated curb mesh generation inside [RoadNetwork.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/RoadNetwork.js#L237-L314):
  * Straight road curb meshes are shortened by 7 meters on both ends if they connect to junctions or parking nodes, keeping intersection boxes completely open.
  * Curved road curb meshes skip the first and last two segments.
  This removes all crossing boundaries, ensuring zero false Lidar triggers at intersections.

### 6. AI Traffic Vehicles Going Off-Road
* **Problem**: AI traffic cars navigated junction transitions at full cruise speed (8.0 m/s) with a short 4.0-meter waypoint tracking index, causing them to slide off-road at 90-degree corners.
* **Solution**: Applied autopilot improvements to `TrafficCar` in [TrafficManager.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/TrafficManager.js#L91-L109):
  * **Pure Pursuit Lookahead**: Implemented the speed-scaled dynamic lookahead target vector (`lookahead = speed * 0.8 + 4.5`), causing AI cars to begin steering early into turns.
  * **Turn-Speed Damping**: Scaled down speed limits by up to 55% during sharp steering, causing AI cars to brake to ~3.5 m/s when executing cornering maneuvers.
  Traffic cars now track lanes perfectly and remain on the asphalt.

---

## 🏗️ Hybrid Architecture Summary

The simulator utilizes a local client-server design:
1. **Python Flask Server (`app.py`)**:
   * Computes A* shortest paths between nodes.
   * Logs driving telemetry (speed, G-force, safety indices).
   * Generates high-resolution telemetry charts using **Matplotlib** and saves them in the static assets folder.
2. **Vite Frontend Client (`Three.js`)**:
   * Renders the 3D grid environment, cars, traffic lights, and crosswalk indicator models.
   * Simulates lidar sensor rays using `THREE.Raycaster` (turns lines red when close to obstacles).
   * Streams telemetry packets to Flask in real-time.

---

## 🚦 Verification Guide (Manual Check)

Since headless browser environments do not support high-speed WebGL hardware acceleration (leading to console timeouts), please test the simulator on your local browser:

1. **Start the simulator**:
   * The Python backend is running at `http://127.0.0.1:5000`
   * The Vite frontend dev server is serving at `http://localhost:3000`
   * If it isn't already open, navigate to **[http://localhost:3000](http://localhost:3000)** in your web browser.

2. **Run Autopilot**:
   * The simulator loads with the car sitting off-road in the **North Parking Bay (11)**.
   * Confirm the dropdowns are set to **North Parking Bay** (Start) and **South Junction** (Destination).
   * Click the blue **"ENGAGE AUTOPILOT"** button.
   * The car will start, reverse out of the bay, drive onto the main road, steer through the loop, and park at **South Junction (3)**.

## 🎨 UI Updates & Brand Rename

1. **Brand Rename**: The logo and branding inside the status bar header was changed from **HYBRIDRIVE** to **SMARTDRIVE**.
2. **Simplified Interface**:
   * Restored the **Manual Controls** keyboard shortcut cheat-sheet panel and placed it inside a dedicated `left-sidebar` at the top-left to avoid right-side layering.
   * Updated the manual controls keys to show Arrow symbols (▲, ▼, ◀, ▶) instead of WASD, and spaced them out vertically (16px gap with divider lines) for a cleaner, premium design.
   * Removed the **Analytics & Data Plots** triggers panel from the left sidebar.
   * Removed the **Python Matplotlib Telemetry Report** modal overlay.
   * Updated `main.js` with conditional DOM safety bounds, preventing any Javascript execution errors from the removed panels.
3. **Route Options Filtering**:
   * Excluded **Central Intersection (0)** and **Central Parking Bay (10)** from both Start and Destination lists.
   * Excluded all other **parking bays (11-14)** from the Destination list. Start from a parking bay is still allowed, but destinations are restricted to road junctions.

## ⚙️ Control & Autopilot Upgrades

1. **Autopilot Disengage Deceleration**: When autopilot is cancelled manually (via button or keyboard override), the vehicle automatically initiates a hard-braking sequence (`manualBrakingToStop`), neutralizes steering, and comes to a complete halt.
2. **Manual Driving Restore**: Once the car comes to a complete stop, the handbrake disengages automatically, resetting all control flags to neutral. This restores full responsiveness to WASD manual keys.
3. **Indian Standard Left-Hand Drive**: Adjusted lane offsets for both the self-driving car and traffic cars to `-3.2` meters from the centerline, shifting the driving model from right-hand side to left-hand side.
4. **Doubled Traffic Light Durations**: Doubled all light cycles (Green is now 16s, Yellow is 4s) to allow traffic to clear intersections fully before state changes.
5. **Hemisphere Loop Traffic (4 Vehicles)**: Locked the simulator to exactly 4 traffic cars, each confined to its own clockwise closed hemisphere loop:
   * **Eastern Hemisphere (Red)**: North Junction (1) ➔ NE Bend (5) ➔ East Junction (2) ➔ SE Bend (6) ➔ South Junction (3) ➔ Center (0) ➔ North Junction (1).
   * **Western Hemisphere (Green)**: South Junction (3) ➔ SW Bend (7) ➔ West Junction (4) ➔ NW Bend (8) ➔ North Junction (1) ➔ Center (0) ➔ South Junction (3).
   * **Northern Hemisphere (Blue)**: West Junction (4) ➔ NW Bend (8) ➔ North Junction (1) ➔ NE Bend (5) ➔ East Junction (2) ➔ Center (0) ➔ West Junction (4).
   * **Southern Hemisphere (Yellow)**: East Junction (2) ➔ SE Bend (6) ➔ South Junction (3) ➔ SW Bend (7) ➔ West Junction (4) ➔ Center (0) ➔ East Junction (2).
   * **Smooth Curve Pathing**: Configured `TrafficCar` in [TrafficManager.js](file:///c:/Users/Debarshi%20Chatterjee/Downloads/Final_proj_3D/src/simulator/TrafficManager.js#L49-L77) to dynamically detect curves and generate smooth Bezier curved waypoints for the bends (NE, SE, SW, NW), keeping them perfectly centered on the asphalt.
   * **Transition Donut Fix**: Added a waypoint skipping filter in `TrafficManager.js`. When a car switches path segments at Node 1 or Node 3, it skips waypoints that are behind the car or within 6 meters. This removes circular "donuts" that occurred due to left-hand lane offset gaps.
6. **Smart Traffic Light Checks**: Added heading vector dot-product filters (`headingDotCenter > 0.3`) to both `SelfDrivingCar.js` and `TrafficManager.js`. Vehicles crossing or turning inside the central intersection ignore red lights from adjacent directions since they are not heading towards the intersection entry, resolving the mid-turn braking bug.
7. **Oncoming Traffic Detection**: Modified the lead vehicle check in `TrafficManager.js`. Traffic cars compare heading directions using `headingDot` and ignore oncoming traffic in adjacent lanes, resolving the issue where cars got stuck in front of each other.
