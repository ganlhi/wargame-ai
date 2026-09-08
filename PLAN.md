# Implementation Plan — Wargame AI

> **Status as of 2026-09-08.** This plan has been reconciled with the code actually on `main`.
>
> **Phase 11 reshaped the model: the table is now infinite**, **Phase 12** added movement-range feedback, map pan/zoom and a wind-drift fix, **Phase 13** replaced native dropdowns with an anchored control that works on mobile, **Phase 14** corrected the attitude bands and added rig types, **Phase 15** implemented the tacking procedure, and **Phase 16** made reloading per arc. Table dimensions, edge clamping, edge-based AI scoring and the photo-capture flow are all gone; coordinates are relative to an origin entity and terrain is described with primitives. Items below that describe the old bounded table are marked accordingly.
> Legend: `[x]` done · `[~]` partially done / deviates from original plan · `[ ]` not started.
> Items marked `[~]` or `[ ]` are consolidated as actionable work in **Phase 10 — Remaining Work**.

## Tech Stack

| Layer | Planned | Actual | Notes |
|-------|---------|--------|-------|
| Framework | React 19 + TypeScript | ✅ React 19 + TS | |
| Build tool | Vite | ✅ Vite 8 | |
| State management | Zustand | ✅ Zustand 5 (`persist`) | Only `savedGames` + default dims are persisted via middleware; full game state is written to a per-game `game-${id}` localStorage key on explicit save |
| Canvas / rendering | PixiJS v8 | ✅ PixiJS 8 | Main JS bundle ~560 kB — code-split later (9.4) |
| Persistence | localStorage wrapper | ✅ localStorage | No auto-save yet (see 7.5) |
| Camera / image | `getUserMedia` + canvas | ❌ Removed (Phase 11) | Nothing left for a photo to anchor once the table is unbounded and terrain is primitives |
| Routing | React Router or none | ✅ None | `App.tsx` switches `currentGame ? GameView : MainMenu` |
| Styling | Tailwind CSS | ✅ Tailwind v4 (`@tailwindcss/vite`) | |
| Formatting / lint | ESLint + Prettier | ✅ ESLint (clean) + `.prettierrc` | |

---

## Phase 0 — Project Scaffolding

- [x] **0.1** Initialize Vite + React + TypeScript project
- [x] **0.2** Install and configure Tailwind CSS — _v4 via `@tailwindcss/vite`, `@import "tailwindcss"` in `index.css`_
- [x] **0.3** Install Zustand, PixiJS v8, uuid
- [~] **0.4** ESLint, Prettier, and folder structure — _present, but `src/hooks/` does not exist (no custom hooks yet); `assets/` is empty_
- [x] **0.5** App shell with responsive layout (sidebar + canvas area)

---

## Phase 1 — Main Menu & Game Management

- [x] **1.1** Main menu screen (`MainMenu.tsx`) — list saved games, New Game, load, delete, empty state
- [~] **1.2** Game navigation — _exit-to-menu works and `hasUnsavedChanges` is tracked; an explicit "save on exit" prompt with "Save & Exit" / "Exit Without Saving" is not implemented (a freshly-created, never-saved game is dropped on exit)_
- [x] **1.3** Multi-game support in the store (`savedGames` list, load populates full state)

---

## Phase 2 — Core Data Model & Types

- [~] **2.1** TypeScript interfaces in `src/types/` — _all core types exist (`TableTerrain`, `Attitude`, `UnitStatus`, `AIStyle`, `MoveChunk`, `MovementPlan`, `Unit`, `GameState`, `ActionLogEntry`, `FirePlan`). Deviations from the original sketch:_
  - `FiringArc` is `{ side: bow|stern|port|starboard, maxRange, weapons }` — **not** free min/max angle. Arc angles are derived from `side` via `arcSideToAngles()`.
  - `SpeedRange` is `{ max }` per attitude; the per-turn minimum is `prevMoveDistance/2` per the game rule (see 5.2 / 10.4), not a static per-attitude `min`.
  - `Unit` carries extra runtime fields not in the sketch: `driftSpeed`, `isInIrons`, `prevAttitude`, `prevMoveDistance`, `hiddenAIOrder`, `playerOrder`, `lastFireChunk`, `hiddenAIFirePlan`.
  - `WindDirection` is a plain `number` (0–31) on `GameState.windDirection`, not a named type.
  - Phase 11: `TableTerrain` is `{ center, shape }` (a `TerrainShape` primitive) rather than a vertex list; `GameState` carries `originId` and no longer has `tableWidth`, `tableHeight` or `backgroundImage`.
