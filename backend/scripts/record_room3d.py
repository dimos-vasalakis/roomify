"""Package an already-generated room for an offline browser demo. No model calls.

Run from backend/: .venv/bin/python scripts/record_room3d.py --shell <cache JSON> --photo <cache JSON>
Only cached listings and models are used; missing inputs fail instead of being invented.
"""

import argparse
import hashlib
import json
import struct
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[2]


def read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def normalized(url: str) -> str:
    return url.replace("wd3.medium/", "wd3.large/").split("?")[0]


def record(shell_path: Path, photo_path: Path, cache: Path, output: Path) -> None:
    shell = read(shell_path)
    records = [read(p) for p in (cache / "model3d").glob("*.json")]
    listings = [read(p)["result"].get("listing") for p in (cache / "product_page").glob("*.json")]
    output.mkdir(parents=True, exist_ok=True)
    sources: dict[str, str] = {}

    with httpx.Client(timeout=60, follow_redirects=True) as client:
        def asset(url: str, ext: str) -> str:
            name = hashlib.sha256(url.encode()).hexdigest()[:16] + ext
            path = output / name
            if not path.exists():
                response = client.get(url)
                response.raise_for_status()
                path.write_bytes(response.content)
            if ext == ".glb":
                data = path.read_bytes()
                if data[:4] != b"glTF":
                    raise ValueError(f"Not a GLB: {name}")
                size = struct.unpack_from("<I", data, 12)[0]
                document = json.loads(data[20:20 + size])
                if any(x.get("uri") and not x["uri"].startswith("data:")
                       for kind in ["buffers", "images"] for x in document.get(kind, [])):
                    raise ValueError("GLB has external dependencies; record those first")
            local = f"/demo3d/{name}"
            sources[local] = url
            return local

        def model(photo: str) -> dict[str, Any]:
            matches = [r for r in records if any(normalized(u) == normalized(photo)
                       for u in r["inputs"].get("image_urls", [r["inputs"].get("image_url", "")]))]
            if not matches:
                raise ValueError(f"No cached model for {photo}")
            best = max(matches, key=lambda r: (r["result"].get("views", 1), r["saved_at"]))["result"]
            return {"views": 1, "sides": [], **best, "glb_url": asset(best["glb_url"], ".glb")}

        models = {}
        products = []
        for piece in shell["inputs"]["pieces"]:
            slot, title = piece["name"].split(": ", 1)
            listing = next((p for p in listings if p and p["title"] == title), None)
            if not listing:
                raise ValueError(f"No cached listing for {title}")
            photo = asset(listing["image_url"], ".jpg")
            models[photo] = model(listing["image_url"])
            products.append({
                "id": listing["id"], "slot": slot.capitalize(), "title": title,
                "retailer": listing["retailer"], "url": listing["url"],
                "priceEur": listing["price_eur"], "currency": "EUR",
                "widthCm": listing["width_cm"], "depthCm": listing["depth_cm"],
                "heightCm": listing["height_cm"], "deliveryText": listing["delivery_text"],
                "box": piece["box"], "thumb": {"src": photo}, "placed": True,
            })
        photo_url = shell["result"]["image_url"]
        geometry = next((read(p)["result"] for p in (cache / "room_geometry").glob("*.json")
                         if read(p)["inputs"]["image_url"] == photo_url), None)
        if not geometry:
            raise ValueError("The shell has no recorded geometry")
        objects = next((read(p)["result"]["objects"] for p in (cache / "room_objects").glob("*.json")
                       if read(p)["inputs"]["image_url"] == photo_url), [])
        for obj in objects:
            original = obj["crop_url"]
            obj["crop_url"] = asset(original, ".jpg")
            models[obj["crop_url"]] = model(original)
        captured = datetime.fromtimestamp(shell["saved_at"], UTC).isoformat()
        room = {
            "id": "recorded-room-3d", "name": "Living room · recorded demo", "city": "Athens",
            "budgetEur": 700, "wallCm": None, "prompt": "A sofa and a floor lamp for this living room, under €700.",
            "group": "Earlier", "updatedLabel": "Recorded demo", "status": "done",
            "beforeSrc": asset(read(photo_path)["result"]["image_url"], ".jpg"),
            "afterSrc": asset(shell["inputs"]["render_url"], ".jpg"),
            "products": products, "rejections": [], "alternatives": {},
            "ask": None, "now": None, "offer": True, "recorded3d": "/demo3d/scene.json",
            "chat": [{"role": "agent", "text": "Recorded 3D demo. These are saved shop listings and generated models, not a live shopping run. Prices are from the recording. Open the 3D view to explore the room and inspect each piece."}],
        }
        manifest = {"capturedAt": captured, "shell": {
            "photo": asset(photo_url, ".jpg"), "depth": asset(shell["result"]["depth_url"], ".png"),
            "geometry": geometry, "objects": objects,
        }, "models": models, "sources": sources}
        (output / "scene.json").write_text(json.dumps(manifest, ensure_ascii=False))
        target = ROOT / "frontend/src/data/recordedRoom3d.ts"
        target.write_text("// Recorded by backend/scripts/record_room3d.py; shop facts stay as captured.\n"
                          "import type { Session } from '../types'\n\nexport const RECORDED_ROOM: Session = "
                          + json.dumps(room, ensure_ascii=False, indent=2) + "\n")
    print(f"Recorded {len(products)} products, {len(objects)} existing objects, {len(sources)} local assets.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shell", type=Path, required=True)
    parser.add_argument("--photo", type=Path, required=True, help="The original photo's photo_depth cache JSON")
    parser.add_argument("--cache", type=Path, default=ROOT / "backend/.cache")
    parser.add_argument("--output", type=Path, default=ROOT / "frontend/public/demo3d")
    args = parser.parse_args()
    record(args.shell, args.photo, args.cache, args.output)
