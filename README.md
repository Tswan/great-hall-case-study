# The Great Hall — case study site

A scroll-driven case study for the Hogwarts Great Hall immersive environment (HBO Max on Apple Vision Pro). The page renders the **real production bake** of the hall in WebGL; scrolling flies the camera through it, chapter by chapter.

> Created using Anthropic Claude. Keep this note on internal versions until a human has reviewed and verified the content.

## Run it

The page loads a GLB and textures, so it needs to be served over http (opening `index.html` directly from Finder won't load the model).

```bash
cd great-hall-case-study
python3 -m http.server 8080      # then open http://localhost:8080
```

To edit the JavaScript, change `js/main.js` and rebuild the bundle:

```bash
npm install
npm run build        # → js/app.js
npm run dev          # watch + serve on :8080
```

## What's on the page

| Chapter | Camera | Live effect |
|---|---|---|
| Intro | Outside the entrance | Hall "materialises" outward from the doors as you scroll |
| Brief | Entering the hall | Stats count-up |
| Project setup (Travis) | Elevated overview | Scrolling outliner of the real object names |
| Tables & UVs (Travis) | Low along the house tables | Live UV checker on the table meshes + cyan lines on actual UV seams |
| Enchanted Ceiling (Travis) | Looking up | Animated sky shader: star layers, drifting cloud textures, procedural noise clouds |
| Transparent rafters (Travis) | Up into the rafters | Height-based opacity fade (15 m → 30 m), with sliders |
| Fire (Mark) | At the fireplace | Flipbook sprite-sheet fire (16×16, 24 fps) and torches (16×8) |
| Floating candles (Mark) | Under the candles | Mark's real candles (2,500, at their Blender positions) with RCP-style noise bobbing |
| Day & night (Luke) | Down the length of the hall | Day/night texture swap + 360° render comparison slider |
| In the headset | Viewer position, facing the video dock | On-device capture |
| Credits | High overview | — |

The **Night / Day** toggle (top right) works everywhere; it swaps the whole hall between the two baked texture sets.

## Folder layout

```
index.html            page + all copy
css/style.css         styling
js/main.js            source (three.js scene, scroll choreography, effects)
js/app.js             built bundle (what index.html loads)
assets/model/night.glb       night composition (Scene_Night), meshopt + WebP: the source for the KTX2 files below (not loaded by the page)
assets/model/day.glb         day composition (Scene_Day), meshopt + WebP: source, not loaded
assets/model/night.ktx2.glb  night with KTX2 textures: loads first on desktop
assets/model/day.ktx2.glb    day with KTX2 textures: loads in the background on desktop, used by the Day toggle
assets/model/*.mobile.ktx2.glb  half-resolution versions for phones/tablets; only one lighting scene is kept in memory at a time
assets/basis/         Basis transcoder for KTX2Loader (copied from three/examples/jsm/libs/basis; re-copy when upgrading three)
assets/model/ceiling.glb     Enchanted Ceiling dome (stars + cloud shells), ~50 KB
assets/model/table-seams.bin UV seam edges for the house tables (computed from the meshes)
assets/textures/      sky, fire sprite sheets, candle
assets/media/         images/video pulled from the Feb 2025 town hall deck
tools/                conversion scripts used to build the GLB
```

## How the 3D was produced

Source: the Reality Composer Pro project in `Development/wbd-beam-rc-environments/environments/great_hall/GreatHallProject` (the newer copy — an older one lives in `Development/great_hall` and is **not** used). No Blender was needed.

`tools/usd-to-glb.mjs` composes the stage the way RCP does and exports each lighting mode separately:

1. Opens the root `Scene.usda` and follows `Scene_Night` → `nightScene/Scene.usda` and `Scene_Day` → `dayScene/Scene.usda`, plus every referenced `.usdc` (the Blender bake `greathallblender-bake1.usdc`, replacement pillars/doors/banners/sconces, the floors).
2. Applies the overrides from all layers: deactivated prims, transforms, material bindings and the `Baked_Image_Node` / image texture each material points at (`tools/usda.mjs`, `tools/compose.mjs`).
3. Uses each material's UV set (e.g. the tables' `fixUvMap`); for the floors it picks the bake UVs (`new_uv`) rather than the tiling `st` set.
4. Bakes transforms into world space (Y-up, the hall at 0.25 scale as in RCP), so fire/candle/ceiling positions from the RCP scene line up.
5. Textures resized to WebP (1536 px for walls/floor/tables, 768 px for props); `tools/optimize-glb.mjs` welds and meshopt-compresses.

`tools/ceiling-to-glb.mjs` exports the Enchanted Ceiling dome (`enchanted-ceiling-assets/greathall-ceiling.usdc`: the `stars` and `cloud` shells, placed as in the root scene) to `assets/model/ceiling.glb`. Its RCP shader graphs (ramp, star mask, Fractal3D noise clouds, pill opacity mask) are re-created as WebGL shaders in `js/main.js`, so they're close but not identical.

`tools/candles/` builds `assets/model/candles.glb` (~230 KB) from `candles-assets/candles-cluster-verticle-offset-2.usdc`: export the cluster in world space (01), split it into individual candles (02), fit each one to one of three body shapes or the flame shape (03, ≤3 mm error), and write them as `EXT_mesh_gpu_instancing` instances (04). Bodies use `candles-single-test.jpg` (night) / `candles-bake-day-PS.jpg` (day), flames `test-fire-3.png`; the bob in `js/main.js` re-creates the RCP GeometryModifier noise (amplitudes tuned by eye).

Per-object texture choices are listed in `tools/night-mesh-texture-map.tsv` and `tools/day-mesh-texture-map.tsv` — anything marked `(guessed)` had a missing texture in the project and borrows its sibling's bake.

To rebuild: `node tools/usd-to-glb.mjs night out.glb` / `day`, then `node tools/optimize-glb.mjs out.glb assets/model/night.glb` (needs `three`, `@gltf-transform/*`, `sharp`, `meshoptimizer`).

Then `npm run textures` (about 5–10 minutes) re-encodes the hall textures as KTX2 (Basis ETC1S) with `tools/compress-textures.mjs`, writing the four `*.ktx2.glb` files the page loads. The WebP textures take ~2 GB of GPU memory per scene once decoded, which crashes iOS Safari; KTX2 stays compressed on the GPU (~0.3 GB desktop, ~0.1 GB mobile). Pass `--quality` (1–255, default 230) if walls show banding or the download is too big.

## Please review before publishing

- **Facts and attributions.** Copy was written from your brief, the two town hall decks and the project files. Check especially: the rafter write-up (sorting/mesh-sorting-group wording), "8-second clip" for the fire, the Avalanche/Hogwarts Legacy description, and the extended team names/roles.
- **House tables.** In the project the house tables are active in the **day** scene and switched off in the **night** scene. The page follows that, and the Tables & UVs chapter temporarily switches the hall to day so they're visible.
- **Missing textures.** A handful of objects reference textures that aren't in the project (e.g. `SM_HW_GH_WallPanelingBalcony_B_4`, some timber fills, upper window panes); see the `(guessed)` / `NONE` rows in the tool maps.
- **Recreated effects.** Sky, fire, candles and torch glow are WebGL recreations that use the production textures/sprite sheets. They're close, not identical, to RCP.
- **Approvals.** This is a public portfolio piece using Harry Potter IP, Avalanche Software source assets and colleagues' names. IP usage requires sign-off, and let Mark and Luke review how they're credited before it goes live. Share only with people authorised to see the source material until then.
