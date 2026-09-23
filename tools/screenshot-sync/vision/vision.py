"""
UI detection and removal for Quest screenshots. Runs on the gaming PC, driven by
screenshot-sync.ps1; see ../README.md.

  vision.py detect  <jobs.json> <out.json>
      jobs: [{"id": 1, "path": "C:/.../shot.jpg"}, ...]
      out:  {"1": [{"x":..,"y":..,"w":..,"h":..,"kind":"subtitle"}, ...], ...}

  vision.py inpaint <jobs.json> <out.json>
      jobs: [{"id": 1, "path": "...jpg", "mask": "...png", "out": "...clean.jpg"}, ...]
      out:  {"1": {"ok": true}, "2": {"ok": false, "error": "..."}}

Batch files rather than one process per shot: loading LaMa takes a couple of
seconds, painting a shot takes well under one.
"""

from __future__ import annotations

import json
import os
import sys
import traceback

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
# Outside the repo: the model is 200 MB and the repo folder is synced.
MODEL_DIR = os.environ.get(
    "QUEST_VISION_MODELS",
    os.path.join(os.environ.get("LOCALAPPDATA", HERE), "Quest", "screenshot-sync", "models"),
)
LAMA_PATH = os.path.join(MODEL_DIR, "lama_fp32.onnx")
LAMA_SIZE = 512


def read_image(path: str) -> np.ndarray:
    # imdecode rather than imread: imread cannot open non-ASCII Windows paths.
    data = np.fromfile(path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"cannot decode {path}")
    return img


def write_jpeg(path: str, img: np.ndarray) -> None:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not ok:
        raise ValueError("jpeg encode failed")
    buf.tofile(path)


def providers() -> list[str]:
    import onnxruntime as ort

    available = ort.get_available_providers()
    # DirectML runs on any DX12 GPU (NVIDIA/AMD/Intel); CUDA if someone installed
    # onnxruntime-gpu instead. CPU always works, just slower.
    return [p for p in ("CUDAExecutionProvider", "DmlExecutionProvider") if p in available] + [
        "CPUExecutionProvider"
    ]


# ---------------------------------------------------------------------------
# Detection: where is on-screen text that is UI rather than part of the world?
# ---------------------------------------------------------------------------

# Zones, as fractions of the frame. Text anywhere else (signs, posters, books)
# is part of the game world and is left alone.
SUBTITLE_TOP = 0.65  # subtitles sit in the bottom 35%...
SUBTITLE_CENTER = (0.2, 0.8)  # ...roughly centred horizontally
CORNER_X = 0.18  # "Skip", "Hold Ⓐ to skip", save icons
CORNER_Y = 0.15
EDGE_X = 0.10  # other HUD text hugging an edge (ammo, item names)
EDGE_Y = 0.08


def classify(cx: float, cy: float, w: float) -> str | None:
    near_left, near_right = cx < CORNER_X, cx > 1 - CORNER_X
    near_top, near_bottom = cy < CORNER_Y, cy > 1 - CORNER_Y
    if (near_left or near_right) and (near_top or near_bottom):
        return "corner"
    if cy > SUBTITLE_TOP and SUBTITLE_CENTER[0] < cx < SUBTITLE_CENTER[1] and w < 0.9:
        return "subtitle"
    if cx < EDGE_X or cx > 1 - EDGE_X or cy < EDGE_Y or cy > 1 - EDGE_Y:
        return "edge"
    return None


def pad_box(x: float, y: float, w: float, h: float, kind: str, aspect: float) -> dict:
    # Pad by a share of the text height: covers outline, drop shadow and the
    # subtitle's backing plate. Corner prompts also get room sideways for the
    # button glyph that usually sits next to the text.
    py = h * 0.45
    px = py / aspect
    if kind == "corner":
        px += h * 1.6 / aspect
    x0, y0 = max(0.0, x - px), max(0.0, y - py)
    x1, y1 = min(1.0, x + w + px), min(1.0, y + h + py)
    return {"x": round(x0, 5), "y": round(y0, 5), "w": round(x1 - x0, 5), "h": round(y1 - y0, 5), "kind": kind}


def to_quad(item) -> np.ndarray | None:
    """RapidOCR yields [quad, text, score] rows, or bare quads when recognition is
    off, depending on version -- accept either."""
    for candidate in (item, item[0] if len(item) else None):
        try:
            quad = np.asarray(candidate, dtype=np.float32).reshape(-1, 2)
            if len(quad) >= 4:
                return quad
        except (ValueError, TypeError):
            continue
    return None


def detect(jobs: list[dict]) -> dict:
    from rapidocr_onnxruntime import RapidOCR

    engine = RapidOCR()
    out: dict[str, list[dict]] = {}
    for job in jobs:
        img = read_image(job["path"])
        H, W = img.shape[:2]
        result, _ = engine(img, use_det=True, use_cls=False, use_rec=False)
        boxes: list[dict] = []
        for item in result or []:
            quad = to_quad(item)
            if quad is None:
                continue
            x0, y0 = quad.min(axis=0)
            x1, y1 = quad.max(axis=0)
            x, y, w, h = float(x0) / W, float(y0) / H, float(x1 - x0) / W, float(y1 - y0) / H
            if w <= 0 or h <= 0:
                continue
            kind = classify(x + w / 2, y + h / 2, w)
            if kind:
                boxes.append(pad_box(x, y, w, h, kind, W / H))
        out[str(job["id"])] = boxes
    return out