- [x] **2.2** Zustand store (`useGameStore`) — CRUD for units/terrain, wind get/set, turn management, `persist`

---

## Phase 3 — Table Setup & Terrain Editor

- [x] **3.1** ~~Table creation screen (dimensions)~~ → **Game setup screen** (`GameSetup.tsx`) — compass wind picker only; there are no dimensions to set (Phase 11)
- [x] **3.2** ~~Photo capture flow~~ — **removed in Phase 11** (`PhotoCapture.tsx` deleted)
- [x] **3.3** ~~Terrain polygon editor~~ → **Terrain primitive editor** (`TerrainFormModal.tsx` + `TerrainPanel.tsx`) — circle/ellipse/rectangle with size, rotation and a centre entered as an offset; drag-to-reposition on canvas; type island/shoal/reef (Phase 11)
- [x] **3.4** PixiJS canvas (`GameCanvas.tsx`) — content-fitting viewport, origin-anchored adaptive grid, coloured terrain primitives (Phase 11)

---

## Phase 4 — Unit Management

- [~] **4.1** Unit creation panel (`UnitFormModal.tsx`) — name, side, AI style, max turn points, firing arcs editor. _Deviation: arcs are edited by side + maxRange + weapon count; speed is a per-attitude `max` profile (+ `driftSpeed`) rather than a single min/max speed pair._
- [x] **4.2** Placement mode — click to place, orientation control, ship icon at correct heading
- [x] **4.3** Unit interaction — select, drag, rotate, context menu / form to change status / style / delete, name label
- [x] **4.4** Unit status management — _status colours implemented (active/immobilised/destroyed/surrendered/grappled); mutual `grappledWith` relationship, amber grapple link line, and grapple/release controls in the unit panel all done (see 10.2)._

---

## Phase 5 — Core Movement Logic (`src/game/movement.ts`, `src/utils/attitude.ts`)

- [x] **5.1** `computeAttitude(windDirection, orientation, foreAndAftRigged)` — modulo wrap-around, points-from-bow mapping, rig-dependent in-irons boundary (Phase 14)
- [x] **5.2** `getSpeedRangeForAttitude(...)` / `minMoveDistance(...)` — _`SpeedRange` is `{ max }` per attitude; the minimum move each turn is `prevMoveDistance / 2`, which is the actual game rule (not a simplification — see 10.4). `prevMoveDistance` is `null` until a ship has had a movement phase, in which case the minimum is half the **maximum** instead (Phase 12)._
- [x] **5.3** `computeEffectiveMaxSpeed(baseMaxSpeed, turnPoints)` — 5% penalty per turn point
- [x] **5.4** `splitMovement(distance)` — 5 whole chunks, larger first
- [x] **5.5** `applyMovementPlan(...)` — walks 5 chunks and returns position/orientation/attitude/isInIrons/**distanceTraveled**/path/poses. _Phase 11 removed the table arguments, the per-chunk edge clamping and `hitBoundary`: positions are unbounded and may go negative._
- [x] **5.6** Tacking procedure (rewritten in Phase 15; previously "voluntary in-irons") — drift downwind, keep turning until beating on the other tack (in `enumerateMovementPlans` + `applyMovementPlan`). _`driftSpeed` is the **total drift per turn**; per-chunk loops apply `driftSpeed / 5` and full-turn projections apply `driftSpeed`. This is applied consistently across resolution (`movement.ts`), fire simulation (`combat.ts`), the ghost-path preview (`GameCanvas.tsx`), and AI lookahead (`ai.ts`)._
- [x] **5.7** `enumerateMovementPlans(...)` — brute-forces distances × 1–2 turns at any chunk boundary, plus in-irons / voluntary-in-irons plans

---

