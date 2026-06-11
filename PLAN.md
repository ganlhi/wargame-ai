# Implementation Plan — Wargame AI

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | React 19 + TypeScript | Latest stable, `use()` for async, built-in form actions, no reason to stay on 18 |
| Build tool | Vite | Fast HMR, ESM-native, good for mobile targets |
| State management | Zustand | Lightweight, no boilerplate, works outside React tree for game logic |
| Canvas / rendering | PixiJS (v8) | High-performance 2D rendering, needed for smooth map interaction on tablets |
| Persistence | localStorage via a thin wrapper | Full offline support, no server required |
| Camera / image | `getUserMedia` API + custom canvas processing | No extra deps for photo capture; simple undistortion via perspective transform (math) |
| Routing | React Router (if multi-page) or none (single-screen app) | The app is likely a single-page with modals/panels |
| Styling | Tailwind CSS | Rapid responsive design, good for tablet-sized screens |

---

## Phase 0 — Project Scaffolding

- [ ] **0.1** Initialize Vite + React + TypeScript project
- [ ] **0.2** Install and configure Tailwind CSS
- [ ] **0.3** Install Zustand, PixiJS v8, and a couple of small utility libs (uuid, etc.)
- [ ] **0.4** Set up ESLint, Prettier, and basic project folder structure:

```
src/
  components/       # React components
  game/             # Pure game logic (movement, AI, detection)
  stores/           # Zustand stores
  types/            # TypeScript types / interfaces
  utils/            # Helper functions
  hooks/            # Custom React hooks
  assets/           # Static assets (icons, sprites)
```

