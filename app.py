import os
import math
from typing import Dict, Optional
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='static')
CORS(app)  # Enable CORS for local dev server requests

# Ensure directories exist
os.makedirs('static/charts', exist_ok=True)
def calculate_reward(self, action: Dict[str, bool]) -> float:

        reward = 0.0
        car = self.environment.car
        
        # Calculate car direction
        angle_rad = np.radians(car.angle)
        direction_cos = np.cos(angle_rad)
        direction_sin = np.sin(angle_rad)
        
        # Road edge penalties - severe punishment for hitting road boundaries
        if car.y <= 160:  # Too close to top road edge (Y=150)
            reward -= 150  # Massive penalty for hitting top edge
        elif car.y <= 180:  # Warning zone near top edge
            reward -= 50   # Heavy penalty for being too close to top
        elif car.y >= 640:  # Too close to bottom road edge (Y=650)
            reward -= 150  # Massive penalty for hitting bottom edge
        elif car.y >= 620:  # Warning zone near bottom edge
            reward -= 50   # Heavy penalty for being too close to bottom
        

        if 200 <= car.y <= 600:  # Safe zone within road
            reward += 10  # Reward for staying in safe zone
        

        if direction_cos > 0 and 180 <= car.y <= 620:  # Facing forward and on road
            reward += car.speed * 8  # Increased from 4 to 8 - stronger forward movement reward
        elif direction_cos <= 0:  # Facing backwards (U-turn penalty)
            reward -= car.speed * 8  # Heavy penalty for moving backwards
        

        min_sensor = min(car.sensor_readings)
        front_sensors = car.sensor_readings[2:5]  # Front sensors
        min_front_sensor = min(front_sensors)
        

        if min_sensor < 20:
            reward -= 500  # VERY HARSH collision penalty
        elif min_sensor < 40:
            reward -= 300  # VERY HARSH close collision penalty
        elif min_sensor < 60:
            reward -= 150  # VERY HARSH warning penalty
        elif min_sensor < 80:
            reward -= 50   # VERY HARSH early warning penalty
        elif min_sensor > 120:
            reward += 8    # Reward for maintaining very safe distance
        elif min_sensor > 100:
            reward += 5    # Reward for maintaining safe distance
        

        if min_front_sensor < 100:  # Obstacle ahead
            if action.get('turn_left', False) or action.get('turn_right', False):
                # Reward swerving to avoid obstacles
                if min_front_sensor < 80:
                    reward += 25  # High reward for swerving when close
                elif min_front_sensor < 120:
                    reward += 15  # Medium reward for early swerving
                else:
                    reward += 8   # Small reward for preventive swerving
            elif action.get('brake', False):
                # Lower reward for braking (but still positive if necessary)
                if min_front_sensor < 60:
                    reward += 10  # Necessary braking
                elif min_front_sensor < 80:
                    reward += 5   # Early braking (good but less than swerving)
                else:
                    reward -= 2   # Unnecessary braking
        

        if min_front_sensor < 120 and car.speed > 3:  # Fast approach to obstacle
            if action.get('brake', False):
                reward += 12  # Reward early braking when going fast
            elif action.get('turn_left', False) or action.get('turn_right', False):
                reward += 20  # Higher reward for early swerving when going fast
        

        if 180 <= car.y <= 620:
            lane_positions = [200, 400, 600]
            target_y = lane_positions[car.lane]
            lane_deviation = abs(car.y - target_y)
            if lane_deviation < 10:
                reward += 12  # Increased reward for good lane keeping
            elif lane_deviation > 50:
                reward -= 20  # Increased penalty for poor lane keeping
        
        # Traffic light compliance
        light_state, distance_to_light = self.get_traffic_light_info()
        if light_state == "red" and distance_to_light < 100:
            if action.get('brake', False):
                reward += 15  # Good, stopping for red light
            elif action.get('accelerate', False):
                reward -= 50  # Severe penalty for running red light
        
        # U-turn prevention - VERY HARSH penalty for facing backwards
        if abs(car.angle) > 90:
            reward -= 200  # VERY HARSH penalty for U-turns
        elif abs(car.angle) > 45:
            reward -= 100  # VERY HARSH penalty for excessive turning
        
        # Road edge avoidance behavior rewards
        if action.get('turn_left', False) and car.y > 580:  # Turning away from bottom edge
            reward += 20  # Increased reward for avoiding bottom edge
        elif action.get('turn_right', False) and car.y < 220:  # Turning away from top edge
            reward += 20  # Increased reward for avoiding top edge
        elif action.get('turn_left', False) and car.y < 220:  # Turning toward top edge
            reward -= 30  # Penalty for turning toward top edge
        elif action.get('turn_right', False) and car.y > 580:  # Turning toward bottom edge
            reward -= 30  # Penalty for turning toward bottom edge
        
        # Reduced general turning penalties (encourage swerving)
        if action.get('turn_left', False) or action.get('turn_right', False):
            if abs(car.angle) > 30:  # Already turned, don't turn more
                reward -= 4   # Further reduced penalty (was 8)
            elif min_front_sensor > 100:  # Turning without obstacle nearby
                reward -= 0.5  # Very small penalty for unnecessary turning (was 1)
            # No penalty for turning when obstacles are nearby (handled above)
        
        # Horizontal boundary handling (allow looping but discourage edge contact)
        if car.x <= 15 or car.x >= 1185:  # Near horizontal screen edges
            reward -= 15  # Reduced penalty for hitting horizontal borders
        
        # Reward for maintaining reasonable speed and direction within road bounds
        if 2 <= car.speed <= 4 and direction_cos > 0.7 and 180 <= car.y <= 620:
            reward += 30  # Increased from 15 to 30 - much stronger reward for good driving
        elif car.speed > 4.5:
            reward -= 5  # Penalty for excessive speed
        elif car.speed < 1 and not action.get('brake', False):
            reward -= 5  # Penalty for being too slow without reason

        # Additional strong reward for forward acceleration
        if action.get('accelerate', False) and direction_cos > 0.5 and 180 <= car.y <= 620:
            reward += 20  # Strong reward for accelerating forward
        
        # Reward smooth driving (consistent direction) within road bounds
        if abs(car.angle) < 15 and 200 <= car.y <= 600:  # Driving straight in safe zone
            reward += 15  # Increased from 8 to 15 - stronger reward for straight driving
        
        # Penalty for obstacle crashes (additional check) - VERY HARSH
        for obstacle in self.environment.obstacles:
            car_rect = pygame.Rect(car.x - car.width//2, car.y - car.height//2,
                                 car.width, car.height)
            if car_rect.colliderect(obstacle.rect):
                reward -= 1000  # VERY HARSH penalty for actual collision
        
        return reward
