"""The room's real size: metres from the camera to every point of a picture, and the camera's
field of view (MoGe-2 on fal), for the 3D room.

Depth Anything only says what is nearer than what: its far wall could be 4 m or 12 m away, so
pieces at their listed size looked tiny. MoGe-2 measures the room in metres and the lens it was
seen through. Its point cloud (a million points) is read once and kept as a small grid.
"""

import asyncio
import struct

import httpx
from pydantic import BaseModel

from app.cache import cached
from app.tools.depth import DepthError, fal_hosted
from app.tools.fal_client import FalError, fal

MOGE = "fal-ai/moge-2"
COLS = 240  # grid columns; rows follow the picture's shape
MAX_PLY_BYTES = 80 * 1024 * 1024
SIZES = {"float": 4, "float32": 4, "uchar": 1, "uint8": 1, "double": 8, "int": 4, "uint": 4}


class Geometry(BaseModel):
    """Distances in metres along each grid ray, row by row from the top left; 0 where unknown.
    Grid point (i, j) looks through (i / cols, j / rows) of the picture."""

    fov_y: float  # degrees, top to bottom of the picture
    fov_x: float
    cols: int
    rows: int
    distance: list[float]


def grid_from_points(
    ply: bytes | bytearray, width: int, height: int, fx: float, fy: float, cx: float, cy: float
) -> Geometry:
    """The point nearest each grid point of the picture. Camera at the origin looking down -z,
    y up (OpenGL), intrinsics as fractions of the picture."""
    start = ply.index(b"end_header\n") + len(b"end_header\n")
    header = ply[:start].decode("ascii", "replace")
    count = int(header.split("element vertex ")[1].split()[0])
    # x y z first, then whatever else each point carries (normals, colour), skipped.
    vertex = header.split("element vertex ")[1].split("element ")[0]
    kinds = [line.split()[1:3] for line in vertex.splitlines() if line.startswith("property ")]
    if "binary_little_endian" not in header or [n for _, n in kinds[:3]] != ["x", "y", "z"]:
        raise ValueError("Unexpected point cloud layout")
    if any(k[0] != "float" for k in kinds[:3]):
        raise ValueError("Unexpected point cloud layout")
    point = struct.Struct(f"<3f{sum(SIZES[t] for t, _ in kinds[3:])}x")
    if count * point.size > len(ply) - start:
        raise ValueError("The point cloud is cut short")
    rows = max(2, round(COLS * height / width))
    distance = [0.0] * ((COLS + 1) * (rows + 1))
    sx, sy = COLS / width, rows / height
    # A view, not a copy: the cloud is tens of megabytes on a small server.
    for x, y, z in point.iter_unpack(memoryview(ply)[start : start + count * point.size]):
        if z >= -1e-3:
            continue
        # Its pixel, then the grid point it lands on (only points right on one are kept).
        px = (fx * x / -z + cx) * width
        py = (fy * -y / -z + cy) * height
        gx, gy = px * sx, py * sy
        i, j = round(gx), round(gy)
        if (
            abs(gx - i) > sx * 0.5
            or abs(gy - j) > sy * 0.5
            or not (0 <= i <= COLS and 0 <= j <= rows)
        ):
            continue
        distance[j * (COLS + 1) + i] = round((x * x + y * y + z * z) ** 0.5, 3)
    return Geometry(fov_y=0, fov_x=0, cols=COLS, rows=rows, distance=distance)


async def room_geometry(image_url: str) -> Geometry:
    """Only our own pictures. Same picture, same answer, for good."""
    if not fal_hosted(image_url):
        raise DepthError("Only a Roomify preview can be shown in 3D.")

    async def make() -> Geometry:
        try:
            result = await fal(MOGE, {"image_url": image_url, "model": "vitl", "export_glb": False,
                                      "export_ply": True, "resolution_level": 7}, timeout=90, max_age_s=None)  # fmt: skip
            data = result.data
            ply_url, (fx_row, fy_row) = data["point_cloud"]["url"], data["intrinsics"][:2]
            width, height = data["depth_map"]["width"], data["depth_map"]["height"]
        except (FalError, KeyError, TypeError, ValueError) as exc:
            raise DepthError("Couldn't measure the room. Try again.") from exc
        if not fal_hosted(ply_url):
            raise DepthError("Couldn't measure the room. Try again.")
        try:
            async with (
                httpx.AsyncClient(timeout=60) as client,
                client.stream("GET", ply_url) as response,
            ):
                response.raise_for_status()
                ply = bytearray()
                async for chunk in response.aiter_bytes():
                    ply.extend(chunk)
                    if len(ply) > MAX_PLY_BYTES:
                        raise DepthError("The room's measurements were too large to read.")
            # A million points: CPU work, off the event loop.
            grid = await asyncio.to_thread(
                grid_from_points, ply, width, height, fx_row[0], fy_row[1], fx_row[2], fy_row[2]
            )
        except (httpx.HTTPError, ValueError, IndexError) as exc:
            raise DepthError("Couldn't read the room's measurements. Try again.") from exc
        return grid.model_copy(
            update={"fov_y": float(data["fov_y"]), "fov_x": float(data["fov_x"])}
        )

    return await cached(
        "room_geometry", {"image_url": image_url, "model": MOGE}, make, Geometry, None
    )
