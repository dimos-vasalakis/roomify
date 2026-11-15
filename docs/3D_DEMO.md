# Demoing the 3D room

Start the front end with `cd frontend && npm run dev`. Open
[the recorded room](http://localhost:5173/?replay=3d) and click **Look around in 3D**.
Add `&stage=1` for larger projector text.

The recording needs no API keys, backend, login or external network. Its original
photo, furnished preview, prepared shell, depth, measured geometry, product photos
and five textured GLBs are in `frontend/public/demo3d/` (about 18 MB). Vite includes
them in the production build. The scene is explicitly labelled **Recorded 3D demo**;
shop prices are the values read when recorded, not current price or stock claims.
The recording is read-only. Shop links open the real listings and need internet.

A short demo sequence:

1. Show Before/After: the original sofa changes to the chosen sofa and floor lamp.
2. Open 3D. The preview dissolves into the reconstructed room.
3. Drag around, or choose Left, Back and Top. Use +/− or pinch/scroll to zoom.
4. Pick **Sofa · €599.00**: inspect the mesh, the actual listing photo, dimensions
   and shop link. This sofa was reconstructed from three shop photos.
5. Choose **Whole room**, then inspect **Floor lamp · €95.00**.
6. Try rotation, pause it, and return to Photo. Escape closes the viewer.

On phones the viewer opens expanded automatically. On desktop use the expand
button to give it the stage. Arrow keys turn, +/− zoom and Home returns to Front.
Focus stays within the expanded viewer and returns to the opening button on close.

This is a reconstruction from photos, not a measured architectural survey. The
room surfaces outside the photo are inferred; hidden sides of product meshes are
approximate. Listed dimensions appear only where the captured listing supplied
them.

## Live rooms

Open `/?demo=1` with `VITE_API_URL` configured and the production backend running.
After a room finishes, its shell and models start preparing in the background.
The same 3D viewer opens with live results. Model preparation can take minutes
on a first request. A failed model becomes a labelled flat-photo fallback. A
failed room preparation keeps an inline error and Try again; the view can always
be closed. Saved generation results are reused by the backend cache.

## Refreshing the recording

Run from `backend/` after making and reviewing a real room through the live flow:

```bash
.venv/bin/python scripts/record_room3d.py \
  --shell .cache/room_shell/<record>.json \
  --photo .cache/photo_depth/<original-photo-record>.json
```

Use the matching original-photo record, not the prepared shell. The packager reads
already-cached shop listings, measured geometry, object cutouts and GLBs. It makes
no generation calls and fails if required inputs are missing. It downloads the
assets and rejects GLBs with unrecorded external dependencies. It writes the
recorded session and `scene.json`, which retains source URLs and capture time.
Review the result before committing a replacement recording.

## Validation

`npm run test:e2e` in `frontend/` checks 1440px and 390px layouts. The 3D tests load
the real committed meshes; reject provider/backend requests from the recording;
exercise presets, keyboard controls, rotation, product details, expansion, focus
containment, close/reopen, and failed-model/failed-shell recovery. The regular
live-flow test uses production routes and deterministic service fixtures. No new
paid generation is needed for these tests.

`REPLAY=1` on the backend is a separate cache-only mode and requires cache records
matching the live endpoint inputs. A complete shopping-run backend recording is
still outside this portable 3D bundle.
