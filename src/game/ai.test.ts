import { describe, it, expect } from 'vitest'
import {
  evaluatePosition, suggestMovement, decideAggressiveAction, basesWithinGrapple, scoreTack,
} from './ai'
import { applyMovementPlan } from './movement'
import { computeAIFirePlan } from './combat'
import { centerFromSternMidpoint } from '../utils/coordinates'
import { computeAttitude } from '../utils/attitude'
import { distance } from '../utils/geometry'
import { baseCorners, polygonsIntersect } from '../utils/geometry'
import type { Unit, Attitude, SpeedRange, FiringArc, MovementPlan, TableTerrain } from '../types'

const IDLE_PLAN: MovementPlan = {
  chunks: [{ distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }],
  totalTurnPoints: 0,
  effectiveMaxSpeed: 0,
}

const SPEED_PROFILE: Record<Attitude, SpeedRange> = {
  in_irons: { max: 0 },
  beating: { max: 60 },
  reaching: { max: 80 },
  quarter_reaching: { max: 100 },
  running: { max: 90 },
}

const STARBOARD_ARC: FiringArc = { id: 'a1', side: 'starboard', maxRange: 300, weapons: 10 }

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'u1',
    name: 'Test',
    side: 'ai',
    position: { x: 500, y: 500 },
    orientation: 8,
    status: 'active',
    aiStyle: 'aggressive',
    maxTurnPoints: 6,
    foreAndAftRigged: false,
    speedProfile: SPEED_PROFILE,
    driftSpeed: 10,
    baseWidth: 30,
    baseLength: 80,
    firingArcs: [],
    attitude: 'reaching',
    isInIrons: false,
    grappledWith: null,
    tackDirection: null,
    prevAttitude: 'reaching',
    prevMoveDistance: 0,
    hiddenAIOrder: null,
    playerOrder: null,
    lastFireChunks: {},
    hiddenAIFirePlan: null,
    hiddenAIAction: null,
    ...overrides,
  }
}

describe('evaluatePosition', () => {
  const enemy = makeUnit({ id: 'e1', side: 'player', position: { x: 500, y: 500 }, firingArcs: [STARBOARD_ARC] })

  it('rewards an aggressive ship for being closer to the enemy', () => {
    const near = makeUnit({ aiStyle: 'aggressive', position: { x: 500, y: 460 } })
    const far = makeUnit({ aiStyle: 'aggressive', position: { x: 500, y: 150 } })
    const sNear = evaluatePosition(near, [enemy], [])
    const sFar = evaluatePosition(far, [enemy], [])
    expect(sNear).toBeGreaterThan(sFar)
  })

  it('rewards a defensive ship for keeping its distance', () => {
    const near = makeUnit({ aiStyle: 'defensive', position: { x: 500, y: 460 } })
    const far = makeUnit({ aiStyle: 'defensive', position: { x: 500, y: 150 } })
    const sNear = evaluatePosition(near, [enemy], [])
    const sFar = evaluatePosition(far, [enemy], [])
    expect(sFar).toBeGreaterThan(sNear)
  })

  it('rewards a faster point of sail, all else equal', () => {
    // Same position/heading/enemies — only the end-of-turn attitude differs.
    const fast = makeUnit({ attitude: 'quarter_reaching' })
    const slow = makeUnit({ attitude: 'beating' })
    const sFast = evaluatePosition(fast, [], [])
    const sSlow = evaluatePosition(slow, [], [])
    expect(sFast).toBeGreaterThan(sSlow)
    // In irons (no headway) is the worst attitude to end on.
    const irons = makeUnit({ attitude: 'in_irons' })
    expect(evaluatePosition(irons, [], [])).toBeLessThan(sSlow)
  })

  it('does not let attitude override a clearly better position', () => {
    // A slow attitude in a strong firing position must still beat a fast
    // attitude with no firing solution — attitude only breaks ties.
    const inPosition = makeUnit({
      attitude: 'beating',
      position: { x: 500, y: 460 },
      orientation: 0,
      firingArcs: [STARBOARD_ARC],
    })
    const fastButIdle = makeUnit({
      attitude: 'quarter_reaching',
      position: { x: 500, y: 150 },
      firingArcs: [STARBOARD_ARC],
    })
    const sIn = evaluatePosition(inPosition, [enemy], [])
    const sIdle = evaluatePosition(fastButIdle, [enemy], [])
    expect(sIn).toBeGreaterThan(sIdle)
  })
})

