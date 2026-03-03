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
ITEMS_DIR = Path(__file__).parent / "item_templates"
DEBUG_DIR = Path(__file__).parent / "debug_rows"
_SCALED_ITEM_TEMPLATE_CACHE: dict[tuple[int, int], list[tuple[str, str, np.ndarray, np.ndarray]]] = {}
_OCR_READER = None

# Reference resolution
REF_W, REF_H = 1136, 726

# X range where champion icons appear (after player name column).
# Use a wide start to handle resolutions where the name column is narrower.
ICONS_X_START = 250
ICONS_X_END = 1115

# Icon size in reference resolution
ICON_SIZE = 66


def _compute_hsv_histogram(img: np.ndarray, mask_dark: bool = False) -> np.ndarray:
    """Compute a normalized HSV histogram for color-based item comparison.
    If mask_dark=True, excludes pixels with brightness < 50 (dark background)."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    mask = None
    if mask_dark:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, mask = cv2.threshold(gray, 50, 255, cv2.THRESH_BINARY)
        if cv2.countNonZero(mask) < 10:
            mask = None
    # H: 30 bins (0-180), S: 32 bins (0-256), V: 32 bins (0-256)
    hist = cv2.calcHist([hsv], [0, 1, 2], mask, [30, 32, 32],
                        [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    return hist.flatten()


def get_rows(h: int, img: np.ndarray | None = None, num_rows: int = 8) -> list[tuple[int, int]]:
    """
    Detect 8 player row boundaries.

    If img is provided, adaptively finds where the actual content starts
    and ends by analyzing the vertical std-dev profile (champion icons
    produce high color variance). Falls back to fixed proportional
    positions if adaptive detection fails.
    """
    if img is not None:
        adaptive = _detect_rows_adaptive(img, num_rows)
        if adaptive is not None:
            return adaptive

    # Fallback: fixed proportional positions (calibrated for 1136x726)
    first_center = 0.069
    spacing = 0.120
    row_half_h = spacing * 0.50

    rows = []
    for i in range(num_rows):
        center = first_center + i * spacing
        y1 = max(0, int((center - row_half_h) * h))
        y2 = min(h, int((center + row_half_h) * h))
        rows.append((y1, y2))
    return rows


def _detect_rows_adaptive(img: np.ndarray, num_rows: int = 8) -> list[tuple[int, int]] | None:
    """
    Adaptively detect row boundaries by analyzing the vertical std-dev
    profile. Each player row creates a high-variance band (colorful
    champion icons on dark bg), separated by thin dark gaps.

    Strategy:
    1. Find all high-variance bands (one per row)
    2. Filter out small fragments (header text, noise)
    3. Take the 8 largest bands → these are the player rows
    4. Compute the content span (first band start → last band end),
       pad by one average gap width at each end, and divide equally.
    """
    h, w = img.shape[:2]

    # Analyze champion icon area (center-right strip, avoiding name column)
    x1, x2 = int(w * 0.25), int(w * 0.85)
    gray = cv2.cvtColor(img[:, x1:x2], cv2.COLOR_BGR2GRAY)

    # Per-row standard deviation — champion rows have high std dev
    row_std = np.std(gray.astype(float), axis=1)

    # Light smoothing to preserve row boundaries
    k = max(3, h // 60)
    if k % 2 == 0:
        k += 1
    smoothed = np.convolve(row_std, np.ones(k) / k, mode="same")

    peak = np.max(smoothed)
    if peak < 5:
        return None

    thresh = peak * 0.35

    # Find contiguous high-variance bands
    bands: list[tuple[int, int]] = []
    in_band = False
    start = 0
    for y in range(h):
        if smoothed[y] > thresh and not in_band:
            start = y
            in_band = True
        elif smoothed[y] <= thresh and in_band:
            bands.append((start, y))
            in_band = False
    if in_band:
        bands.append((start, h))

    # Filter small fragments (header text, noise) — must be ≥ 3% of height
    min_h = h * 0.03
    bands = [(s, e) for s, e in bands if e - s >= min_h]

    if len(bands) < num_rows:
        # Not enough bands — try equal subdivision of available span
        if len(bands) >= 2:
            content_start = bands[0][0]
            content_end = bands[-1][1]
            if (content_end - content_start) >= h * 0.5:
                row_h = (content_end - content_start) / num_rows
                return [(max(0, int(content_start + i * row_h)),
                         min(h, int(content_start + (i + 1) * row_h)))
                        for i in range(num_rows)]
        return None

    # Take the num_rows largest bands (sorted by position)
    if len(bands) > num_rows:
        bands.sort(key=lambda r: -(r[1] - r[0]))
        bands = sorted(bands[:num_rows])

    # Compute gap midpoints to set row boundaries.
    # Each row extends from the midpoint of the gap before it to the midpoint
    # of the gap after it, naturally handling unequal row heights (e.g. FIRST
    # PLACE expanded display giving the winner more vertical space).
    gaps = [bands[i + 1][0] - bands[i][1] for i in range(len(bands) - 1)]
    avg_gap = sum(gaps) / len(gaps) if gaps else 0

    # Gap midpoints: boundary between row i and row i+1
    gap_mids = [(bands[i][1] + bands[i + 1][0]) // 2 for i in range(len(bands) - 1)]

    # First row starts above band[0] by avg_gap; last row ends below band[-1]
    content_start = max(0, int(bands[0][0] - avg_gap))
    content_end = min(h, int(bands[-1][1] + avg_gap))

    # Sanity: content should span ≥ 50% of image height
    if (content_end - content_start) < h * 0.5:
        return None

    rows = []
    for i in range(num_rows):
        y1 = content_start if i == 0 else gap_mids[i - 1]
        y2 = content_end if i == num_rows - 1 else gap_mids[i]
        rows.append((max(0, y1), min(h, y2)))

    return rows


def _get_ocr_reader():
    """Lazy-load easyocr reader (initialized once, reused across calls)."""
    global _OCR_READER
    if _OCR_READER is None:
        import easyocr
        _OCR_READER = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _OCR_READER


def detect_player_name(img: np.ndarray, ry1: int, ry2: int) -> str:
    """
    Extract the player name from the left side of a row.
    The name sits between the placement badge/avatar and the champion icons.
    Crops from ~9% (past badge+avatar circle) to ~30% of image width.
    Filters out stray digit detections and concatenates multi-part names.
    """
    h, w = img.shape[:2]
    rh = ry2 - ry1
    # Name column: skip badge+avatar (~9% of width) to ~30% of width.
    nx1 = int(w * 0.09)
    nx2 = int(w * 0.30)
    ny1 = ry1 + int(rh * 0.20)
    ny2 = ry1 + int(rh * 0.72)

    name_region = img[ny1:ny2, nx1:nx2]
    if name_region.size == 0:
        return ""

    # Preprocess: white text on dark bg → binarize for OCR.
    gray = cv2.cvtColor(name_region, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 140, 255, cv2.THRESH_BINARY)

    try:
        reader = _get_ocr_reader()
        results = reader.readtext(binary, detail=1, paragraph=False)
        if not results:
            return ""
        # Filter out placement badge numbers (single/double digit strings).
        filtered = [r for r in results if not r[1].strip().isdigit()]
        if not filtered:
            return ""
        # Sort by x-position (left to right) and concatenate all parts.
        filtered.sort(key=lambda r: r[0][0][0])
        name = " ".join(r[1].strip() for r in filtered)
        return name
    except Exception:
        return ""


def load_templates(template_dir: Path, target_size: int) -> dict[str, np.ndarray]:
    """Load champion templates, crop center, resize to target."""
    templates = {}
    for f in template_dir.glob("*.png"):
        img = cv2.imread(str(f), cv2.IMREAD_COLOR)
        if img is None:
            continue
        h, w = img.shape[:2]
        m = int(h * 0.20)
        cropped = img[m:h - m, m:w - m]
        resized = cv2.resize(cropped, (target_size, target_size), interpolation=cv2.INTER_AREA)
        if not f.stem:
            continue
        # Canonicalize to keep downstream name formatting stable.
        stem = f.stem
        if stem.lower().startswith("tft16_"):
            stem = "TFT16_" + stem[6:]
        templates[stem] = resized
    return templates


def load_item_templates(item_dir: Path, target_size: int) -> dict[str, np.ndarray]:
    """Load item templates, resize to match in-game item icon size."""
    templates = {}
    item_names = {}

    SKIP_PREFIXES = ("TFT_Item_Blank", "TFT_Item_Grant", "TFT_Item_Consumable",
                     "TFT_Item_Duplicator", "TFT_Item_Remover", "TFT_Item_Reforger",
                     "TFT_Item_Hex_", "TFT_Item_Debug")
    SKIP_EXACT = {
        "TFT_Item_Hush", "TFT_Item_BladeOfTheRuinedKing", "TFT_Item_PhantomDancer",
        "TFT_Item_IcebornGauntlet", "TFT_Item_SpellThiefsEdge", "TFT_Item_Catalyst",
        "TFT_Item_SwordOfTheDivine", "TFT_Item_CursedBlade", "TFT_Item_IsYordle",
        "TFT_Item_FrozenMallet", "TFT_Item_HextechChestguard", "TFT_Item_Darkin",
        "TFT_Item_Yuumi", "TFT_Item_ZhonyasHourglass", "TFT_Item_FreeVengeance",
        "TFT_Item_Vengeance", "TFT_Item_EmptyBag", "TFT_Item_UnusableSlot",
        "TFT_Item_Unknown", "TFT_Item_JammedSlot",
        "TFT_Item_Artifact_EternalPact",  # Virtue of the Martyr — not in Set 16
        "TFT_Item_RadiantVirtue",  # Virtue of the Martyr — false positive prone
        "TFT_Item_MortalReminder",  # broken CDragon name
        "TFT_Item_Thornmail",  # broken CDragon name
        # "TFT_Item_Quicksilver",  # Re-enabled: HSV histogram scoring now distinguishes it
        # TFT_Item_MadredsBloodrazor = Giant Slayer — keep it, no other template exists
    }

    names_path = item_dir.parent / "item_names_ocr.json"
    if names_path.exists():
        import json
        with open(names_path) as f:
            item_names = json.load(f)

    for pattern in ["TFT_Item_*.png", "TFT16_Item_*EmblemItem.png"]:
        for f in item_dir.glob(pattern):
            item_id = f.stem
            if any(item_id.startswith(p) for p in SKIP_PREFIXES) or item_id in SKIP_EXACT:
                continue
            img = cv2.imread(str(f), cv2.IMREAD_COLOR)
            if img is None:
                continue
            resized = cv2.resize(img, (target_size, target_size), interpolation=cv2.INTER_AREA)
            display_name = item_names.get(item_id) or item_id.replace("TFT_Item_", "").replace("TFT16_Item_", "")
            templates[item_id] = {"img": resized, "name": display_name}
    return templates


def _get_scaled_item_templates(
    item_templates: dict[str, dict], scaled_item_size: int
) -> list[tuple[str, str, np.ndarray, np.ndarray]]:
    """Cache per-size item template resizes + HSV histograms."""
    cache_key = (id(item_templates), scaled_item_size)
    if cache_key in _SCALED_ITEM_TEMPLATE_CACHE:
        return _SCALED_ITEM_TEMPLATE_CACHE[cache_key]

    scaled_templates = []
    for item_id, data in item_templates.items():
        tmpl = cv2.resize(
            data["img"], (scaled_item_size, scaled_item_size),
            interpolation=cv2.INTER_LANCZOS4
        )
        hist = _compute_hsv_histogram(tmpl, mask_dark=True)
        scaled_templates.append((item_id, data["name"], tmpl, hist))
    _SCALED_ITEM_TEMPLATE_CACHE[cache_key] = scaled_templates
    return scaled_templates


def _extract_item_strip(row_img: np.ndarray, x_center: int, icon_size: int,
                        rh: int) -> tuple[np.ndarray | None, int, int]:
    """Extract the item strip region below a champion icon. Returns (region, x1, y1) or (None, 0, 0)."""
    rw = row_img.shape[1]
    y_start = 0.77 - max(0.0, (80 - rh)) * 0.0025
    y_start = max(0.70, min(0.77, y_start))
    item_y1 = int(rh * y_start)
    item_y2 = int(rh * 0.97)
    half_w = int(icon_size * 0.55)
    item_x1 = max(0, x_center - half_w)
    item_x2 = min(rw, x_center + half_w)

    region = row_img[item_y1:item_y2, item_x1:item_x2]
    if region.size == 0 or region.shape[0] < 4 or region.shape[1] < 4:
        return None, 0, 0
    return region, item_x1, item_y1


def _strip_prechecks(item_region: np.ndarray, rh: int) -> bool:
    """Fast pre-checks to reject empty strips or portrait art bleed. Returns True if strip looks valid."""
    gray = cv2.cvtColor(item_region, cv2.COLOR_BGR2GRAY)
    region_area = gray.shape[0] * gray.shape[1]
    if np.max(gray) < 140:
        return False
    bright_pct = 0.04 if rh < 70 else 0.08
    bright_thresh = max(15, int(region_area * bright_pct))
    if np.sum(gray > 100) < bright_thresh:
        return False
    min_dark = 0.10 if rh < 70 else 0.15
    dark_ratio = np.sum(gray < 40) / region_area
    if dark_ratio < min_dark:
        return False
    return True


def _upscale_strip(item_region: np.ndarray, item_size: int) -> tuple[np.ndarray, int]:
    """Upscale item strip with adaptive scale factor. Returns (upscaled, scale)."""
    if item_size <= 10:
        scale = 6
    elif item_size < 16:
        scale = 5
    else:
        scale = 3
    upscaled = cv2.resize(item_region,
                          (item_region.shape[1] * scale, item_region.shape[0] * scale),
                          interpolation=cv2.INTER_LANCZOS4)
    return upscaled, scale


def detect_items(row_img: np.ndarray, x_center: int, icon_size: int,
                 item_templates: dict[str, dict],
                 item_size: int,
                 debug_prefix: str = "") -> list[str]:
    """
    Detect items on a champion using slot-based classification.

    Instead of sliding all templates across the strip, divides the item area
    into 3 fixed slots (matching TFT's layout) and classifies each slot
    independently using combined template matching + color histogram scoring.
    """
    rh, rw = row_img.shape[:2]

    item_region, _, _ = _extract_item_strip(row_img, x_center, icon_size, rh)
    if item_region is None:
        return []

    if debug_prefix:
        DEBUG_DIR.mkdir(exist_ok=True)
        cv2.imwrite(str(DEBUG_DIR / f"{debug_prefix}_items.png"), item_region)

    if not _strip_prechecks(item_region, rh):
        return []

    upscaled, scale = _upscale_strip(item_region, item_size)

    if debug_prefix:
        cv2.imwrite(str(DEBUG_DIR / f"{debug_prefix}_items_up.png"), upscaled)

    scaled_item_size = item_size * scale
    scaled_templates = _get_scaled_item_templates(item_templates, scaled_item_size)

    uh, uw = upscaled.shape[:2]

    # Divide strip into 3 equal-width slots with padding overlap.
    slot_w = uw // 3
    pad = max(1, int(slot_w * 0.15))
    slots: list[np.ndarray] = []
    for i in range(3):
        sx1 = max(0, i * slot_w - pad)
        sx2 = min(uw, (i + 1) * slot_w + pad)
        slots.append(upscaled[:, sx1:sx2])

    if debug_prefix:
        for si, slot_img in enumerate(slots):
            cv2.imwrite(str(DEBUG_DIR / f"{debug_prefix}_slot{si}.png"), slot_img)

    # Classify each slot independently.
    dup_penalty = 0.10
    accept_thresh = 0.50 if item_size <= 12 else 0.52

    results: list[tuple[str, str, float]] = []  # (item_id, display_name, combined_score)

    for si, slot_img in enumerate(slots):
        slot_gray = cv2.cvtColor(slot_img, cv2.COLOR_BGR2GRAY)
        if int(np.max(slot_gray)) < 80:
            continue

        slot_hist = _compute_hsv_histogram(slot_img, mask_dark=True)
        best_id = ""
        best_name = ""
        best_combined = -1.0

        for item_id, display_name, tmpl, tmpl_hist in scaled_templates:
            th, tw = tmpl.shape[:2]
            sh, sw = slot_img.shape[:2]
            if th > sh or tw > sw:
                continue

            # Template matching: small search area since slot ~ template size.
            match_scores = cv2.matchTemplate(slot_img, tmpl, cv2.TM_CCOEFF_NORMED)
            _, tmpl_score, _, _ = cv2.minMaxLoc(match_scores)

            # Color histogram correlation (masked to ignore dark background).
            hist_score = cv2.compareHist(
                slot_hist.reshape(-1, 1).astype(np.float32),
                tmpl_hist.reshape(-1, 1).astype(np.float32),
                cv2.HISTCMP_CORREL
            )

            combined = 0.55 * max(0.0, tmpl_score) + 0.45 * max(0.0, hist_score)

            if combined > best_combined:
                best_combined = combined
                best_id = item_id
                best_name = display_name

        if best_combined >= accept_thresh:
            # Duplicate penalty: repeated item names need higher score.
            dup_count = sum(1 for _, rn, _ in results if rn == best_name)
            if best_combined >= accept_thresh + dup_count * dup_penalty:
                results.append((best_id, best_name, best_combined))

    return [name for _, name, _ in results]


def _detect_items_sliding(row_img: np.ndarray, x_center: int, icon_size: int,
                          item_templates: dict[str, dict],
                          item_size: int,
                          debug_prefix: str = "") -> list[str]:
    """
    Legacy: Detect items using NMS sliding window.
    Kept for comparison / fallback. Same logic as original detect_items().
    """
    rh, rw = row_img.shape[:2]

    item_region, _, _ = _extract_item_strip(row_img, x_center, icon_size, rh)
    if item_region is None:
        return []

    if not _strip_prechecks(item_region, rh):
        return []

    upscaled, scale = _upscale_strip(item_region, item_size)
    upscaled_gray = cv2.cvtColor(upscaled, cv2.COLOR_BGR2GRAY)

    scaled_item_size = item_size * scale
    scaled_templates = _get_scaled_item_templates(item_templates, scaled_item_size)

    uh, uw = upscaled.shape[:2]
    threshold = 0.48 if item_size <= 12 else 0.52
    dark_patch_min = 30 if item_size <= 12 else 40
    dup_penalty = 0.10

    candidates: list[tuple[str, str, float, int]] = []
    for item_id, display_name, tmpl, _hist in scaled_templates:
        th, tw = tmpl.shape[:2]
        if th > uh or tw > uw:
            continue
        scores = cv2.matchTemplate(upscaled, tmpl, cv2.TM_CCOEFF_NORMED)
        while True:
            _, max_score, _, max_loc = cv2.minMaxLoc(scores)
            if max_score < threshold:
                break
            mx, my = max_loc
            xc = mx + tw // 2
            candidates.append((item_id, display_name, float(max_score), xc))
            sup_x1 = max(0, mx - tw // 2)
            sup_x2 = min(scores.shape[1], mx + tw // 2 + 1)
            scores[:, sup_x1:sup_x2] = -1.0

    candidates.sort(key=lambda c: -c[2])

    min_dist = int(scaled_item_size * 0.55)
    picked: list[tuple[str, str, float, int]] = []
    for item_id, display_name, score, xc in candidates:
        if any(abs(xc - px) < min_dist for _, _, _, px in picked):
            continue
        dup_count = sum(1 for _, pn, _, _ in picked if pn == display_name)
        if score < threshold + dup_count * dup_penalty:
            continue
        tmpl_img = next(t for tid, _, t, _ in scaled_templates if tid == item_id)
        th, tw = tmpl_img.shape[:2]
        px_left = max(0, xc - tw // 2)
        py_top = max(0, (uh - th) // 2)
        patch = upscaled_gray[py_top:py_top + th, px_left:px_left + tw]
        if patch.size == 0 or patch.mean() < dark_patch_min:
            continue
        picked.append((item_id, display_name, score, xc))
        if len(picked) >= 3:
            break

    picked.sort(key=lambda p: p[3])
    return [name for _, name, _, _ in picked]


def detect_star_level(row_img: np.ndarray, x_center: int, icon_size: int) -> int:
    """
    Detect the star level (1, 2, or 3) for a champion at a given x position.

    Stars appear as bright teal/cyan shapes in the top portion of each row,
    centered above the champion icon. 3-star units have golden stars instead.
    """
    rh, rw = row_img.shape[:2]

    star_y1 = 0
    star_y2 = int(rh * 0.25)

    half_w = int(icon_size * 0.55)
    star_x1 = max(0, x_center - half_w)
    star_x2 = min(rw, x_center + half_w)

    star_region = row_img[star_y1:star_y2, star_x1:star_x2]
    if star_region.size == 0:
        return 1

    hsv = cv2.cvtColor(star_region, cv2.COLOR_BGR2HSV)

    teal_lower = np.array([75, 30, 130])
    teal_upper = np.array([115, 220, 255])
    teal_mask = cv2.inRange(hsv, teal_lower, teal_upper)

    gold_lower = np.array([18, 140, 200])
    gold_upper = np.array([35, 255, 255])
    gold_mask = cv2.inRange(hsv, gold_lower, gold_upper)

    star_mask = cv2.bitwise_or(teal_mask, gold_mask)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    star_mask = cv2.morphologyEx(star_mask, cv2.MORPH_OPEN, kernel)

    # 3-star check: gold pixels as percentage of crop area (scales with resolution)
    gold_pixels = cv2.countNonZero(gold_mask)
    star_area = star_region.shape[0] * star_region.shape[1]
    if star_area > 0 and gold_pixels > max(5, star_area * 0.015):
        return 3

    col_sum = np.sum(star_mask > 0, axis=0)
    active_cols = np.where(col_sum >= 1)[0]
    if len(active_cols) == 0:
        return 1

    star_width = active_cols[-1] - active_cols[0] + 1
    one_two_boundary = icon_size * 0.22

    if star_width > one_two_boundary:
        return 2
    else:
        return 1


def match_row(row_img: np.ndarray, templates: dict[str, np.ndarray],
              icon_size: int,
              threshold: float = 0.70,
              item_templates: dict | None = None,
              item_size: int = 12,
              row_idx: int = -1) -> list[dict]:
    """
    Slide each champion template across the row, collect all matches above
    threshold, then apply NMS to pick the best non-overlapping detections.
    Deduplicates so each champion name appears at most once.
    """
    rh, rw = row_img.shape[:2]
    y1 = int(rh * 0.05)
    y2 = int(rh * 0.83)
    search = row_img[y1:y2, :]
    sh, sw = search.shape[:2]

    # Collect all (name, score, x_center) candidates above threshold.
    candidates: list[tuple[str, float, int]] = []
    for name, tmpl in templates.items():
        th, tw = tmpl.shape[:2]
        if th > sh or tw > sw:
            continue
        scores = cv2.matchTemplate(search, tmpl, cv2.TM_CCOEFF_NORMED)
        while True:
            _, max_score, _, max_loc = cv2.minMaxLoc(scores)
            if max_score < threshold:
                break
            mx, my = max_loc
            xc = mx + tw // 2
            candidates.append((name, float(max_score), xc))
            # Suppress this peak so we can find the next one.
            sup_x1 = max(0, mx - tw // 2)
            sup_x2 = min(scores.shape[1], mx + tw // 2 + 1)
            scores[:, sup_x1:sup_x2] = -1.0

    # Sort by score descending for greedy NMS.
    candidates.sort(key=lambda c: -c[1])

    # Greedy NMS: accept if no overlap with already-picked detections.
    # Duplicate champion penalty: each additional copy of the same name
    # needs progressively higher score (real duplicates score high,
    # false matches from generic templates score low).
    min_dist = int(icon_size * 0.45)
    dup_penalty = 0.09
    picked: list[tuple[str, float, int]] = []
    for name, score, xc in candidates:
        if any(abs(xc - px) < min_dist for _, _, px in picked):
            continue
        dup_count = sum(1 for pn, _, _ in picked if pn == name)
        if score < threshold + dup_count * dup_penalty:
            continue
        picked.append((name, score, xc))

    picked.sort(key=lambda m: m[2])  # sort by x position

    # Filter left-edge false positives: the crop may include part of the
    # player name/avatar column. Low-score detections to the left of the
    # first confident champion are almost always false positives.
    confident = [p for p in picked if p[1] >= 0.75]
    if confident:
        leftmost_x = min(p[2] for p in confident)
        picked = [p for p in picked if p[2] >= leftmost_x or p[1] >= 0.75]

    results = []
    for ci, (name, score, xc) in enumerate(picked):
        stars = detect_star_level(row_img, xc, icon_size)
        items = []
        if item_templates:
            dbg = f"row{row_idx}_c{ci}" if row_idx >= 0 else ""
            items = detect_items(row_img, xc, icon_size, item_templates, item_size,
                                debug_prefix=dbg)
        results.append({
            "name": name.replace("TFT16_", ""),
            "score": round(score, 3),
            "stars": stars,
            "items": items,
            "x": xc,
        })

    # Enforce TFT star ordering: 3-star (leftmost) → 2-star → 1-star.
    # A champion can't be higher-star than any champion to its left.
    # This catches false 3-star detections from golden champion art.
    if len(results) >= 2:
        min_star_so_far = results[0]["stars"]
        for r in results[1:]:
            if r["stars"] > min_star_so_far:
                r["stars"] = min_star_so_far
            min_star_so_far = min(min_star_so_far, r["stars"])

    return results


def analyze_screenshot(image_path: str, debug: bool = False) -> list[dict]:
    img = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"Could not load: {image_path}")

    h, w = img.shape[:2]
    sx = w / REF_W

    # Detect rows FIRST — row height drives icon/template sizing.
    # This handles headers, banners, or any overlay that shifts content.
    rows = get_rows(h, img=img)
    avg_row_h = sum(y2 - y1 for y1, y2 in rows) / len(rows)

    # Derive icon size from actual row height (reference: 66px icon / 90px row ≈ 0.73)
    icon_sz = max(20, int(avg_row_h * 0.73))
    tmpl_target = max(12, int(icon_sz * 0.60))
    item_sz = max(10, int(icon_sz * 0.20))

    print(f"Image: {w}x{h}  row_h~{avg_row_h:.0f}px  icon~{icon_sz}px  tmpl~{tmpl_target}px  item~{item_sz}px")

    print(f"Detected {len(rows)} rows:")
    for i, (y1, y2) in enumerate(rows):
        print(f"  Row {i+1}: y={y1}-{y2} (h={y2-y1})")

    templates = load_templates(TEMPLATES_DIR, tmpl_target)
    print(f"Champion templates: {len(templates)}")

    item_templates = {}
    if ITEMS_DIR.exists():
        item_templates = load_item_templates(ITEMS_DIR, item_sz)
        print(f"Item templates: {len(item_templates)}")

    DEBUG_DIR.mkdir(exist_ok=True)
    results = []

    x1 = int(ICONS_X_START * sx)
    x2 = int(ICONS_X_END * sx)

    for i, (ry1, ry2) in enumerate(rows):
        # Detect player name from the left side of the row.
        try:
            player_name = detect_player_name(img, ry1, ry2)
        except Exception:
            player_name = ""

        row = img[ry1:ry2, x1:x2]
        cv2.imwrite(str(DEBUG_DIR / f"row_{i+1}.png"), row)
        champs = match_row(row, templates, icon_sz,
                          item_templates=item_templates,
                          item_size=item_sz,
                          row_idx=(i + 1) if debug else -1)
        results.append({"placement": i + 1, "player_name": player_name, "champions": champs})

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
    results = analyze_screenshot(path, debug=True)

    print(f"\n{'='*60}\nRESULTS\n{'='*60}")
    for p in results:
        n = p["placement"]
        name = p.get("player_name", "")
        champs = p["champions"]
        parts = []
        for c in champs:
            s = f"{c['name']}*{c['stars']}({c['score']:.2f})"
            if c.get("items"):
                s += f" [{', '.join(c['items'])}]"
            parts.append(s)
        line = ", ".join(parts)
        player_tag = f" ({name})" if name else ""
        print(f"\n#{n}{player_tag} [{len(champs)} units]: {line or 'none detected'}")


if __name__ == "__main__":
    main()
