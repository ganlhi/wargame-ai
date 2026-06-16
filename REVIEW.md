# Codebase Review — Wargame AI

_Review date: 2026-06-16. Compares the current `main` against `PLAN.md` and the product spec in `CLAUDE.md`._

## Summary

The project has advanced **well beyond the plan's "core loop" milestones**. Most of Phases 0–7 are implemented, plus meaningful chunks of the Phase 8 combat stretch goals. The movement model (chunking, turn penalties, attitude/point-of-sail, voluntary in-irons, drift) and the AI scoring system (style modifiers, 2-ply lookahead, edge/terrain avoidance) are substantially richer than the plan sketched.

However, there are **critical hygiene problems**: the project **does not compile** (`npm run build` fails), `package.json` is **out of sync** with what the build actually uses, and there are 17 lint errors plus two stray debug scripts committed at the repo root. A few spec features are also still missing (grapple links/boarding, attitude scoring, difficulty slider, JSON export/import).

---

## Milestone status

| Milestone | Plan coverage | Status |
|-----------|--------------|--------|
| 1 — Main Menu | 0.1–0.4, 1.1–1.3, 2.1 | ✅ Done (menu, create/load/delete, multi-game) |
| 2 — Hello, Table | 3.1, 3.3, 3.4 | ✅ Done (dimensions, wind, terrain editor, Pixi canvas) |
| 3 — Units on the Board | 2.2, 4.1–4.3 | ✅ Done (form modal, placement, orientation, icons) |
| 4 — Moving Ships | 5.1–5.7, 6.1–6.3, 7.2–7.4 | ✅ Mostly done (see gaps) |
| 5 — Full Game Loop | 7.1, 7.5, 4.4, 6.4 | 🟡 Partial (no export/import, no difficulty UI, no grapple link) |
| 6 — Production Quality | 9.1–9.4, Phase 8 | 🟡 Partial (some Phase 8 done; touch/perf polish unverified) |

---

## What's implemented (and notably good)

- **Photo capture + undistortion (3.2)** — `PhotoCapture.tsx` has a real `getUserMedia` flow and a hand-rolled **homography** (`computeHomography`/`applyHomography`) with 4-corner drag. This is the hardest item in the plan and it's actually built.
- **Movement logic (Phase 5)** — `movement.ts` covers chunking (`splitMovement`), the 5%/turn-point penalty (`computeEffectiveMaxSpeed`), attitude from wind (`utils/attitude.ts`), `applyMovementPlan` with boundary clamping + path tracing, and `enumerateMovementPlans` brute-forcing distances × 1–2 turns at any chunk boundary.
- **Voluntary in-irons rule (5.6)** — modelled in both `enumerateMovementPlans` (generates the "turn into wind from beating" plan) and `applyMovementPlan` (drift downwind, keep turning until beating on the other tack). This is a subtle rule and the attempt is faithful.
- **AI scoring (Phase 6)** — `ai.ts` has style-specific distance/firing scoring, raking detection, broadside-danger penalties, edge & terrain avoidance, and a **2-ply lookahead** projecting both own and enemy future positions. Considerably more sophisticated than `evaluatePosition` as sketched.
- **Combat (Phase 8)** — `combat.ts` computes an AI fire plan by simulating both ships chunk-by-chunk to find the first firing solution; `GameCanvas` visualizes the chosen arc.
- **Game flow (Phase 7)** — orders → reveal → resolve phases with simultaneous resolution, hidden AI orders, action log, ghost-ship previews.

---

## Critical issues (fix first)