describe('basesWithinGrapple', () => {
  // bases are 30 (width) × 80 (length); along +x the length spans ±40.
  const a = makeUnit({ position: { x: 500, y: 500 }, orientation: 8 })

  it('is true when bases nearly touch (gap ≤ 20mm)', () => {
    const b = makeUnit({ position: { x: 590, y: 500 }, orientation: 8 }) // 10mm gap
    expect(basesWithinGrapple(a, b)).toBe(true)
  })

  it('is false when bases are well apart', () => {
    const b = makeUnit({ position: { x: 700, y: 500 }, orientation: 8 }) // 120mm gap
    expect(basesWithinGrapple(a, b)).toBe(false)
  })
})

describe('decideAggressiveAction', () => {
  it('declares a grapple when the plan ends within reach of an enemy', () => {
    const unit = makeUnit({ aiStyle: 'aggressive', position: { x: 500, y: 500 }, orientation: 8 })
    const foe = makeUnit({ id: 'e1', side: 'player', position: { x: 590, y: 500 }, orientation: 8 })
    const action = decideAggressiveAction(unit, IDLE_PLAN, [unit, foe], 16)
    expect(action).toEqual({ type: 'grapple', targetId: 'e1' })
  })

  it('boards the enemy it is already grappled to', () => {
    const foe = makeUnit({ id: 'e1', side: 'player', status: 'grappled', grappledWith: 'u1' })
    const unit = makeUnit({ aiStyle: 'aggressive', status: 'grappled', grappledWith: 'e1' })
    const action = decideAggressiveAction(unit, null, [unit, foe], 16)
    expect(action).toEqual({ type: 'board', targetId: 'e1' })
  })

  it('returns null for non-aggressive styles even when adjacent', () => {
    const unit = makeUnit({ aiStyle: 'cautious', position: { x: 500, y: 500 }, orientation: 8 })
    const foe = makeUnit({ id: 'e1', side: 'player', position: { x: 590, y: 500 }, orientation: 8 })
    expect(decideAggressiveAction(unit, IDLE_PLAN, [unit, foe], 16)).toBeNull()
  })

  it('returns null when no enemy is within grapple reach', () => {
    const unit = makeUnit({ aiStyle: 'aggressive', position: { x: 500, y: 500 }, orientation: 8 })
    const foe = makeUnit({ id: 'e1', side: 'player', position: { x: 800, y: 500 }, orientation: 8 })
    expect(decideAggressiveAction(unit, IDLE_PLAN, [unit, foe], 16)).toBeNull()
  })
})