## Phase 6 — AI Decision System (`src/game/ai.ts`)

- [x] **6.1** `evaluatePosition(...)` — distance-to-enemy, broadside/raking arcs, firing range, **disengagement leash** (Phase 11, replacing the old edge penalty), terrain proximity, enemy-broadside danger, **and attitude** (`scoreAttitude`, see 10.1). A declared tack is additionally scored by its outcome (`scoreTack`, Phase 15.7).
- [x] **6.2** Style-specific scoring modifiers — aggressive / cautious / defensive (`scoreDistanceByStyle`, `scoreStyleSpecific`)
- [x] **6.3** `suggestMovement(...)` — enumerate → simulate → score → select; includes a **2-ply lookahead** projecting own and enemy future positions
- [~] **6.4** Difficulty / randomness — _`selectPlan()` fully supports a `difficulty` param (random ↔ noisy ↔ best), but it is hardcoded to `1` at both call sites and there is **no UI control**._

---

## Phase 7 — Game Flow & UI

- [x] **7.1** Turn manager in the store — phases `setup | orders | reveal | resolve | game_over`, `currentTurn`, hidden AI orders, `actionLog`
- [x] **7.2** Main game screen (`GameView.tsx`) — top bar (turn / phase / wind), unit sidebar, Pixi canvas, selected-unit panel
- [~] **7.3** Orders phase — _AI computes hidden orders; reveal shows ghost ships + order breakdown (`PlayerMovementPanel.tsx`); resolve applies simultaneously. Status changes (grapple/immobilise/destroy/surrender) are applied manually via the unit form rather than as an explicit pre-movement step._
- [x] **7.4** AI turn flow — hidden orders computed on `startGame`/`resolveTurn`, previewed on reveal, applied on resolve
- [~] **7.5** Game save / load — _manual save to localStorage works, with `migrateSavedGame` normalising legacy formats (schema 5 drops table dimensions and the background photo, adds `originId`, and converts traced terrain polygons to bounding-rectangle primitives). **Missing: auto-save on change, JSON export/import, and `navigator.share()`.**_

---

## Phase 8 — Firing & Combat

- [~] **8.1** Firing arc visualization — _the AI's chosen fire arc is drawn on reveal (`GameCanvas.tsx`). General "draw all of a selected unit's arcs, green if enemy in range / red otherwise" is not implemented._
- [x] **8.3** Per-arc reloading (Phase 16) — an arc that fired on chunk N reloads by chunk N next turn; other arcs are unaffected, and an arc that does not fire is loaded again by the following turn.
- [~] **8.2** Combat resolution — _AI fire-plan computation (`computeAIFirePlan`, `checkFiringArc` in `src/game/combat.ts`) chunk-simulates both ships to find the first firing solution. **No damage/destruction automation** — outcomes (destroy/surrender/immobilise) are applied manually._

---

## Phase 9 — Polish & Mobile Optimisation

- [~] **9.1** Touch interactions — _tap-to-select, drag-to-move, drag-to-pan and pinch-to-zoom all work (Phase 12); **long-press context menu is not implemented**; verify 44×44px tap targets._
- [~] **9.2** Responsive layout — _layout is responsive; portrait-stack / landscape-column / bottom-sheet behaviours not explicitly verified._
- [ ] **9.3** Accessibility — high-contrast mode, screen-reader labels
- [ ] **9.4** Performance — sprite batching, lazy terrain rendering, **debounced save**, and code-splitting the ~560 kB bundle

---

## Phase 10 — Remaining Work (consolidated backlog)

Ordered roughly by value-to-effort. Each item references the phase it completes.