### 1. The build is broken
`npm run build` fails to compile:
```
src/components/GameCanvas.tsx(227,9): error TS2552: Cannot find name 'setUnitMenuPos'.
src/components/GameCanvas.tsx(750,11): error TS2552: Cannot find name 'setUnitMenuPos'.
```
The state setter is named `setMenuPos` (line 43); two call sites reference a nonexistent `setUnitMenuPos`. These look like a half-finished rename. **The app cannot be production-built in its current state.** (Dev mode via Vite may still run because esbuild doesn't type-check.)

### 2. `package.json` is out of sync with the build
`vite.config.ts` imports `@tailwindcss/vite` and `src/index.css` does `@import "tailwindcss"`, but **neither `tailwindcss` nor `@tailwindcss/vite` is declared in `package.json`**. They exist in `node_modules` only because they were installed ad-hoc. A clean `npm install` on another machine (or CI) would fail to start Vite. Also note the plan specified Tailwind — it is in use (v4, via the Vite plugin), so just add the declarations.

### 3. Lint failures and committed debug scripts
- ESLint reports **17 errors** (mostly `no-unused-vars`, plus 2 `react-hooks/immutability` and 2 `prefer-const`).
- `debug_ai.ts` and `test_defensive.ts` are **committed at the repo root** and account for 8 of those errors. They look like throwaway scratch files — move them under a `scripts/`/`__tests__/` folder or delete them.
- Dead code: `ATTITUDE_ORDER` (ai.ts), `arcSteps` (GameCanvas), unused `MovementPlan` import (combat.ts).

---

## Spec / plan gaps

### Grapple & boarding (CLAUDE.md, PLAN 4.4)
- `grappled` exists only as a status enum value and a unit colour. **No grapple link line is drawn** between units (plan 4.4 explicitly calls for this), and there is **no "mark grappled by X" relationship** — a unit can't reference who grappled it.
- The aggressive style spec says a unit should "come into contact to grapple… if already grappled, go for a boarding action." The AI has **no grapple/boarding action** — it only does movement + firing. `suggestMovement` returns `null` for grappled units, so they simply freeze.

### Attitude is not actually scored (PLAN 5.2 / 6.1)
`scoreAttitude()` is a stub returning `0`, and `ATTITUDE_ORDER` is declared but unused. **The AI gets no reward for ending on a fast point of sail** (quarter-reaching/running). Movement decisions therefore ignore the wind-speed consequence the rules emphasize. This is the biggest *logic* gap.

### Speed model simplified vs. plan
`SpeedRange` was reduced to `{ max }` only — there is **no per-attitude `min`**. The plan (5.2) and product rules describe min/max ranges per attitude. The minimum-distance constraint is currently derived solely from `prevMoveDistance / 2`. This is a defensible simplification but diverges from the documented model.

### Difficulty / randomness slider (6.4)
`selectPlan` fully supports a `difficulty` parameter (random ↔ noisy ↔ best), but it is **hardcoded to `1`** at both call sites in `gameStore.ts` and there is **no UI control**. The feature is 90% built but unreachable.

### Save / load (7.5)
- **No JSON export/import** and no `navigator.share()` integration.
- **Auto-save is not implemented** — the plan calls for auto-save on every state change. Saving is manual via `saveCurrentGame`; `hasUnsavedChanges` is tracked but nothing flushes it automatically. Note the Zustand `persist` middleware only persists `savedGames` + default dimensions (via `partialize`); the actual game state lives under a separate `game-${id}` localStorage key written only on explicit save.

### Combat resolution (8.2)
Only fire-plan *computation/visualization* exists. There's no damage/destruction automation — status changes are fully manual via the unit form. Per the plan this is acceptable (Phase 8 is a stretch), worth noting only so expectations are clear.

---

## Smaller observations

- **`prevMoveDistance` uses planned distance, not actual.** In `resolveTurn` it's set to the sum of planned chunk distances; if the ship hit the table edge and clamped, next turn's minimum is computed from a distance it didn't travel. Minor.
- **In-irons drift magnitude is inconsistent across files.** `applyMovementPlan` drifts `driftSpeed` per chunk (×5 over a turn); `ai.ts:projectNextPosition` and the enemy projection use `driftSpeed * 5` per *projected step*. Worth a sanity check that look-ahead drift matches resolution drift.
- **`combat.ts` duplicates geometry helpers** (`distance`, `headingDeg`, `angleBetweenPoints`, `relativeAngle`, `inArc`, raking arcs) that already exist in `ai.ts`. Extract to a shared `utils/geometry.ts` to avoid drift between the two.
- **Magic arc angles** (`326.25/33.75` bow, `146.25/213.75` stern) are repeated inline in both `ai.ts` and `combat.ts` instead of reusing `arcSideToAngles`.
- **`loadGame` carries legacy migration shims** (`raw.settings?.tableWidth`, defaulted firing arcs). Fine for resilience, but indicates the save schema changed during iteration — worth a version field on saves.
- **Routing**: the plan left routing optional; the app uses a single `currentGame ? GameView : MainMenu` switch in `App.tsx`. Reasonable for the scope.
- **No tests.** `test_defensive.ts` / `debug_ai.ts` are ad-hoc console scripts, not a test suite. The pure movement/AI functions are highly testable and would benefit from even a small Vitest suite, especially around attitude wrap-around and in-irons.

---

## Recommended next actions (priority order)

1. **Fix the build** — rename `setUnitMenuPos` → `setMenuPos` (GameCanvas:227, 750). _(blocker)_
2. **Declare `tailwindcss` + `@tailwindcss/vite` in `package.json`** so clean installs work. _(blocker for CI/others)_
3. **Remove/relocate `debug_ai.ts` & `test_defensive.ts`**, then clear the remaining lint errors so `npm run lint` is green.
4. **Implement attitude scoring** (`scoreAttitude` + wire in `ATTITUDE_ORDER`) so the AI respects points of sail.
5. **Expose the difficulty slider** in the UI (the logic already exists).
6. **Grapple relationship + link rendering**, then aggressive-AI grapple/board behaviour.
7. **JSON export/import** and auto-save (debounced) per plan 7.5.
8. De-duplicate geometry helpers into a shared module; add a small Vitest suite for `movement.ts` / `attitude.ts` / `ai.ts`.
