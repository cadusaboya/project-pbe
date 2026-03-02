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


def detect_star_level(row_img: np.ndarray, x_center: int, icon_size: int) -> int:
    """
    Detect the star level (1, 2, or 3) for a champion at a given x position.

    Stars appear as bright teal/cyan shapes in the top portion of each row,
    centered above the champion icon. 3-star units have golden stars instead.
    """
    rh, rw = row_img.shape[:2]

    # Stars sit in the top ~25% of the row, above the portrait
    star_y1 = 0
    star_y2 = int(rh * 0.25)

    # Horizontal region: centered on the champion icon, slightly wider
    half_w = int(icon_size * 0.55)
    star_x1 = max(0, x_center - half_w)
    star_x2 = min(rw, x_center + half_w)

    star_region = row_img[star_y1:star_y2, star_x1:star_x2]
    if star_region.size == 0:
        return 1

    # Convert to HSV to detect star colors
    hsv = cv2.cvtColor(star_region, cv2.COLOR_BGR2HSV)

    # Stars have two possible colors:
    # - 1-2 star: teal/cyan (H ~80-110, S ~40-200, V ~140-255)
    # - 3 star: golden/yellow (H ~20-35, S ~150-255, V ~200-255)
    # Both are bright against the dark blue background

    # Mask for teal/cyan stars (1-2 star units)
    teal_lower = np.array([75, 30, 130])
    teal_upper = np.array([115, 220, 255])
    teal_mask = cv2.inRange(hsv, teal_lower, teal_upper)

    # Mask for golden stars (3-star units) — strict to avoid portrait gold bleed
    gold_lower = np.array([18, 140, 200])
    gold_upper = np.array([35, 255, 255])
    gold_mask = cv2.inRange(hsv, gold_lower, gold_upper)

    # Clean up noise on gold mask
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    gold_mask = cv2.morphologyEx(gold_mask, cv2.MORPH_OPEN, kernel)

    # Combine masks
    star_mask = cv2.bitwise_or(teal_mask, gold_mask)
    star_mask = cv2.morphologyEx(star_mask, cv2.MORPH_OPEN, kernel)

    # Check for golden stars first (3-star indicator)
    # Real 3-star golden stars produce many bright gold pixels
    gold_pixels = cv2.countNonZero(gold_mask)
    if gold_pixels > 100:
        return 3

    # Measure the horizontal extent of star pixels
    # Project mask vertically: how many active pixels per column
    col_sum = np.sum(star_mask > 0, axis=0)

    # Find columns with ANY star pixel
    active_cols = np.where(col_sum >= 1)[0]
    if len(active_cols) == 0:
        return 1

    # Total width of the star region (from leftmost to rightmost active column)
    star_width = active_cols[-1] - active_cols[0] + 1
    total_active = len(active_cols)

    # In TFT, teal/cyan stars = 1★ or 2★ only.
    # 3★ units have GOLDEN stars (handled by gold_mask above).
    # So from the teal mask, just distinguish 1 vs 2 stars.
    # 2-star width is consistently ~21px at 66px icon size.
    one_two_boundary = icon_size * 0.22   # ~15px

    if star_width > one_two_boundary:
        return 2
    else:
        return 1


def match_row(row_img: np.ndarray, templates: dict[str, np.ndarray],
              icon_size: int, threshold: float = 0.60) -> list[dict]:
    """
    Slide each template across the row, collect detections, NMS to pick best per position.
    Then detect star level for each matched champion.
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

    # Detect star level for each champion
    results = []
    for name, score, xc in picked:
        stars = detect_star_level(row_img, xc, icon_size)
        results.append({
            "name": name.replace("TFT16_", ""),
            "score": round(score, 3),
            "stars": stars,
            "x": xc,
        })

    return results


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
        line = ", ".join(
            f"{c['name']}*{c['stars']}({c['score']:.2f})" for c in champs
        )
        print(f"\n#{n} [{len(champs)} units]: {line or 'none detected'}")


if __name__ == "__main__":
    main()
