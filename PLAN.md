# Implementation Plan — Wargame AI

> **Status as of 2026-06-16.** This plan has been reconciled with the code actually on `main`.
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
| Camera / image | `getUserMedia` + canvas | ✅ `getUserMedia` + hand-rolled homography | `PhotoCapture.tsx` |
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
  - `SpeedRange` is `{ max }` only — **no per-attitude `min`** (see 5.2).
  - `Unit` carries extra runtime fields not in the sketch: `driftSpeed`, `isInIrons`, `prevAttitude`, `prevMoveDistance`, `hiddenAIOrder`, `playerOrder`, `lastFireChunk`, `hiddenAIFirePlan`.
  - `WindDirection` is a plain `number` (0–31) on `GameState.windDirection`, not a named type.
- [x] **2.2** Zustand store (`useGameStore`) — CRUD for units/terrain, wind get/set, turn management, `persist`

---

## Phase 3 — Table Setup & Terrain Editor

- [x] **3.1** Table creation screen (`TableSetup.tsx`) — dimensions + compass wind picker
- [x] **3.2** Photo capture flow (`PhotoCapture.tsx`) — `getUserMedia`, 4-corner drag, perspective **homography** undistortion, stored as data URL
- [x] **3.3** Terrain polygon editor (`TerrainPanel.tsx` + canvas) — place/drag/delete vertices, type island/shoal/reef, terrain list
- [x] **3.4** PixiJS table canvas (`GameCanvas.tsx`) — background photo, grid overlay, coloured terrain polygons

---

## Phase 4 — Unit Management

- [~] **4.1** Unit creation panel (`UnitFormModal.tsx`) — name, side, AI style, max turn points, firing arcs editor. _Deviation: arcs are edited by side + maxRange + weapon count; speed is a per-attitude `max` profile (+ `driftSpeed`) rather than a single min/max speed pair._
- [x] **4.2** Placement mode — click to place, orientation control, ship icon at correct heading
- [x] **4.3** Unit interaction — select, drag, rotate, context menu / form to change status / style / delete, name label
- [~] **4.4** Unit status management — _status colours implemented (active/immobilised/destroyed/surrendered/grappled). **Grapple link line between units is NOT drawn**, and there is no "grappled-by" relationship (see Phase 10)._

---

## Phase 5 — Core Movement Logic (`src/game/movement.ts`, `src/utils/attitude.ts`)

- [x] **5.1** `computeAttitude(windDirection, orientation)` — modulo wrap-around, points-from-bow mapping
- [~] **5.2** `getSpeedRangeForAttitude(...)` — _implemented, but `SpeedRange` is `{ max }` only; no `min` per attitude. The minimum move each turn is derived purely from `prevMoveDistance / 2`._
- [x] **5.3** `computeEffectiveMaxSpeed(baseMaxSpeed, turnPoints)` — 5% penalty per turn point
- [x] **5.4** `splitMovement(distance)` — 5 whole chunks, larger first
- [x] **5.5** `applyMovementPlan(...)` — walks 5 chunks, per-chunk edge clamping, returns position/orientation/attitude/isInIrons/hitBoundary/**distanceTraveled**/path
- [x] **5.6** Voluntary in-irons rule — drift downwind, keep turning until beating on the other tack (in `enumerateMovementPlans` + `applyMovementPlan`). _`driftSpeed` is the **total drift per turn**; per-chunk loops apply `driftSpeed / 5` and full-turn projections apply `driftSpeed`. This is applied consistently across resolution (`movement.ts`), fire simulation (`combat.ts`), the ghost-path preview (`GameCanvas.tsx`), and AI lookahead (`ai.ts`)._
- [x] **5.7** `enumerateMovementPlans(...)` — brute-forces distances × 1–2 turns at any chunk boundary, plus in-irons / voluntary-in-irons plans

---

## Phase 6 — AI Decision System (`src/game/ai.ts`)

