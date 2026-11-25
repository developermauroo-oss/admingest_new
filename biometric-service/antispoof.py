"""MiniFASNet ONNX adapter. Weights require an operator-reviewed license manifest.

No claim of PAD efficacy is implied by successful inference.
"""
import hashlib
import json
import threading
from pathlib import Path
import cv2
import numpy as np


class AntiSpoof:
    def __init__(self, manifest_path):
        manifest_path = Path(manifest_path)
        manifest = json.loads(manifest_path.read_text(encoding="utf8"))
        if manifest.get("commercial_weights_verified") is not True or not manifest.get("license_source"):
            raise ValueError("PAD weight license has not been verified")
        path = manifest_path.parent / manifest["file"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["sha256"]:
            raise ValueError("PAD weight integrity failure")
        self.net = cv2.dnn.readNetFromONNX(str(path))
        self.scale = float(manifest.get("crop_scale", 2.7))
        self.lock = threading.Lock()

    def score(self, image, box):
        x, y, w, h = map(float, box[:4])
        ih, iw = image.shape[:2]
        scale = min(self.scale, (ih - 1) / h, (iw - 1) / w)
        cx, cy = x + w / 2, y + h / 2
        x1, y1 = max(0, int(cx - w * scale / 2)), max(0, int(cy - h * scale / 2))
        x2, y2 = min(iw, int(cx + w * scale / 2) + 1), min(ih, int(cy + h * scale / 2) + 1)
        crop = image[y1:y2, x1:x2]
        if crop.size == 0:
            raise ValueError("Invalid PAD crop")
        blob = cv2.dnn.blobFromImage(crop, 1.0, (80, 80), swapRB=False)
        with self.lock:
            self.net.setInput(blob)
            logits = self.net.forward().reshape(-1)
        if len(logits) != 3 or not np.all(np.isfinite(logits)):
            raise ValueError("Invalid PAD output")
        exp = np.exp(logits - logits.max())
        return float((exp / exp.sum())[1])