describe('suggestMovement', () => {
  const enemy = makeUnit({ id: 'e1', side: 'player', position: { x: 600, y: 500 }, firingArcs: [STARBOARD_ARC] })

  it('returns null for a unit that cannot act', () => {
    for (const status of ['destroyed', 'surrendered', 'grappled'] as const) {
      const unit = makeUnit({ status, firingArcs: [STARBOARD_ARC] })
      expect(suggestMovement(unit, [unit, enemy], [], 0, null)).toBeNull()
    }
  })

  it('returns a valid 5-chunk plan for an active unit', () => {
    const unit = makeUnit({ aiStyle: 'aggressive', firingArcs: [STARBOARD_ARC] })
    const result = suggestMovement(unit, [unit, enemy], [], 0, null)
    expect(result).not.toBeNull()
    expect(result!.chunks).toHaveLength(5)
    expect(result!.totalTurnPoints).toBeLessThanOrEqual(unit.maxTurnPoints)
  })

  it('keeps an immobilised unit stationary (all-zero chunks)', () => {
    const unit = makeUnit({ status: 'immobilised', firingArcs: [STARBOARD_ARC] })
    const result = suggestMovement(unit, [unit, enemy], [], 0, null)
    expect(result).not.toBeNull()
    expect(result!.chunks.every((c) => c.distance === 0)).toBe(true)
  })

  it('never picks a plan whose base overlaps another ship', () => {
    // An aggressive ship heading straight at a ship parked just ahead would
    // normally close to ram it; collision avoidance must keep the bases apart.
    const unit = makeUnit({
      aiStyle: 'aggressive',
      position: { x: 500, y: 500 },
      orientation: 8, // heading +x
      firingArcs: [STARBOARD_ARC],
    })
    const blocker = makeUnit({
      id: 'b1',
      side: 'player',
      position: { x: 640, y: 500 }, // directly ahead: clear now, but closing would overlap
      orientation: 8,
      firingArcs: [STARBOARD_ARC],
    })
    const result = suggestMovement(unit, [unit, blocker], [], 16, null)
    expect(result).not.toBeNull()
    const end = applyMovementPlan(unit, result!, 16)
    const blockerFp = baseCorners(blocker.position, blocker.orientation, blocker.baseWidth, blocker.baseLength)
    for (const pose of end.poses) {
      const fp = baseCorners(pose, pose.orientation, unit.baseWidth, unit.baseLength)
      expect(polygonsIntersect(fp, blockerFp)).toBe(false)
    }
  })
})

describe('disengagement leash (infinite table)', () => {
  // STARBOARD_ARC reaches 300mm, so the leash sits at 1.5 × 400 (the fallback
  // floor, which exceeds 300) = 600mm from the nearest enemy.
  const enemy = makeUnit({ id: 'e1', side: 'player', position: { x: 0, y: 0 }, firingArcs: [STARBOARD_ARC] })

  it('does not penalise anything inside the leash', () => {
    const inside = makeUnit({ aiStyle: 'defensive', position: { x: 550, y: 0 }, firingArcs: [STARBOARD_ARC] })
    const atLimit = makeUnit({ aiStyle: 'defensive', position: { x: 600, y: 0 }, firingArcs: [STARBOARD_ARC] })
    expect(evaluatePosition(atLimit, [enemy], [])).toBeCloseTo(evaluatePosition(inside, [enemy], []), 6)
  })

  it('penalises a defensive ship further the more it withdraws past the leash', () => {
    const near = makeUnit({ aiStyle: 'defensive', position: { x: 700, y: 0 }, firingArcs: [STARBOARD_ARC] })
    const far = makeUnit({ aiStyle: 'defensive', position: { x: 2000, y: 0 }, firingArcs: [STARBOARD_ARC] })
    const veryFar = makeUnit({ aiStyle: 'defensive', position: { x: 10000, y: 0 }, firingArcs: [STARBOARD_ARC] })
    expect(evaluatePosition(near, [enemy], [])).toBeGreaterThan(evaluatePosition(far, [enemy], []))
    expect(evaluatePosition(far, [enemy], [])).toBeGreaterThan(evaluatePosition(veryFar, [enemy], []))
  })

  it('brings a defensive unit back once it is past the leash, instead of fleeing for ever', () => {
    // Bow due east, directly away from the enemy, wind from the north so either
    // way round is equally fast. Sailed out at 3000mm — five times the leash —
    // the ship should work its way back in rather than keep running, which is
    // the whole job the table edge used to do.
    let unit = makeUnit({
      aiStyle: 'defensive',
      position: { x: 3000, y: 0 },
      orientation: 8,
      firingArcs: [STARBOARD_ARC],
    })
    const ranges: number[] = []
    for (let turn = 0; turn < 12; turn++) {
      const plan = suggestMovement(unit, [unit, enemy], [], 0, unit.prevAttitude)
      expect(plan).not.toBeNull()
      const end = applyMovementPlan(unit, plan!, 0)
      unit = {
        ...unit,
        position: end.position,
        orientation: end.orientation,
        attitude: end.attitude,
        prevAttitude: unit.attitude,
        prevMoveDistance: end.distanceTraveled,
        isInIrons: end.isInIrons,
      }
      ranges.push(Math.hypot(end.position.x, end.position.y))
    }

    // It closes, and keeps closing, rather than drifting outward for ever.
    expect(ranges[ranges.length - 1]).toBeLessThan(2200)
    expect(Math.max(...ranges)).toBeLessThan(3100)
  })

  it('holds station rather than closing all the way in', () => {
    // Inside the leash a defensive unit still wants distance, so it should not
    // be dragged onto the enemy by the leash term.
    let unit = makeUnit({
      aiStyle: 'defensive',
      position: { x: 300, y: 0 },
      orientation: 8,
      firingArcs: [STARBOARD_ARC],
    })
    for (let turn = 0; turn < 12; turn++) {
      const plan = suggestMovement(unit, [unit, enemy], [], 0, unit.prevAttitude)
      const end = applyMovementPlan(unit, plan!, 0)
      unit = {
        ...unit,
        position: end.position,
        orientation: end.orientation,
        attitude: end.attitude,
        prevAttitude: unit.attitude,
        prevMoveDistance: end.distanceTraveled,
        isInIrons: end.isInIrons,
      }
    }
    expect(Math.hypot(unit.position.x, unit.position.y)).toBeGreaterThan(200)
  })

  it('leaves a ship with no enemies unpenalised wherever it is', () => {
    const lonely = makeUnit({ aiStyle: 'defensive', position: { x: 99999, y: 99999 } })
    expect(Number.isFinite(evaluatePosition(lonely, [], []))).toBe(true)
  })
})