- [~] **6.1** `evaluatePosition(...)` — distance-to-enemy, broadside/raking arcs, firing range, edge penalty, terrain proximity, enemy-broadside danger. _Gap: **attitude is not scored** — `scoreAttitude()` is a `return 0` stub, so the AI gets no reward for ending on a fast point of sail._
- [x] **6.2** Style-specific scoring modifiers — aggressive / cautious / defensive (`scoreDistanceByStyle`, `scoreStyleSpecific`)
- [x] **6.3** `suggestMovement(...)` — enumerate → simulate → score → select; includes a **2-ply lookahead** projecting own and enemy future positions
- [~] **6.4** Difficulty / randomness — _`selectPlan()` fully supports a `difficulty` param (random ↔ noisy ↔ best), but it is hardcoded to `1` at both call sites and there is **no UI control**._

---

## Phase 7 — Game Flow & UI

- [x] **7.1** Turn manager in the store — phases `setup | orders | reveal | resolve | game_over`, `currentTurn`, hidden AI orders, `actionLog`
- [x] **7.2** Main game screen (`GameView.tsx`) — top bar (turn / phase / wind), unit sidebar, Pixi canvas, selected-unit panel
- [~] **7.3** Orders phase — _AI computes hidden orders; reveal shows ghost ships + order breakdown (`PlayerMovementPanel.tsx`); resolve applies simultaneously. Status changes (grapple/immobilise/destroy/surrender) are applied manually via the unit form rather than as an explicit pre-movement step._
- [x] **7.4** AI turn flow — hidden orders computed on `startGame`/`resolveTurn`, previewed on reveal, applied on resolve
- [~] **7.5** Game save / load — _manual save to localStorage works. **Missing: auto-save on change, JSON export/import, and `navigator.share()`.**_

---

## Phase 8 — Firing & Combat

- [~] **8.1** Firing arc visualization — _the AI's chosen fire arc is drawn on reveal (`GameCanvas.tsx`). General "draw all of a selected unit's arcs, green if enemy in range / red otherwise" is not implemented._
- [~] **8.2** Combat resolution — _AI fire-plan computation (`computeAIFirePlan`, `checkFiringArc` in `src/game/combat.ts`) chunk-simulates both ships to find the first firing solution. **No damage/destruction automation** — outcomes (destroy/surrender/immobilise) are applied manually._

---

## Phase 9 — Polish & Mobile Optimisation

- [~] **9.1** Touch interactions — _tap-to-select and drag-to-move work; **pinch-to-zoom and long-press context menu are not implemented**; verify 44×44px tap targets._
- [~] **9.2** Responsive layout — _layout is responsive; portrait-stack / landscape-column / bottom-sheet behaviours not explicitly verified._
- [ ] **9.3** Accessibility — high-contrast mode, screen-reader labels
- [ ] **9.4** Performance — sprite batching, lazy terrain rendering, **debounced save**, and code-splitting the ~560 kB bundle

---

## Phase 10 — Remaining Work (consolidated backlog)

Ordered roughly by value-to-effort. Each item references the phase it completes.

### Gameplay correctness
- [ ] **10.1 Attitude scoring (6.1).** Reward ending on a fast point of sail so the AI uses the wind. Reintroduce an attitude-rank table and wire it into `evaluatePosition` (the `scoreAttitude()` stub currently returns 0). _Highest-value logic gap._
- [ ] **10.2 Grapple relationship + link (4.4).** Add a "grappled-by" reference on `Unit`, draw a connecting line on the canvas between grappled units, and surface grapple in the unit panel.
- [ ] **10.3 Aggressive grapple/boarding behaviour (CLAUDE.md spec).** Let an aggressive AI close to ≤20 mm to grapple, and take a boarding action when already grappled (today grappled units simply freeze — `suggestMovement` returns `null`).
- [ ] **10.4 Per-attitude min speed (5.2).** Decide whether to extend `SpeedRange` to `{ min, max }` per attitude, or keep the simplified `prevMoveDistance/2` model and update CLAUDE.md/this plan to match. (Currently simplified.)

