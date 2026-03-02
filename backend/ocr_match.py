"""
TFT Lobby Screenshot -> Match Data via Template Matching

Usage:
    python ocr_match.py <screenshot_path>

Slides resized CDragon champion portraits across each player row
and uses NMS to pick the best match at each icon position.
"""
import sys
import os
import cv2
import numpy as np
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent / "champion_templates"
DEBUG_DIR = Path(__file__).parent / "debug_rows"

# Reference resolution
REF_W, REF_H = 1136, 726

# X range where champion icons appear (after player name column)
ICONS_X_START = 335
ICONS_X_END = 1115

# Icon size in reference resolution
ICON_SIZE = 66


def get_rows(h: int, num_rows: int = 8) -> list[tuple[int, int]]:
    """
    Get player row boundaries using fixed proportional positions.
    The TFT endgame layout is consistent relative to image size.
    Tuned from a 1136x726 reference screenshot.
    """
    # Row centers as fraction of image height (measured from reference)
    # Row 1 center ~50/726=0.069, spacing ~87/726=0.120
    first_center = 0.069
    spacing = 0.120
    row_half_h = spacing * 0.50  # each row occupies ~60% of spacing

    rows = []
    for i in range(num_rows):
        center = first_center + i * spacing
        y1 = max(0, int((center - row_half_h) * h))
        y2 = min(h, int((center + row_half_h) * h))
        rows.append((y1, y2))
    return rows


def load_templates(template_dir: Path, target_size: int) -> dict[str, np.ndarray]:
    """Load champion templates, crop center, resize to target."""
    templates = {}
    for f in template_dir.glob("TFT16_*.png"):
        img = cv2.imread(str(f), cv2.IMREAD_COLOR)
        if img is None:
            continue
        h, w = img.shape[:2]
        # Crop center 60% to focus on portrait art
        m = int(h * 0.20)
        cropped = img[m:h - m, m:w - m]
        resized = cv2.resize(cropped, (target_size, target_size), interpolation=cv2.INTER_AREA)
        templates[f.stem] = resized
    return templates


def match_row(row_img: np.ndarray, templates: dict[str, np.ndarray],
              icon_size: int, threshold: float = 0.60) -> list[dict]:
    """
    Slide each template across the row, collect detections, NMS to pick best per position.
    """
    rh, rw = row_img.shape[:2]
    all_detections = []

    for name, tmpl in templates.items():
        th, tw = tmpl.shape[:2]
        if th > rh or tw > rw:
            continue

        scores = cv2.matchTemplate(row_img, tmpl, cv2.TM_CCOEFF_NORMED)
        locs = np.where(scores >= threshold)
        for y, x in zip(*locs):
            score = float(scores[y, x])
            x_center = x + tw // 2
            all_detections.append((name, score, x_center))

    if not all_detections:
        return []

    # Sort by score descending
    all_detections.sort(key=lambda d: d[1], reverse=True)

    # Greedy NMS
    min_dist = icon_size * 0.55
    picked = []
    for name, score, xc in all_detections:
        too_close = any(abs(xc - pxc) < min_dist for _, _, pxc in picked)
        if not too_close:
            picked.append((name, score, xc))

    # Sort left to right
    picked.sort(key=lambda d: d[2])

    return [
        {"name": n.replace("TFT16_", ""), "score": round(s, 3), "x": x}
        for n, s, x in picked
    ]


def analyze_screenshot(image_path: str) -> list[dict]:
    img = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"Could not load: {image_path}")

    h, w = img.shape[:2]
    sy = h / REF_H
    sx = w / REF_W
    icon_sz = int(ICON_SIZE * sy)
    tmpl_target = max(12, int(icon_sz * 0.60))

    print(f"Image: {w}x{h}  scale: {sx:.2f}/{sy:.2f}  icon~{icon_sz}px  tmpl~{tmpl_target}px")

    templates = load_templates(TEMPLATES_DIR, tmpl_target)
    print(f"Templates: {len(templates)}")

    # Row positions based on proportional layout
    rows = get_rows(h)
    print(f"Detected {len(rows)} rows:")
    for i, (y1, y2) in enumerate(rows):
        print(f"  Row {i+1}: y={y1}-{y2} (h={y2-y1})")

    DEBUG_DIR.mkdir(exist_ok=True)
    results = []

    x1 = int(ICONS_X_START * sx)
    x2 = int(ICONS_X_END * sx)

    for i, (ry1, ry2) in enumerate(rows):
        row = img[ry1:ry2, x1:x2]
        cv2.imwrite(str(DEBUG_DIR / f"row_{i+1}.png"), row)
        champs = match_row(row, templates, icon_sz)
        results.append({"placement": i + 1, "champions": champs})

    return results


def main():
    if len(sys.argv) < 2:
        print("Usage: python ocr_match.py <screenshot_path>")
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(f"Not found: {path}")
        sys.exit(1)

    print(f"\nAnalyzing: {path}\n{'='*60}")
    results = analyze_screenshot(path)

    print(f"\n{'='*60}\nRESULTS\n{'='*60}")
    for p in results:
        n = p["placement"]
        champs = p["champions"]
        line = ", ".join(f"{c['name']}({c['score']:.2f})" for c in champs)
        print(f"\n#{n} [{len(champs)} units]: {line or 'none detected'}")


if __name__ == "__main__":
    main()