# Road Network Nodes: { id: (x, z, name, type) }
# Coordinates represent 3D positions where X is horizontal and Z is depth.
NODES = {
    0: {"x": 0.0,   "z": 0.0,   "name": "Central Intersection", "type": "junction_4way"},
    1: {"x": 0.0,   "z": -150.0, "name": "North Junction",       "type": "junction_3way"},
    2: {"x": 150.0, "z": 0.0,   "name": "East Junction",        "type": "junction_3way"},
    3: {"x": 0.0,   "z": 150.0,  "name": "South Junction",       "type": "junction_3way"},
    4: {"x": -150.0, "z": 0.0,   "name": "West Junction",        "type": "junction_3way"},
    5: {"x": 150.0, "z": -150.0, "name": "North-East Turn",     "type": "bend"},
    6: {"x": 150.0, "z": 150.0,  "name": "South-East Turn",     "type": "bend"},
    7: {"x": -150.0, "z": 150.0,  "name": "South-West Turn",     "type": "bend"},
    8: {"x": -150.0, "z": -150.0, "name": "North-West Turn",     "type": "bend"},
    
    # Parking spaces off the main roads
    10: {"x": -25.0,  "z": -25.0,  "name": "Central Parking Bay",  "type": "parking"},
    11: {"x": 0.0,    "z": -170.0, "name": "North Parking Bay",    "type": "parking"},
    12: {"x": 170.0,  "z": 0.0,    "name": "East Parking Bay",     "type": "parking"},
    13: {"x": 0.0,    "z": 170.0,  "name": "South Parking Bay",    "type": "parking"},
    14: {"x": -170.0, "z": 0.0,    "name": "West Parking Bay",     "type": "parking"}
}