### Gameplay correctness
- [x] **Ship base collision avoidance.** `Unit` now carries `baseWidth`/`baseLength` (mm, editable in `UnitFormModal`, defaulted by `migrateSavedGame` at `schemaVersion` 2). `suggestMovement` rejects any plan whose oriented base would intersect another ship's base along the swept path (waypoint poses from `applyMovementPlan`), via `baseCorners` + SAT `polygonsIntersect` in `geometry.ts`. Falls back to the full plan set only if every plan collides (already boxed in).
- [x] **10.1 Attitude scoring (6.1).** `scoreAttitude(unit)` now rewards ending on a fast point of sail, derived from the ship's own `speedProfile` (normalised to its best attitude) with the canonical `quarter_reaching > running > reaching > beating > in_irons` order as a flat-profile fallback, and wired into `evaluatePosition`. The reward is deliberately small (`ATTITUDE_WEIGHT = 20`) so it only breaks ties in favour of speed — a slower end-of-turn attitude can still win when it sets up a better position next turn (carried by the positional scores + 2-ply lookahead), including deliberately turning into irons to switch tack.
- [x] **10.2 Grapple relationship + link (4.4).** `Unit` carries a mutual `grappledWith: string | null` (defaulted by `migrateSavedGame`, `schemaVersion` 3). The pure helpers in `src/game/grapple.ts` (`applyGrapple` / `clearGrappleForRemoved`) keep both sides + statuses in sync — detaching a prior partner before re-linking, restoring `active` only when the status was `grappled`, and freeing a partner when a unit is deleted — and the store's `setGrapple`/`removeUnit` delegate to them. The canvas draws an amber link line between grappled pairs (beneath the ship icons), and the selected-unit panel shows the partner with Grapple-with / Release controls. Covered by `grapple.test.ts`.
- [x] **10.3 Aggressive grapple/boarding behaviour (CLAUDE.md spec).** Grapple proximity is now measured base-edge-to-base-edge (`baseGap` / `basesWithinGrapple` via `polygonDistance`), since centre-to-centre ≤20 mm is unreachable once bases are accounted for; the aggressive scoring rewards closing to within that gap. `decideAggressiveAction` declares a `grapple` when a plan lands within reach of an enemy, or a `board` when already grappled to one (stored as `Unit.hiddenAIAction`, `schemaVersion` 4). `revealOrders` computes it and the reveal panel surfaces it (grappled AI units now appear there) — this is a **suggestion only**, communicated like the fire intent. It is **not** auto-applied: `resolveTurn` just clears the suggestion, and the player confirms an actual grapple via the unit-panel grapple control (10.2). Covered by `ai.test.ts` / `geometry.test.ts`.
- [x] **10.4 Per-attitude min speed (5.2).** Resolved: the `prevMoveDistance/2` model is **not** a simplification — it is the actual game rule ("the next turn's min distance will be half of what they have moved this time", CLAUDE.md). `SpeedRange` stays `{ max }`; there is no separate per-attitude static `min`. No code change.

### UI / flow
- [ ] **10.5 Difficulty slider (6.4).** Expose the existing `difficulty` parameter as a UI control (per-game or per-unit) instead of the hardcoded `1`.
- [~] **10.6 Save/load completeness (7.5).** Debounced auto-save on state change; JSON export (download / `navigator.share()`); JSON import via file picker. _Done: saves now carry a `schemaVersion` and all legacy-format normalisation is centralised in `src/stores/migrations.ts` (`migrateSavedGame` + `CURRENT_SCHEMA_VERSION`). Still open: auto-save, export, import._
- [ ] **10.7 Save-on-exit prompt (1.2).** "Save & Exit" / "Exit Without Saving" when `hasUnsavedChanges`.
- [ ] **10.8 Pre-movement status step (7.3).** Optional explicit phase to apply grapple/immobilise/destroy/surrender before movement resolves.

### Combat (stretch)
- [ ] **10.9 Full firing-arc visualization (8.1).** When a unit is selected, draw all its arcs, coloured by whether an enemy is in range.
- [ ] **10.10 Combat resolution (8.2).** Optional automated damage/target selection feeding status changes.

### Polish / mobile (9.x)
- [~] **10.11 Pinch-to-zoom & long-press context menu (9.1).** _Pan/zoom done in Phase 12; long-press context menu still open._
- [ ] **10.12 Responsive portrait/landscape + bottom-sheet panels (9.2).**
- [~] **10.13 Accessibility (9.3)** — high-contrast mode still open; the `Select` control ships full keyboard support and listbox ARIA (Phase 13).
- [ ] **10.14 Performance (9.4)** — code-split the ~560 kB bundle, sprite batching, lazy terrain rendering, debounced save.