describe('tacking as an AI choice', () => {
  // A ship that never moves, so the lookahead's projection of it is exact and
  // the test turns purely on the geometry the tack creates.
  const ANCHORED: Record<Attitude, SpeedRange> = {
    in_irons: { max: 0 }, beating: { max: 0 }, reaching: { max: 0 },
    quarter_reaching: { max: 0 }, running: { max: 0 },
  }
  const BROADSIDES: FiringArc[] = [
    { id: 'p', side: 'port', maxRange: 300, weapons: 10 },
    { id: 's', side: 'starboard', maxRange: 300, weapons: 10 },
  ]

  // Wind from the north. Orientation 6 is beating with the wind on the port
  // bow; coming about swings 12 points to port, so a ship with 6 turn points
  // takes two turns and finishes at (0, 40) heading 26 (WNW), drifting 20mm a
  // turn. Its port broadside then bears SSW, its starboard NNE.
  const beatingAI = (overrides: Partial<Unit> = {}) =>
    makeUnit({
      aiStyle: 'aggressive',
      position: { x: 0, y: 0 },
      orientation: 6,
      attitude: 'beating',
      prevAttitude: 'beating',
      maxTurnPoints: 6,
      driftSpeed: 20,
      firingArcs: BROADSIDES,
      ...overrides,
    })

  /** An enemy `range` mm away on the given bearing, measured from `from`. */
  const enemyOnBearing = (bearingPoint: number, range: number, from = { x: 0, y: 40 }) => {
    const angle = (bearingPoint * Math.PI) / 16 - Math.PI / 2
    return makeUnit({
      id: 'e1',
      side: 'player',
      orientation: 0,
      speedProfile: ANCHORED,
      firingArcs: BROADSIDES,
      position: {
        x: Math.round(from.x + Math.cos(angle) * range),
        y: Math.round(from.y + Math.sin(angle) * range),
      },
    })
  }

  it('comes about when the tack puts a broadside on an enemy at short range', () => {
    const unit = beatingAI()
    const enemy = enemyOnBearing(18, 90) // SSW: the port broadside
    const plan = suggestMovement(unit, [unit, enemy], [], 0, 'beating')
    expect(plan?.isTack).toBe(true)
    // A tack is a tack: no way on at all.
    expect(plan!.chunks.every((c) => c.distance === 0)).toBe(true)
  })

  it('sails on instead when the enemy is already ahead of her', () => {
    // Enemy fine off the bow on the current heading: coming about would throw
    // away several turns to end up further from a fight already in reach.
    const unit = beatingAI()
    const enemy = makeUnit({
      id: 'e1', side: 'player', orientation: 0, speedProfile: ANCHORED,
      firingArcs: BROADSIDES, position: { x: 210, y: -90 },
    })
    const plan = suggestMovement(unit, [unit, enemy], [], 0, 'beating')
    expect(plan?.isTack).toBeFalsy()
  })

  describe('scoreTack', () => {
    const score = (enemy: Unit, unit = beatingAI(), terrain: TableTerrain[] = []) =>
      scoreTack(unit, [enemy], terrain, 0)

    it('pays for a broadside bearing at short range', () => {
      expect(score(enemyOnBearing(18, 90))).toBeGreaterThan(0)
    })

    it('pays more the closer the broadside bears', () => {
      expect(score(enemyOnBearing(18, 60))).toBeGreaterThan(
        score(enemyOnBearing(18, 100)),
      )
    })

    it('pays nothing once the enemy is beyond short range', () => {
      expect(score(enemyOnBearing(18, 900))).toBe(0)
    })

    it('pays nothing when only the bow or stern would bear', () => {
      // Dead ahead on the new tack: no broadside on her at all.
      expect(score(enemyOnBearing(26, 90))).toBe(0)
    })

    it('pays nothing for drifting onto terrain', () => {
      const shoal: TableTerrain = {
        id: 't1', type: 'shoal', center: { x: 0, y: 40 },
        shape: { kind: 'circle', width: 120, height: 120, rotation: 0 },
      }
      expect(score(enemyOnBearing(18, 90), beatingAI(), [shoal])).toBe(0)
    })

    it('discounts a tack that takes longer to come round', () => {
      // No drift in either case, so both finish in the same place and the only
      // difference is how many turns the swing takes: 2 against 6.
      const enemy = enemyOnBearing(18, 90, { x: 0, y: 0 })
      const quick = score(enemy, beatingAI({ maxTurnPoints: 6, driftSpeed: 0 }))
      const slow = score(enemy, beatingAI({ maxTurnPoints: 2, driftSpeed: 0 }))
      expect(slow).toBeGreaterThan(0)
      expect(slow).toBeLessThan(quick)
    })

    it('interests a defensive ship far less than one looking for a fight', () => {
      const enemy = enemyOnBearing(18, 90)
      expect(score(enemy, beatingAI({ aiStyle: 'defensive' }))).toBeLessThan(
        score(enemy, beatingAI({ aiStyle: 'aggressive' })),
      )
    })

    it('is worthless with no enemy, or to a ship that cannot come round', () => {
      expect(scoreTack(beatingAI(), [], [], 0)).toBe(0)
      expect(score(enemyOnBearing(18, 90), beatingAI({ maxTurnPoints: 0 }))).toBe(0)
    })
  })

  it('will not tack onto terrain, however good the broadside would be', () => {
    const unit = beatingAI()
    const enemy = enemyOnBearing(18, 90)
    const shoal: TableTerrain = {
      id: 't1',
      type: 'shoal',
      center: { x: 0, y: 40 }, // exactly where the tack would leave her
      shape: { kind: 'circle', width: 120, height: 120, rotation: 0 },
    }
    const plan = suggestMovement(unit, [unit, enemy], [shoal], 0, 'beating')
    expect(plan?.isTack).toBeFalsy()
  })

  it('never offers a tack to a ship that was not beating all last turn', () => {
    const unit = beatingAI()
    const enemy = enemyOnBearing(18, 90)
    const plan = suggestMovement(unit, [unit, enemy], [], 0, 'reaching')
    expect(plan?.isTack).toBeFalsy()
  })

  it('gives a ship already mid-tack no option but to carry on', () => {
    const unit = beatingAI({ orientation: 2, isInIrons: true, tackDirection: 'port', attitude: 'in_irons' })
    const enemy = enemyOnBearing(18, 90)
    const plan = suggestMovement(unit, [unit, enemy], [], 0, 'in_irons')
    expect(plan?.isTack).toBe(true)
  })
})

