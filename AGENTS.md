# HexRealms — agent notes

Browser strategy game. No build step: plain JS + a single `map.html` entry point.

## Layout
- `map.html` — entry point (loads all scripts via `<script>`, contains HUD/menu/tooltip).
- `Game.js` — `Game` class, wires managers; `newGame()` builds a `MapGenerator`.
- `MapGenerator.js` — the whole map: terrain/voronoi, biomes, rivers, decorations,
  towns, armies, factions, rendering. Large single file split into section objects
  (`MapTerrain`, `MapBiomes`, `MapDecorations`, `MapPixelDecor`, `MapPerf`, …).
- `ArmyManager.js`, `FactionsManager.js`, `AIManager.js`, `DiplomacyManager.js`,
  `AssetManager.js`, `TurnManager .js` (note the space in the filename).

## Running / testing
- There is no test suite. Verify in a real browser with Playwright (chromium is
  installed). Serve/open `map.html` via `file://`.
- Typical harness: set `#menuRegionCount`, click `#startGameBtn`, wait for
  `game.mapGen.terrain.regions.all.length > 0`, then assert on
  `game.mapGen.getRegionData(region)`.
- Ad-hoc test scripts belong in `.agent_tmp/` (git-ignored-ish scratch dir).

## Gotchas
- Manager methods are bound into `this.<manager>` objects in the `MapGenerator`
  constructor. A method that calls a sibling via `this.x()` will fail with
  `this.x is not a function` — call it as `this.<manager>.x()` (e.g.
  `this.utils.distanceToSegment`).
- Canvas `ctx.filter = 'blur(...)'` re-runs the blur on **every** `stroke()`.
  Batch strokes into one path before stroking, or static-map repaint becomes
  seconds-long (this was the main render bottleneck).
- `biomeField.cell` (px per biome raster cell) comes from
  `options.biomeCell` → `this.biomeCellSize`; keep them in sync.

## Rendering model (simplified, single "overview" LOD)
- Two canvases: an offscreen `staticCanvas` (terrain, rivers, coastline,
  borders, fog, decor textures) repainted only when `this._staticDirty` is set,
  and the visible canvas which blits it each frame plus dynamic objects (towns,
  armies, selection, reachable area).
- `viewMode` is a *colour* switch only (`terrain`, `political`, `factions`,
  `gold`, `food`, …). There is no global/overview/detail zoom-LOD split anymore —
  don't reintroduce per-layer caches.
- Biomes are a noise field (`MapBiomes`), not a per-region property. Each region
  stores `biomeMix` (biome id → area fraction) and `biomeBand` (dominant id);
  `assignRegions` also derives `resourceBase`, `moveCost`, `isWater`.
  `biomeMix` is latitude-weighted, so north/south climate bands emerge.
- Decorations/towns are chosen from `biomeMix` (`MapDecorations.buildKeyPlan`),
  so a mixed region draws a blend of sprites rather than one biome's set.
- `variantsPerKey` maps (decor + towns) must match the files that actually exist
  in `icons/`; a count that is too high spams the console with 404s. Towns use a
  per-key count map now (all town sets have 1–2 variants).