### UI / flow
- [ ] **10.5 Difficulty slider (6.4).** Expose the existing `difficulty` parameter as a UI control (per-game or per-unit) instead of the hardcoded `1`.
- [~] **10.6 Save/load completeness (7.5).** Debounced auto-save on state change; JSON export (download / `navigator.share()`); JSON import via file picker. _Done: saves now carry a `schemaVersion` and all legacy-format normalisation is centralised in `src/stores/migrations.ts` (`migrateSavedGame` + `CURRENT_SCHEMA_VERSION`). Still open: auto-save, export, import._
- [ ] **10.7 Save-on-exit prompt (1.2).** "Save & Exit" / "Exit Without Saving" when `hasUnsavedChanges`.
- [ ] **10.8 Pre-movement status step (7.3).** Optional explicit phase to apply grapple/immobilise/destroy/surrender before movement resolves.

### Combat (stretch)
- [ ] **10.9 Full firing-arc visualization (8.1).** When a unit is selected, draw all its arcs, coloured by whether an enemy is in range.
- [ ] **10.10 Combat resolution (8.2).** Optional automated damage/target selection feeding status changes.

### Polish / mobile (9.x)
- [ ] **10.11 Pinch-to-zoom & long-press context menu (9.1).**
- [ ] **10.12 Responsive portrait/landscape + bottom-sheet panels (9.2).**
- [ ] **10.13 Accessibility (9.3)** — high-contrast mode, ARIA labels.
- [ ] **10.14 Performance (9.4)** — code-split the ~560 kB bundle, sprite batching, lazy terrain rendering, debounced save.

### Code health
- [x] **10.15 De-duplicate geometry helpers.** `distance`, `headingDeg`, `angleBetweenPoints`, `relativeAngle`, `inArc`, and an `isRakingAngle()` helper now live in `src/utils/geometry.ts`; `ai.ts` and `combat.ts` import from it. The bow/stern raking arc angles are no longer inlined — `isRakingAngle` derives them from `arcSideToAngles`, so every arc angle (`326.25/33.75`, `146.25/213.75`, …) lives only in `arcSideToAngles` in `types/index.ts`.
- [ ] **10.16 Tests.** Add a small Vitest suite for the pure logic (`movement.ts`, `attitude.ts`, `ai.ts`), especially attitude wrap-around, in-irons handling, and `distanceTraveled` clamping. (The old ad-hoc `debug_ai.ts` / `test_defensive.ts` scratch scripts were removed.)

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
- **Track B** (Logic-heavy): Phase 0 → 2 → 5 → 6 → 7  — _done; key gap is attitude scoring (10.1)._

---

## Milestones

| # | Goal | Covers | Status |
|---|------|--------|--------|
| 1 — Main Menu | Menu lists saves; new/load/delete | 0.1–0.4, 1.1–1.3, 2.1 | ✅ |
| 2 — Hello, Table | Dimensions, wind, terrain polygons on canvas | 3.1, 3.3, 3.4 | ✅ |
| 3 — Units on the Board | Place units, orient, render as ships | 2.2, 4.1–4.3 | ✅ |
| 4 — Moving Ships | AI suggests, previews, applies a valid move | 5.1–5.7, 6.1–6.3, 7.2–7.4 | ✅ (attitude scoring 10.1 outstanding) |
| 5 — Full Game Loop | Turns, status changes, save/load, all styles | 7.1, 7.5, 4.4, 6.4 | 🟡 export/import + auto-save (10.6), difficulty UI (10.5), grapple (10.2–10.3) |
| 6 — Production Quality | Tablet polish, touch, performance | 9.1–9.4, Phase 8 | 🟡 see 10.9–10.14 |