- [ ] **0.5** Create a basic App shell with responsive layout (sidebar + canvas area) that works on tablet-sized screens (min 8")

---

## Phase 1 — Main Menu & Game Management

- [ ] **1.1** Build a main menu screen shown on app load:
  - List saved games showing name, last played date, unit count
  - "New Game" button → creates a fresh game and enters setup mode
  - Click a saved game → loads it and enters setup/game mode
  - Delete button on each save with confirmation
  - Empty state illustration/text when no saves exist

- [ ] **1.2** Game navigation:
  - Back button / breadcrumb from setup/game view to main menu
  - Prompt to save on exit if unsaved changes exist
  - "Save & Exit" and "Exit Without Saving" options

- [ ] **1.3** Update the game store to support multiple games:
  - Store holds a list of saved games (id, name, createdAt, updatedAt)
  - Loading a game populates the full state from the save slot
  - Switch to a new route or screen state

---

## Phase 2 — Core Data Model & Types

- [ ] **2.1** Define all TypeScript interfaces in `src/types/`:

  - `TableTerrain` — polygon vertices, type (island, shoal, etc.)
  - `WindDirection` — integer 0–31 (points, 0 = North)
  - `FiringArc` — min/max angle relative to bow, max range in mm
  - `UnitStatus` — `active | grappled | immobilised | destroyed | surrendered`
  - `AIStyle` — `aggressive | cautious | defensive`
  - `Attitude` — `in_irons | beating | reaching | quarter_reaching | running`
  - `MoveChunk` — distance + optional turn (direction, points)
  - `MovementPlan` — array of 5 MoveChunks, total turn points, effective speed
  - `Unit` — id, name, side (`player | ai`), position (x,y), orientation (points 0-31), status, AI style, max turn points, min/max speed, firing arcs, attitude
  - `GameState` — table dimensions, terrain list, wind direction, units list, current turn, phase

- [ ] **2.2** Create a Zustand store (`useGameStore`) with actions:
  - CRUD for units
  - CRUD for terrain
  - Wind direction get/set
  - Turn management
  - Persistence to localStorage (Zustand middleware `persist`)

---

## Phase 3 — Table Setup & Terrain Editor

- [ ] **3.1** Build a table creation wizard / screen:
  - Set table dimensions (width, height in mm / cm)
  - Choose wind direction (compass-like picker)

- [ ] **3.2** Implement photo capture flow:
  - Open device camera via `getUserMedia` in a modal
  - Snap photo and display as overlay on the table
  - Apply a perspective transform (4-corner drag) to undistort the image into a rectangle matching table dimensions
  - Store the undistorted image as a `data:` URL or blob URL for background rendering

- [ ] **3.3** Build terrain polygon editor:
  - Click to place vertices on the table image
  - Drag vertices to refine
  - Support delete vertex, close polygon, mark as island/shoal/reef
  - Show terrain list with delete button for each

- [ ] **3.4** Render the table canvas with PixiJS:
  - Background: the undistorted photo (semi-transparent grid overlay)
  - Terrain polygons rendered as filled shapes with different colours per type

---

## Phase 4 — Unit Management

- [ ] **4.1** Build a unit creation panel:
  - Unit name (text input)
  - Side toggle: Player / AI
  - AI style dropdown (only when AI)
  - Max turn points (number input, default 6)
  - Min speed, max speed (mm per turn)
  - Firing arcs editor: add/remove arcs, set min angle, max angle, max range

- [ ] **4.2** Placement mode:
  - Click on the table canvas to place the unit
  - Orientation compass: a draggable indicator or left/right buttons to rotate (32 points)
  - Display unit as a ship icon (simple triangle/arrow shape) at the correct orientation

- [ ] **4.3** Unit interaction on the canvas:
  - Click unit to select it → show info panel
  - Drag unit to reposition
  - Rotation handles (or buttons in info panel) to change orientation
  - Context menu or info panel to change status, AI style, or delete unit
  - Show unit label (name) near the unit icon

- [ ] **4.4** Unit status management:
  - Visual indicators for status (coloured border / overlay): green=active, orange=immobilised, red=destroyed, grey=surrendered, chain=grappled
  - Grapple link: draw a line between grappled units

---

## Phase 5 — Core Movement Logic (Pure Functions)

- [ ] **5.1** Implement wind/attitude calculation:

  ```
  computeAttitude(shipOrientation: 0-31, windAngle: 0-31): Attitude
  ```

  Map orientation relative to wind to the attitude table (points 0-16 relative to bow). Use modulo arithmetic to handle wrap-around.

- [ ] **5.2** Implement per-ship speed preferences per attitude:

  ```
  getSpeedRangeForAttitude(attitude: Attitude, shipSpeedProfile: Record<Attitude, { min: number, max: number }>): { min: number, max: number }
  ```

  Each ship defines its own speed range for each attitude (added to the Unit type). Values are not exact — they're a fuzzy guide for the AI to rank attitudes relatively. The general ranking across most ships: quarter_reaching > running > reaching > beating > in_irons (drift only, no forward speed).

- [ ] **5.3** Implement turn-point speed penalty:

  ```
  computeEffectiveMaxSpeed(baseMaxSpeed: number, turnPoints: number): number
  ```

  Each turn point reduces speed by 5%. So `effectiveMax = baseMax * (1 - turnPoints * 0.05)`.

- [ ] **5.4** Implement movement chunking:

  ```
  splitMovement(distance: number): [number, number, number, number, number]
  ```

  Split into 5 whole-number chunks as evenly as possible, with larger chunks first. E.g., 167 → `[34, 34, 33, 33, 33]`.

- [ ] **5.5** Implement position / orientation update:

  ```
  applyMovementPlan(unit: Unit, plan: MovementPlan, windAngle: number): { newPosition, newOrientation, newAttitude }
  ```

  Walk through 5 chunks, applying each straight movement + any turn at the end of the chunk (max 2 turns). Return final state.

- [ ] **5.6** Implement voluntary in-irons rule:
  - Detect if ship spent previous turn entirely in beating attitude
  - Allow turning into the wind (toward in-irons) using max turn points
  - While in irons: no forward movement, drift downwind
  - Continue turning same direction each turn until beating again on other side

- [ ] **5.7** Generate all valid movement plans for a unit:

  ```
  enumerateMovementPlans(unit: Unit, windAngle: number): MovementPlan[]
  ```

  Brute-force over valid distances (min..max in reasonable increments) and valid turn combinations (0..maxTurnPoints, split into 0, 1, or 2 turns at any chunk boundary). This will feed the AI evaluation.

---

## Phase 6 — AI Decision System

- [ ] **6.1** Implement scoring functions for positions:

  ```
  evaluatePosition(unit: Unit, allies: Unit[], enemies: Unit[], terrain: Terrain[], tableBounds: Rect): Score
  ```

  Factors:
  - Distance to nearest enemy
  - Angle to enemy (are they in broadside arc?)
  - Whether enemy is in firing range
  - Own attitude relative to wind
  - Distance to table edge (penalty for going off-table)
  - Proximity to terrain obstacles
  - Whether any enemy is in own broadside arc at good range

- [ ] **6.2** Implement style-specific scoring modifiers:

  - **Aggressive**: bonus for closing to < 20mm (grapple range), bonus for having broadside on enemy, bonus for raking fire (bow/stern of enemy), bonus near enemy
  - **Cautious**: bonus for medium range broadside, bonus for raking fire opportunity, penalty for too close without raking fire opportunity, penalty for too far
  - **Defensive**: bonus for long range, bonus for keeping enemies out of their own broadside arcs, bonus for open escape routes, penalty for being near enemies

- [ ] **6.3** Implement movement selection:

  ```
  suggestMovement(unit: Unit, allUnits: Unit[], terrain: Terrain[], windAngle: number): MovementPlan
  ```

  1. Enumerate all valid movement plans (5.7)
  2. For each plan, simulate the new position/orientation (5.5)
  3. Score the resulting position (6.1 + 6.2)
  4. Pick the highest-scoring plan
  5. Return the plan (for display / preview)

- [ ] **6.4** Build a difficulty / randomness slider:
  - At 100%: always pick the top-scoring plan
  - At lower %: add noise to scores or pick probabilistically among top-N plans

---

## Phase 7 — Game Flow & UI

- [ ] **7.1** Build a turn manager in the store:
  - `currentPhase`: `setup | orders | reveal | resolve | game_over`
  - `currentTurn`: number
  - AI orders are computed silently during `orders` and stored hidden
  - Action log: array of { turn, unitId, action, details }

- [ ] **7.2** Build the main game screen:
  - Top bar: turn number, phase indicator, wind direction (with compass icon)
  - Left sidebar: unit list expandable with status icons, click to focus camera
  - Centre: PixiJS canvas (table view)
  - Bottom or right panel: selected unit info / actions

- [ ] **7.3** Orders phase — player & AI plan simultaneously:
  - Turn starts → AI silently computes all its unit movements (6.3) based on current board state
  - Player sees "AI is thinking" briefly, then "Reveal AI orders" button appears
  - Player clicks reveal → AI plans shown: ghost ships on canvas + a detailed order card per AI unit (exact breakdown per chunk: distance, turn direction + points, cumulative position/orientation)
  - Player then declares their own units' movements (drag, position input, etc.)
  - Player clicks "Resolve turn" → all movements apply simultaneously
  - Status changes (grapple, immobilise, destroy, surrender) are applied before movement if relevant

- [ ] **7.4** AI turn flow (internal, during orders phase):
  - For each AI unit, compute movement suggestion (6.3) based on the board state at start of turn
  - Store suggestions as hidden AI orders
  - On reveal: show AI plans on canvas as preview, but do not apply yet
  - On resolve: apply all AI and player movements together

- [ ] **7.5** Game save / load:
  - Auto-save to localStorage on every state change
  - "Save as" / "Load" buttons with named save slots
  - Export game state as JSON file (download or use the Web Share API's `navigator.share()` to share the file to another app)
  - Import: file picker to load a saved JSON file

---

## Phase 8 — Firing & Combat (Stretch / Post-MVP)

- [ ] **8.1** Firing arc visualization:
  - When a unit is selected, draw its firing arcs on the canvas (cone shapes from the unit)
  - Colour arcs green if an enemy is in range, red otherwise

- [ ] **8.2** Combat resolution:
  - Manual: show which enemies are in firing arcs and let the player declare targets
  - Automated (optional): AI selects best target within its arcs

---

## Phase 9 — Polish & Mobile Optimisation

- [ ] **9.1** Touch interactions:
  - Pinch-to-zoom on the canvas
  - Tap to select, drag to move
  - Long-press for context menu
  - Ensure all buttons are large enough for finger taps (min 44x44px)

- [ ] **9.2** Responsive layout:
  - Portrait mode: sidebar stacks below canvas
  - Landscape mode: sidebar is a narrow left column
  - Bottom sheet panels for actions (slide up from bottom)

- [ ] **9.3** Accessibility:
  - High-contrast mode for table / terrain
  - Screen reader labels on interactive elements

- [ ] **9.4** Performance:
  - PixiJS sprite batching for units
  - Lazy terrain polygon rendering
  - Debounce save to localStorage

---

## Dependency Graph (Parallel Tracks)

```
Phase 0 (Scaffolding)
    │
    ├──► Phase 1 (Main Menu)
    │
    ├──► Phase 2 (Data Model)
    │        │
    │        ├──► Phase 3 (Table Setup) ——► Phase 4 (Units) ——► Phase 7 (Game Flow)
    │        │
    │        └──► Phase 5 (Movement Logic) ——► Phase 6 (AI) ——► Phase 7
    │                                                        │
    Phase 8 (Combat) ◄───────────────────────────────────────┘
    │
    Phase 9 (Polish) ——► Done
```

- **Track A** (UI-heavy): Phase 0 → 1 → 2 → 3 → 4 → 7
- **Track B** (Logic-heavy): Phase 0 → 2 → 5 → 6 → 7
- Phases 8 and 9 are optional / additive once the core loop works.

The two tracks can be worked on in parallel by different people after Phase 2 is complete. The game store is the shared interface.

---

## First Milestone: "Main Menu"

Goal: App loads to a main menu listing saved games, with new game / load / delete.

Covers: 0.1–0.4, 1.1–1.3, 2.1.

## Second Milestone: "Hello, Table"

Goal: Create a new game, set up table dimensions and wind, place terrain polygons on a canvas.

Covers: 3.1, 3.3, 3.4.

## Third Milestone: "Units on the Board"

Goal: Place units on the table, change their orientation, see them rendered as ship icons.

Covers: 2.2, 4.1–4.3.

## Fourth Milestone: "Moving Ships"

Goal: AI can suggest a valid movement for a unit, preview it, and apply it.

Covers: 5.1–5.7, 6.1–6.3, 7.2–7.4.

## Fifth Milestone: "Full Game Loop"

Goal: Complete game flow with turns, status changes, save/load (7.5), and all AI styles working correctly.

Covers: 7.1, 7.5, remaining 4.4, 6.4.

## Sixth Milestone: "Production Quality"

Goal: Polish for tablet usage, touch interactions, performance optimisation.

Covers: 9.1–9.4, and optionally Phase 8.