# Edges (Road Segments) connecting nodes.
# format: [from, to, type] (type can be 'straight' or 'curve')
EDGES = [
    {"from": 0, "to": 1, "type": "straight"},
    {"from": 0, "to": 2, "type": "straight"},
    {"from": 0, "to": 3, "type": "straight"},
    {"from": 0, "to": 4, "type": "straight"},
    
    # Outer Loop connections
    {"from": 1, "to": 5, "type": "straight"},
    {"from": 5, "to": 2, "type": "straight"},
    
    {"from": 2, "to": 6, "type": "straight"},
    {"from": 6, "to": 3, "type": "straight"},
    
    {"from": 3, "to": 7, "type": "straight"},
    {"from": 7, "to": 4, "type": "straight"},
    
    {"from": 4, "to": 8, "type": "straight"},
    {"from": 8, "to": 1, "type": "straight"},
    
    # Parking connections
    {"from": 10, "to": 0, "type": "straight"},
    {"from": 11, "to": 1, "type": "straight"},
    {"from": 12, "to": 2, "type": "straight"},
    {"from": 13, "to": 3, "type": "straight"},
    {"from": 14, "to": 4, "type": "straight"}
]

# Adjacency list for pathfinding (bidirectional)
graph = {i: [] for i in NODES}
for edge in EDGES:
    u = edge["from"]
    v = edge["to"]
    # Calculate distance as weight
    dx = NODES[u]["x"] - NODES[v]["x"]
    dz = NODES[u]["z"] - NODES[v]["z"]
    dist = math.sqrt(dx*dx + dz*dz)
    graph[u].append((v, dist))
    graph[v].append((u, dist))

# Active Telemetry storage
telemetry_data = {
    "timestamps": [],
    "speed": [],        # km/h
    "acceleration": [], # m/s^2
    "distance": [],     # total cumulative meters
    "collisions": [],   # count of collision events
    "safety_score": [], # index out of 100
    "lidar_min_dist": [] # minimum laser sensor distance
}

def euclidean_dist(node1_id, node2_id):
    n1 = NODES[node1_id]
    n2 = NODES[node2_id]
    return math.sqrt((n1["x"] - n2["x"])**2 + (n1["z"] - n2["z"])**2)

# A* Pathfinding implementation
def a_star(start, goal):
    import heapq
    # open list: (f_score, node_id, path_taken)
    open_list = []
    heapq.heappush(open_list, (euclidean_dist(start, goal), start, [start]))
    
    g_score = {i: float('inf') for i in NODES}
    g_score[start] = 0
    
    while open_list:
        _, current, path = heapq.heappop(open_list)
        
        if current == goal:
            return path
            
        for neighbor, weight in graph[current]:
            tentative_g = g_score[current] + weight
            if tentative_g < g_score[neighbor]:
                g_score[neighbor] = tentative_g
                f_score = tentative_g + euclidean_dist(neighbor, goal)
                heapq.heappush(open_list, (f_score, neighbor, path + [neighbor]))
                
    return None

@app.route('/api/network', methods=['GET'])
def get_network():
    return jsonify({
        "nodes": NODES,
        "edges": EDGES
    })

@app.route('/api/route', methods=['POST'])
def get_route():
    data = request.json or {}
    start = data.get("start")
    end = data.get("end")
    
    if start is None or end is None:
        return jsonify({"error": "Missing start or end node ID"}), 400
        
    start = int(start)
    end = int(end)
    
    if start not in NODES or end not in NODES:
        return jsonify({"error": "Invalid start or end node ID"}), 400
        
    path_nodes = a_star(start, end)
    
    if path_nodes is None:
        return jsonify({"error": "No route found"}), 404
        
    # Translate node IDs into coordinates
    path_coordinates = [
        {"id": nid, "x": NODES[nid]["x"], "z": NODES[nid]["z"], "name": NODES[nid]["name"]}
        for nid in path_nodes
    ]
    
    return jsonify({
        "nodes": path_nodes,
        "coordinates": path_coordinates
    })

@app.route('/api/telemetry', methods=['POST'])
def post_telemetry():
    global telemetry_data
    data = request.json or {}
    
    # We expect a list of data points or a single data point
    points = data if isinstance(data, list) else [data]
    
    for p in points:
        t = p.get("timestamp", 0)
        speed = p.get("speed", 0.0)
        accel = p.get("acceleration", 0.0)
        dist = p.get("distance", 0.0)
        colls = p.get("collisions", 0)
        safety = p.get("safety_score", 100.0)
        lidar = p.get("lidar_min_dist", 50.0)
        
        telemetry_data["timestamps"].append(t)
        telemetry_data["speed"].append(speed)
        telemetry_data["acceleration"].append(accel)
        telemetry_data["distance"].append(dist)
        telemetry_data["collisions"].append(colls)
        telemetry_data["safety_score"].append(safety)
        telemetry_data["lidar_min_dist"].append(lidar)
        
    return jsonify({"status": "success", "count": len(points)})