describe('choosing a move that actually fires', () => {
  const BROADSIDES: FiringArc[] = [
    { id: 'p', side: 'port', maxRange: 300, weapons: 10 },
    { id: 's', side: 'starboard', maxRange: 300, weapons: 10 },
  ]
  const STATIONARY: MovementPlan = {
    chunks: [{ distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }],
    totalTurnPoints: 0,
    effectiveMaxSpeed: 0,
  }

  // The reported case: a player ship at the origin heading SSE, with the AI
  // 131mm east and 47mm south of it heading NNW. Positions are entered as the
  // middle of the stern, so the base centres are derived from them.
  const reportedSituation = (aiStyle: Unit['aiStyle'] = 'cautious') => {
    const player = makeUnit({
      id: 'p1', side: 'player', orientation: 14,
      position: centerFromSternMidpoint({ x: 0, y: 0 }, 14, 80),
      firingArcs: BROADSIDES,
    })
    const ai = makeUnit({
      id: 'ai1', side: 'ai', aiStyle, orientation: 30,
      position: centerFromSternMidpoint({ x: 131, y: 47 }, 30, 80),
      firingArcs: BROADSIDES,
    })
    return { ai, player }
  }

  it('has a broadside bearing at point-blank range to begin with', () => {
    const { ai, player } = reportedSituation()
    expect(computeAIFirePlan({ ...ai, hiddenAIOrder: STATIONARY }, [ai, player], 0)).toMatchObject({
      arcSide: 'port',
      targetId: 'p1',
    })
  })

  it('does not turn that broadside away — the move it picks still fires', () => {
    // Wind from the north leaves this ship in irons and unable to sail, so the
    // only thing on offer is a turn. It used to spend that turn swinging the
    // target out of the port arc and into a blind spot, and fire nothing.
    for (const style of ['aggressive', 'cautious', 'defensive'] as const) {
      const { ai, player } = reportedSituation(style)
      const unit = { ...ai, attitude: computeAttitude(0, ai.orientation, false) }
      const plan = suggestMovement(unit, [unit, player], [], 0, unit.attitude)
      expect(plan).not.toBeNull()
      const fire = computeAIFirePlan({ ...unit, hiddenAIOrder: plan }, [unit, player], 0)
      expect(fire, `${style} threw away its shot`).not.toBeNull()
    }
  })

  it('prefers the plan that gets the guns off, all else being close', () => {
    // Wind on the beam, so the ship can sail and has real choices to weigh.
    const { ai, player } = reportedSituation('cautious')
    const unit = { ...ai, attitude: computeAttitude(8, ai.orientation, false) }
    const plan = suggestMovement(unit, [unit, player], [], 8, unit.attitude)
    expect(computeAIFirePlan({ ...unit, hiddenAIOrder: plan }, [unit, player], 8)).not.toBeNull()
  })

  it('still lets an aggressive ship close to board rather than stand off and shoot', () => {
    // Losing a broadside to get alongside is the aggressive style working as
    // intended, so the firing term must not override it.
    const { ai, player } = reportedSituation('aggressive')
    const unit = { ...ai, attitude: computeAttitude(12, ai.orientation, false) }
    const plan = suggestMovement(unit, [unit, player], [], 12, unit.attitude)
    const end = applyMovementPlan(unit, plan!, 12)
    expect(distance(end.position, player.position)).toBeLessThan(
      distance(unit.position, player.position),
    )
  })
})