# ---------------------------------------------------------------------------
# Inpainting: LaMa, one padded crop per masked region, so the rest of the
# frame never leaves full resolution.
# ---------------------------------------------------------------------------


class Lama:
    def __init__(self) -> None:
        import onnxruntime as ort

        if not os.path.exists(LAMA_PATH):
            raise FileNotFoundError(f"LaMa model missing: {LAMA_PATH} (run install-task.ps1 -WithVision)")
        self.session = ort.InferenceSession(LAMA_PATH, providers=providers())
        names = [i.name for i in self.session.get_inputs()]
        self.image_name = "image" if "image" in names else names[0]
        self.mask_name = "mask" if "mask" in names else names[1]

    def run(self, crop_bgr: np.ndarray, crop_mask: np.ndarray) -> np.ndarray:
        h, w = crop_bgr.shape[:2]
        img = cv2.resize(crop_bgr, (LAMA_SIZE, LAMA_SIZE), interpolation=cv2.INTER_AREA)
        msk = cv2.resize(crop_mask, (LAMA_SIZE, LAMA_SIZE), interpolation=cv2.INTER_NEAREST)
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        feed = {
            self.image_name: rgb.transpose(2, 0, 1)[None],
            self.mask_name: (msk > 127).astype(np.float32)[None, None],
        }
        res = self.session.run(None, feed)[0][0].transpose(1, 2, 0)
        # Exports differ on output scale; normalise either to 0-255.
        if res.max() <= 2.0:
            res = res * 255.0
        res = cv2.cvtColor(np.clip(res, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
        return cv2.resize(res, (w, h), interpolation=cv2.INTER_CUBIC)


def crop_window(bx: int, by: int, bw: int, bh: int, W: int, H: int) -> tuple[int, int, int]:
    """Square window around a region with context on every side. At least 512px
    when the frame allows, so small HUD bits are painted at native resolution."""
    side = int(max(bw, bh) * 1.6) + 64
    side = max(side, min(LAMA_SIZE, W, H))
    side = min(side, W, H)
    cx, cy = bx + bw // 2, by + bh // 2
    x0 = min(max(0, cx - side // 2), W - side)
    y0 = min(max(0, cy - side // 2), H - side)
    return x0, y0, side


def inpaint(jobs: list[dict]) -> dict:
    lama = Lama()
    out: dict[str, dict] = {}
    for job in jobs:
        try:
            img = read_image(job["path"])
            H, W = img.shape[:2]
            mask = cv2.imdecode(np.fromfile(job["mask"], dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
            if mask is None:
                raise ValueError("cannot decode mask")
            if mask.shape != (H, W):
                mask = cv2.resize(mask, (W, H), interpolation=cv2.INTER_NEAREST)
            mask = (mask > 127).astype(np.uint8) * 255
            if not mask.any():
                raise ValueError("mask is empty")

            # Group nearby fragments (letters of one subtitle line) into one region.
            group = cv2.dilate(mask, np.ones((31, 31), np.uint8))
            n, _, stats, _ = cv2.connectedComponentsWithStats(group)
            regions = sorted((stats[i] for i in range(1, n)), key=lambda s: -int(s[4]))

            result = img.copy()
            for bx, by, bw, bh, _area in regions:
                x0, y0, side = crop_window(int(bx), int(by), int(bw), int(bh), W, H)
                crop = result[y0 : y0 + side, x0 : x0 + side]
                crop_mask = mask[y0 : y0 + side, x0 : x0 + side]
                if not crop_mask.any():
                    continue
                painted = lama.run(crop, crop_mask)
                # Blend only the masked pixels (grown a little, feathered), so the
                # resampled crop never softens the untouched surroundings.
                alpha = cv2.dilate(crop_mask, np.ones((5, 5), np.uint8))
                alpha = cv2.GaussianBlur(alpha, (0, 0), 2.0).astype(np.float32)[..., None] / 255.0
                blended = crop.astype(np.float32) * (1 - alpha) + painted.astype(np.float32) * alpha
                result[y0 : y0 + side, x0 : x0 + side] = np.clip(blended, 0, 255).astype(np.uint8)

            write_jpeg(job["out"], result)
            out[str(job["id"])] = {"ok": True}
        except Exception as err:  # one bad shot must not sink the batch
            out[str(job["id"])] = {"ok": False, "error": f"{type(err).__name__}: {err}"}
            traceback.print_exc(file=sys.stderr)
    return out


def main() -> int:
    if len(sys.argv) != 4 or sys.argv[1] not in ("detect", "inpaint"):
        print(__doc__, file=sys.stderr)
        return 2
    command, jobs_path, out_path = sys.argv[1:]
    with open(jobs_path, encoding="utf-8-sig") as f:
        jobs = json.load(f)
    if isinstance(jobs, dict):  # PowerShell serialises a one-item array as an object
        jobs = [jobs]
    result = detect(jobs) if command == "detect" else inpaint(jobs)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
