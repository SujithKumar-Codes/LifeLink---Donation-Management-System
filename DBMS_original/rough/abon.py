import cv2
import time
import uuid
import numpy as np
from ultralytics import YOLO
from sklearn.metrics.pairwise import cosine_similarity
from torchreid.models import build_model
import torch

# Initialize YOLO model
yolo_model = YOLO("C:/Users/kumar/OneDrive/Desktop/Mini_project/runs/yolov8_training6/weights/best.pt")

# Initialize ReID model with pre-trained weights from torchreid
reid_model = build_model(name='osnet_x0_25', num_classes=1000, pretrained=True)
reid_model.eval()  # Set to evaluation mode

# Device configuration (CPU or GPU)
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
reid_model = reid_model.to(device)

# Parameters
DETECTION_CONFIDENCE = 0.5
ABANDONED_TIME_THRESHOLD = 5
NEAR_DISTANCE_MULTIPLIER = 1.5
FRAME_RESIZE_FACTOR = 0.5
LUGGAGE_CLASS = 0
PERSON_CLASS = 1
SIMILARITY_THRESHOLD = 0.75
DEBUG = True
GRACE_TIME_THRESHOLD = 3  # Grace time before considering a new object

# Track objects
tracked_luggage = {}
tracked_persons = {}


def log_debug(message):
    """Log debug messages if debugging is enabled."""
    if DEBUG:
        print(message)


def get_center(bbox):
    """Get the center of a bounding box."""
    x1, y1, x2, y2 = bbox
    return (x1 + x2) / 2, (y1 + y2) / 2


def calculate_distance(center1, center2):
    """Calculate Euclidean distance between two centers."""
    return np.sqrt((center2[0] - center1[0]) * 2 + (center2[1] - center1[1]) * 2)


def extract_person_features(frame, bbox):
    """Extract ReID features for a person."""
    x1, y1, x2, y2 = map(int, bbox)
    person_crop = frame[y1:y2, x1:x2]
    person_crop = cv2.resize(person_crop, (128, 256))  # Resize to match model input
    person_crop = person_crop.transpose((2, 0, 1))  # Change to CHW format
    person_crop = np.expand_dims(person_crop, axis=0)
    person_crop = torch.tensor(person_crop, dtype=torch.float32).to(device)

    with torch.no_grad():
        features = reid_model(person_crop)
    return features.cpu().numpy()


def match_person(new_feature):
    """Match a person based on ReID features."""
    max_similarity = 0
    matched_id = None
    for person_id, person_data in tracked_persons.items():
        similarity = cosine_similarity(new_feature.reshape(1, -1), person_data['feature'].reshape(1, -1))[0][0]
        if similarity > max_similarity:
            max_similarity = similarity
            matched_id = person_id
    return matched_id if max_similarity > SIMILARITY_THRESHOLD else None