### Code health
- [x] **10.15 De-duplicate geometry helpers.** `distance`, `headingDeg`, `angleBetweenPoints`, `relativeAngle`, `inArc`, and an `isRakingAngle()` helper now live in `src/utils/geometry.ts`; `ai.ts` and `combat.ts` import from it. The bow/stern raking arc angles are no longer inlined — `isRakingAngle` derives them from `arcSideToAngles`, so every arc angle (`326.25/33.75`, `146.25/213.75`, …) lives only in `arcSideToAngles` in `types/index.ts`.
- [x] **10.16 Tests.** Vitest suite added (`npm test` / `npm run test:watch`) covering the pure logic: `attitude.test.ts` (band boundaries, wrap-around, tack symmetry), `movement.test.ts` (chunking, turn-point penalty, heading vector, straight/clamped/turning moves, `distanceTraveled`, in-irons drift split over 5 chunks, plan enumeration limits), and `ai.test.ts` (style-based distance scoring, can't-act → null, valid 5-chunk plans, immobilised stays put). 21 tests. _Remaining: component/UI tests are still absent (the ad-hoc `debug_ai.ts` / `test_defensive.ts` scratch scripts were removed earlier)._

---

## Phase 11 — Infinite Table

A model change rather than a feature: the table has no edges and no fixed size, and coordinates are anchored to an entity instead of a table corner.

- [x] **11.1 Unbounded movement (5.5).** `applyMovementPlan` lost its `tableWidth`/`tableHeight` arguments, the per-chunk clamping and `hitBoundary`. Positions are free to go negative or run arbitrarily far. `suggestMovement`, `evaluatePosition` and `decideAggressiveAction` lost the same arguments.
- [x] **11.2 Origin-relative coordinates.** `GameState.originId` names the unit or terrain piece the coordinate system hangs off — set to the first entity added, re-pointable from the unit/terrain panels, and reassigned only when that entity is **deleted** (a destroyed or surrendered ship is still a model on the table). World coordinates stay in an arbitrary frame (+x = East, +y = South); `src/utils/coordinates.ts` converts to and from compass offsets for every readout and input. The origin entity reads `origin` (0, 0) however far it sails.
- [x] **11.3 Placement reference points.** Terrain is placed by its centre; a unit by the **middle of its base's rear edge**, which is where a ruler meets a model. `Unit.position` still stores the base centre — every geometry routine (bases, arcs, collisions) is unchanged — with `sternMidpoint`/`centerFromSternMidpoint` converting at the form boundary, so changing a ship's orientation pivots it about its stern.
- [x] **11.4 Disengagement leash (6.1).** `scoreEdgeProximity`, `scoreHeadingTowardEdge`, `BOUNDARY_PENALTY` and `FUTURE_BOUNDARY_PENALTY` are gone, replaced by `scoreDisengagementLeash`: beyond `1.5 ×` the longest gun range either the unit or its nearest enemy brings (floored at 400mm), further withdrawal costs `0.5` per mm. A defensive unit holds station at the edge of usefulness and works its way back in from outside it, which is what the table edge used to enforce. Covered by multi-turn convergence tests in `ai.test.ts`.
- [x] **11.5 Terrain primitives (3.3).** `TableTerrain` is now `{ center, shape }` with `shape` one of circle / ellipse / rectangle plus size and a 32-point rotation, entered in `TerrainFormModal`. `terrainPolygon()` discretises a piece once (cached per object in `ai.ts`) so all the polygon maths — containment, edge distance, rendering — keeps a single code path. Vertex tracing and its whole canvas editing mode are gone.
- [x] **11.6 Photo capture removed.** `PhotoCapture.tsx` and `GameState.backgroundImage` deleted: with no edges to align to and no outlines to trace, a photograph has nothing left to anchor. `TableSetup.tsx` → `GameSetup.tsx`, wind direction only.
- [x] **11.7 Content-fitting viewport.** With no table rectangle to frame, `GameCanvas` computes its viewport from what is actually in play — ship bases, terrain outlines, previewed movement paths and the origin — with a minimum span so a lone ship isn't magnified absurdly. The grid is anchored on the origin and coarsens through 50 → 5000mm as the view zooms out, with a crosshair marking (0, 0).
- [x] **11.8 Save migration (schema 5).** `migrateSavedGame` drops `tableWidth`/`tableHeight`/`backgroundImage`, adopts the first unit (else the first terrain piece) as `originId`, and converts each traced polygon to its bounding rectangle. World coordinates are left untouched, so nothing moves on the table — only the frame the readouts use changes.

---

## Phase 12 — Movement Feedback, View Control & Wind Fixes

- [x] **12.1 In-irons drift ran across the wind (bug).** Drift was computed 8 points from the wind rather than 16, so a ship in irons crabbed 90° sideways instead of falling downwind — in `applyMovementPlan`, `computeAIFirePlan`, the AI's lookahead projections and the canvas ghost path alike. All four now call a single `driftVector(windDirection)` helper, and the canvas wind arrow is written via `windTowardPoint` so it can't be confused with the old form. Regression-tested across all four cardinal winds.
- [x] **12.2 Min/max on the movement panel (5.2).** `PlayerMovementPanel` shows the legal distance band for the order being written: the minimum (half of last turn's distance, or half the maximum for a ship that has yet to move), and the maximum recomputed live as turn points are added, at 5% off per point. Out-of-range totals are flagged, `min`/`max` shortcuts fill the field, and a plan whose turn points drop the ceiling below the floor says so explicitly.
- [x] **12.3 First-turn minimum (rules).** `Unit.prevMoveDistance` is now `number | null`; `null` means no movement phase has resolved, which `minMoveDistance()` reads as "half the maximum". The helper is shared by the panel and `enumerateMovementPlans`, so the player and the AI are held to the same floor. Schema 6; pre-6 saves keep their stored number rather than gaining the rule mid-game.
- [x] **12.4 Pan and zoom (9.1 / 10.11).** Drag empty water to pan, wheel/trackpad or pinch to zoom about the cursor, plus on-screen +/−/Fit controls. The view starts out following the content and switches to manual on the first gesture until **Fit** is pressed. Dragging from a ship or terrain piece still selects or moves it rather than panning, and a drag past the movement threshold suppresses the deselect that a tap would have caused.
- [x] **12.5 Viewport extracted (code health).** The viewport model — `Viewport`, `contentPoints`, `computeViewport`, `toScreen`/`toWorld`, `panViewport`, `zoomViewport` — moved out of `GameCanvas` into `src/utils/viewport.ts`, where it is unit-tested (anchor pinning, clamping, auto-fit framing). The auto-fit result is also memoised per render pass; it used to be recomputed over all content once per point drawn.

---

## Phase 13 — Dropdowns That Open Where You Tapped

- [x] **13.1 Custom `Select` (9.1).** On mobile, a native `<select>` hands its popup to the OS: a bottom sheet on iOS, a centred dialog on Android, and — inside a `transform`ed ancestor (the terrain context menu) or an `overflow` scroll container (the side rail, both modals) — sometimes anchored nowhere near the control. `src/components/Select.tsx` renders its list into a `document.body` portal positioned from the trigger's `getBoundingClientRect()`, which already accounts for ancestor transforms and cannot be clipped by an ancestor's overflow. It flips above the trigger when room below is short, follows the trigger through scroll and resize (capture-phase listener, so inner panels count), closes on outside press or Escape, and supports arrow/Home/End/Enter/Escape with `listbox`/`option` roles. All seven native selects are replaced.
- [x] **13.2 Positioning extracted (code health).** `computeDropdownPosition` lives in `src/utils/dropdownPosition.ts` taking the viewport size as a parameter, so flipping, height capping and horizontal clamping are unit-tested without a DOM.
- [x] **13.3 Terrain styles extracted.** `TERRAIN_COLORS` / `TERRAIN_TYPES` / `TERRAIN_TYPE_OPTIONS` moved from `TerrainPanel.tsx` to `src/utils/terrainStyles.ts`; three components were importing constants from a component module.

---

## Phase 14 — Corrected Attitude Bands & Rig Types

CLAUDE.md's attitude bands were corrected: a square rig is in irons out to **5** points off the wind and only beats from 6, where the old single band had it beating from 5. Fore-and-aft rigged ships keep the old, higher-pointing boundary.

- [x] **14.1 Rig-dependent bands (5.1).** `computeAttitude(wind, orientation, foreAndAftRigged)` now takes the rig; `inIronsLimit()` and `pointsOffWind()` are split out so the boundary lives in one place. The parameter is **required**, not defaulted, so the compiler flagged all thirteen call sites rather than letting any silently keep the old bands. This also resolves the attitude report from Phase 12: a square-rigged ship heading NWbN with the wind blowing toward E is 5 points off, and is now correctly in irons.
- [x] **14.2 `Unit.foreAndAftRigged` (2.1 / 4.1).** New boolean, edited as a Square / Fore & Aft toggle in `UnitFormModal` (with the resulting boundary spelled out under it), defaulted to square by `migrateSavedGame` at `schemaVersion` 7 — square rig is both the age-of-sail default and what the old single set of bands described.
- [x] **14.3 In-irons swing follows the same boundary.** `getInIronsTurnDirection` branched on a hardcoded 5–7 beating band, and `combat.ts` held a second inlined copy of it. Both now use the shared rig-aware helper exported from `movement.ts`, with a test asserting the two agree with `computeAttitude` across every wind/heading/rig combination — the duplicate would otherwise have diverged the moment the boundary moved.

---

## Phase 15 — The Tacking Procedure

CLAUDE.md now spells out tacking as a committed procedure rather than a one-off "voluntary in irons" move, and the old implementation did not match it on any point.

- [x] **15.1 Remembered swing direction.** `Unit.tackDirection` records which way a ship is coming about. It cannot be inferred: a ship lying head to wind could have got there from either tack, and the old `getInIronsTurnDirection` guessed from the geometry — sending ships back the way they came. That helper is gone, along with the second copy of it inlined in `combat.ts`. `schemaVersion` 8; a pre-8 save caught mid-tack has the direction derived from its heading.
- [x] **15.2 Eligibility.** `canTack(unit, prevAttitude)` requires an active ship, not already in irons, beating at both ends of the previous turn. The old code checked only the start of it, and then turned the ship the *wrong way* — `oppDir` of the (already wrong) inferred direction bore away from the wind instead of luffing up into it, so the "voluntary in irons" plan could not have put a ship in irons at all.
- [x] **15.3 Committed swing, capped at the new tack.** `buildTackPlan` spends every available turn point swinging toward the wind, split across at most two turns, and `tackPointsThisTurn` stops the swing the moment the ship comes onto the new tack so it cannot overshoot into a reach. The old in-irons handling turned `ceil(maxTurnPoints / 2)` *per chunk* — five times a turn — and only exited on landing exactly in the beating band, so a ship that jumped over it swung for ever.
- [x] **15.4 No way on, drifting throughout.** `MovementPlan.isTack` marks the order, so the ship drifts from the first chunk of the turn it declares the tack — when it is still technically beating — rather than only once the attitude flips. Honoured by resolution, fire simulation, the ghost path and the auto-fit viewport alike. The plan now carries the turns in every case, so there is no separate in-irons swing anywhere.
- [x] **15.5 No choice mid-tack.** `enumerateMovementPlans` returns exactly one plan for a ship in irons, and filters out any ordinary order that would leave a ship in irons, since turning up into the wind is only legal through the procedure. `resolveTurn` falls back to the continuation when a mid-tack ship has no order, so the rule holds even if the panel never rendered.
- [x] **15.8 Drift tracks are dashed (8.1).** A planned move is drawn solid when the ship is under way and dashed when she is only drifting — in irons or on a declared tack — so the two read apart at a glance. PixiJS strokes are solid, so `src/utils/dashedPath.ts` walks the dashes out along the polyline, carrying each dash's remainder across corners so the pattern stays even as the track bends; unit-tested.
- [x] **15.6 Declare-tack button (7.3).** `PlayerMovementPanel` offers a one-press **Declare tack** when eligible, filling in the whole plan; mid-tack it locks the editor, states the swing and drift, and writes the forced continuation in automatically.

- [x] **15.7 Tacking as an AI choice (6.1).** `scoreTack` judges a declared tack by the pose it ends in rather than the turn it starts, since the latter is always among the worst plans available. `projectTackCompletion` runs the procedure out to the new tack; the reward is broadside guns that would bear on an enemy at short range (more inside the close tier, more again for a rake), with the enemy carried forward the same number of turns at cruising speed. It is discounted `0.5` per turn the tack takes, vetoed if the drift ends on terrain, and cut to a quarter for a defensive ship. This closes the gap left when the procedure landed.

---

## Phase 16 — Reloading Per Arc

- [x] **16.1 Ships stopped firing altogether (bug).** `revealOrders` carried `lastFireChunk` forward whenever a ship did not fire (`firePlan?.chunkIndex ?? u.lastFireChunk`), so the value never cleared. A ship that once fired on chunk 4 was pinned to chunk 4 for the rest of the game, and went silent as soon as nothing bore on that one chunk. Only the arc that fires is now left reloading; everything else is loaded again, which is what a full turn's reload actually buys.
- [x] **16.2 Reloading is per arc (8.2).** `Unit.lastFireChunk: number | null` becomes `lastFireChunks: Partial<Record<ArcSide, number>>`, and the reload check moved from a ship-wide guard at the top of the chunk loop into `bestArcSide`, where it applies to the arc being considered. A starboard broadside fired on chunk 2 no longer silences the port guns. `schemaVersion` 9; the old field did not record which arc had fired, so it cannot be carried over and every arc starts loaded.
- [x] **16.3 Reveal panel names the arcs.** "Reloading (fired at chunk N last turn)" becomes a per-arc list — "Reloading: Starboard until chunk 3".
- [x] **16.4 Tests for `combat.ts`.** The module had none, which is how 16.1 survived. `combat.test.ts` covers bearing, range, arc choice by weight, own-side and out-of-the-fight targets, and the reload rules; `gameStore.test.ts` covers the clearing behaviour across turns.

---

## Dependency Graph (Parallel Tracks)

```
Phase 0 (Scaffolding) ✅
    │
    ├──► Phase 1 (Main Menu) ✅
    │
    ├──► Phase 2 (Data Model) ✅
    │        │
    │        ├──► Phase 3 (Table Setup) ✅ ──► Phase 4 (Units) ✅~ ──► Phase 7 (Game Flow) ✅~
    │        │
    │        └──► Phase 5 (Movement) ✅ ──► Phase 6 (AI) ✅~ ──► Phase 7
    │                                                        │
    Phase 8 (Combat) ◄───────────────────────────────────────┘  (partial)
    │
    Phase 9 (Polish) — in progress
```

- **Track A** (UI-heavy): Phase 0 → 1 → 2 → 3 → 4 → 7  — _done; remaining polish in Phase 10._
- **Track C** (model change): Phase 11 — _done; touches Phases 2, 3, 5, 6 and 7._
- **Track D** (feedback & view): Phase 12 — _done; touches Phases 5, 7 and 9._
- **Track B** (Logic-heavy): Phase 0 → 2 → 5 → 6 → 7  — _done._

---

## Milestones

| # | Goal | Covers | Status |
|---|------|--------|--------|
| 1 — Main Menu | Menu lists saves; new/load/delete | 0.1–0.4, 1.1–1.3, 2.1 | ✅ |
| 2 — Hello, Table | Wind, terrain primitives on canvas | 3.1, 3.3, 3.4 | ✅ (reshaped by Phase 11) |
| 3 — Units on the Board | Place units, orient, render as ships | 2.2, 4.1–4.3 | ✅ |
| 4 — Moving Ships | AI suggests, previews, applies a valid move | 5.1–5.7, 6.1–6.3, 7.2–7.4 | ✅ |
| 5 — Full Game Loop | Turns, status changes, save/load, all styles | 7.1, 7.5, 4.4, 6.4 | 🟡 export/import + auto-save (10.6), difficulty UI (10.5), grapple (10.2–10.3) |
| 6 — Production Quality | Tablet polish, touch, performance | 9.1–9.4, Phase 8 | 🟡 see 10.9–10.14 |