@app.route('/api/reset-telemetry', methods=['POST'])
def reset_telemetry():
    global telemetry_data
    telemetry_data = {
        "timestamps": [],
        "speed": [],
        "acceleration": [],
        "distance": [],
        "collisions": [],
        "safety_score": [],
        "lidar_min_dist": []
    }
    # Clean old charts
    charts_dir = os.path.join('static', 'charts')
    if os.path.exists(charts_dir):
        for file in os.listdir(charts_dir):
            if file.endswith('.png'):
                try:
                    os.remove(os.path.join(charts_dir, file))
                except Exception:
                    pass
    return jsonify({"status": "success"})

@app.route('/api/generate-charts', methods=['GET'])
def generate_charts():
    global telemetry_data
    if not telemetry_data["timestamps"]:
        return jsonify({"error": "No telemetry data recorded yet."}), 400
        
    timestamps = [t - telemetry_data["timestamps"][0] for t in telemetry_data["timestamps"]]
    
    # Create speed and safety plot
    plt.figure(figsize=(10, 5))
    plt.style.use('dark_background')
    
    # Plot 1: Speed Profile
    plt.subplot(1, 2, 1)
    plt.plot(timestamps, telemetry_data["speed"], color='#00f2fe', linewidth=2, label='Speed (km/h)')
    plt.fill_between(timestamps, telemetry_data["speed"], color='#00f2fe', alpha=0.15)
    plt.xlabel('Time (seconds)', color='#8e9aaf')
    plt.ylabel('Speed (km/h)', color='#8e9aaf')
    plt.title('Speed Profile Over Time', color='white', fontsize=12, pad=10)
    plt.grid(True, color='#283046', linestyle='--', alpha=0.5)
    plt.tick_params(colors='#8e9aaf')
    plt.legend()
    
    # Plot 2: Safety & Proximity
    plt.subplot(1, 2, 2)
    plt.plot(timestamps, telemetry_data["safety_score"], color='#00ff87', linewidth=2, label='Safety Score')
    plt.plot(timestamps, telemetry_data["lidar_min_dist"], color='#ff416c', linewidth=1.5, linestyle=':', label='Lidar Proximity (m)')
    plt.xlabel('Time (seconds)', color='#8e9aaf')
    plt.ylabel('Values', color='#8e9aaf')
    plt.title('Autopilot Safety Index', color='white', fontsize=12, pad=10)
    plt.grid(True, color='#283046', linestyle='--', alpha=0.5)
    plt.tick_params(colors='#8e9aaf')
    plt.legend()
    
    plt.tight_layout()
    
    chart_name = f"telemetry_summary.png"
    chart_path = os.path.join('static', 'charts', chart_name)
    plt.savefig(chart_path, dpi=120, transparent=True)
    plt.close()
    
    # Generate G-G diagram of Acceleration (for ride comfort assessment)
    plt.figure(figsize=(5, 5))
    plt.style.use('dark_background')
    plt.scatter(telemetry_data["acceleration"], [0]*len(telemetry_data["acceleration"]), c='#f53b57', alpha=0.6, edgecolors='none', label='G-Force distribution')
    plt.axvline(0, color='#8e9aaf', linestyle='--', alpha=0.5)
    plt.xlim(-5, 5)
    plt.xlabel('Longitudinal Acceleration (m/s²)', color='#8e9aaf')
    plt.title('Ride Comfort (G-G Profile)', color='white', fontsize=12, pad=10)
    plt.grid(True, color='#283046', linestyle='--', alpha=0.5)
    plt.tick_params(colors='#8e9aaf')
    
    comfort_chart_name = f"telemetry_comfort.png"
    comfort_chart_path = os.path.join('static', 'charts', comfort_chart_name)
    plt.savefig(comfort_chart_path, dpi=120, transparent=True)
    plt.close()

    return jsonify({
        "status": "success",
        "charts": {
            "summary": f"/static/charts/{chart_name}",
            "comfort": f"/static/charts/{comfort_chart_name}"
        }
    })

# Serve Static Files (needed for matplotlib charts)
@app.route('/static/<path:path>')
def serve_static_file(path):
    return send_from_directory('static', path)

if __name__ == '__main__':
    print("Starting simulator backend on http://localhost:5000")
    app.run(host='127.0.0.1', port=5000, debug=True)