def process_frame(frame):
    global tracked_luggage, tracked_persons

    # Resize frame for faster processing
    original_size = frame.shape[1::-1]
    frame = cv2.resize(frame,
                       (int(original_size[0] * FRAME_RESIZE_FACTOR), int(original_size[1] *
                         FRAME_RESIZE_FACTOR)))

    # Run YOLO detection
    results = yolo_model(frame)[0]
    detections = results.boxes.cpu().numpy()

    # Filter luggage and person detections
    luggage_detections = [
        det for det in detections
        if int(det.cls[0]) == LUGGAGE_CLASS and det.conf[0] >= DETECTION_CONFIDENCE
    ]
    person_detections = [
        det for det in detections
        if int(det.cls[0]) == PERSON_CLASS and det.conf[0] >= DETECTION_CONFIDENCE
    ]

    # Log detected objects
    log_debug(f"Detected {len(luggage_detections)} luggage and {len(person_detections)} persons.")

    # Update person tracking
    current_time = time.time()
    new_tracked_persons = {}
    for person in person_detections:
        person_bbox = tuple(person.xyxy[0])
        person_feature = extract_person_features(frame, person_bbox)
        matched_id = match_person(person_feature)

        if matched_id is None:
            matched_id = str(uuid.uuid4())
            log_debug(f"New person detected: {matched_id}, bbox: {person_bbox}")

        new_tracked_persons[matched_id] = {
            'bbox': person_bbox,
            'feature': person_feature,
            'last_seen': current_time,
        }

    tracked_persons = new_tracked_persons

    # Update luggage tracking
    new_tracked_luggage = {}
    for luggage in luggage_detections:
        luggage_bbox = tuple(luggage.xyxy[0])
        luggage_center = get_center(luggage_bbox)
        proximity_threshold = calculate_distance((luggage_bbox[0], luggage_bbox[1]),
                                                 (luggage_bbox[2], luggage_bbox[3])) * NEAR_DISTANCE_MULTIPLIER

        matched_luggage_id = None
        matched_person_id = None  # Track the person matched with the luggage
        for tracked_id, tracked_data in tracked_luggage.items():
            distance = calculate_distance(luggage_center, tracked_data['center'])

            # If the distance is small and the bounding boxes are similar, continue the tracking
            if distance <= proximity_threshold:
                bbox_distance = np.abs(np.array(luggage_bbox) - np.array(tracked_data['bbox']))
                if np.all(bbox_distance < 50):  # Threshold for bounding box similarity (can be adjusted)
                    matched_luggage_id = tracked_id
                    break

        if matched_luggage_id is None:
            # New luggage detected or previous one is abandoned
            matched_luggage_id = str(uuid.uuid4())
            new_tracked_luggage[matched_luggage_id] = {
                'bbox': luggage_bbox,
                'last_seen': current_time,
                'abandoned_since': None,
                'center': luggage_center,
                'person_nearby': False,
                'grace_time': 0  # Set grace time counter
            }
            log_debug(f"New luggage detected: {matched_luggage_id}, bbox: {luggage_bbox}")
        else:
            # Update existing luggage
            previous_data = tracked_luggage[matched_luggage_id]
            is_near_person = any(
                calculate_distance(luggage_center, get_center(person_data['bbox'])) <= proximity_threshold
                for person_data in tracked_persons.values()
            )

            abandoned_since = previous_data['abandoned_since']
            if is_near_person:
                abandoned_since = None  # Reset abandoned timer if a person is nearby
                previous_data['person_nearby'] = True
                matched_person_id = [person_id for person_id, person_data in tracked_persons.items() if
                                     calculate_distance(luggage_center,
                                                        get_center(person_data['bbox'])) <= proximity_threshold][0]
                log_debug(f"Luggage {matched_luggage_id} matched with person {matched_person_id}.")
            else:
                previous_data['person_nearby'] = False
                if abandoned_since is None:
                    abandoned_since = current_time

            # Handle grace time before abandoning the luggage
            grace_time = previous_data['grace_time']
            if grace_time > 0 and calculate_distance(luggage_center, previous_data['center']) < 50:
                grace_time = max(grace_time - 1, 0)  # Reduce grace time if bounding boxes are similar

            new_tracked_luggage[matched_luggage_id] = {
                'bbox': luggage_bbox,
                'last_seen': current_time,
                'abandoned_since': abandoned_since,
                'center': luggage_center,
                'person_nearby': previous_data['person_nearby'],
                'grace_time': grace_time
            }

    # Check for abandonment
    for luggage_id, data in new_tracked_luggage.items():
        if data['person_nearby'] is False and data['abandoned_since']:
            time_stationary = current_time - data['abandoned_since']
            if time_stationary >= ABANDONED_TIME_THRESHOLD:
                log_debug(f"Luggage {luggage_id} abandoned for {time_stationary:.2f} seconds.")
                cv2.putText(frame, f"Abandoned ({int(time_stationary)}s)",
                            (int(data['bbox'][0]), int(data['bbox'][1])),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

    # Annotate the frame
    for luggage_id, data in new_tracked_luggage.items():
        cv2.rectangle(frame, (int(data['bbox'][0]), int(data['bbox'][1])),
                      (int(data['bbox'][2]), int(data['bbox'][3])), (255, 0, 0), 2)
        cv2.putText(frame, "Luggage", (int(data['bbox'][0]), int(data['bbox'][1] - 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)

    for person_id, person_data in tracked_persons.items():
        cv2.rectangle(frame, (int(person_data['bbox'][0]), int(person_data['bbox'][1])),
                      (int(person_data['bbox'][2]), int(person_data['bbox'][3])), (0, 255, 0), 2)
        cv2.putText(frame, "Person", (int(person_data['bbox'][0]), int(person_data['bbox'][1] - 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

    tracked_luggage = new_tracked_luggage

    return frame


def main():
    """Run abandoned object detection with ReID on webcam feed."""
    cap = cv2.VideoCapture(1)
    if not cap.isOpened():
        print("Error: Could not open webcam.")
        return

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        processed_frame = process_frame(frame)
        cv2.imshow("Abandoned Object Detection with ReID", processed_frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()
    print("Webcam session ended.")


if _name_ == "_main_":
    main()