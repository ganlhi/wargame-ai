import type { Unit, MovementPlan, TableTerrain, Attitude } from '../types'
import { arcSideToAngles } from '../types'
import { enumerateMovementPlans, applyMovementPlan } from './movement'

const GRAPPLE_RANGE = 20
const EDGE_DANGER = 100
const TERRAIN_DANGER = 50

const ATTITUDE_ORDER: Record<Attitude, number> = {
  quarter_reaching: 5,
  running: 4,
  reaching: 3,
  beating: 2,
  in_irons: 1,
}

function getEnemyMaxRange(enemy: Unit): number {
  return Math.max(...enemy.firingArcs.map((a) => a.maxRange), 0)
}

function getRangeTiers(enemy: Unit): { close: number; medium: number; long: number; extreme: number } {
  const extreme = getEnemyMaxRange(enemy)
  const long = extreme * 0.6
  const medium = long * 0.6
  const close = medium * 0.6
  return { close, medium, long, extreme }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

function headingDeg(orientation: number): number {
  return ((orientation * 360 / 32) + 270) % 360
}

function angleBetweenPoints(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return ((Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI) + 360) % 360
}

function relativeAngle(fromHeadingDeg: number, toAngleDeg: number): number {
  return ((toAngleDeg - fromHeadingDeg) + 360) % 360
}

function inArc(angle: number, minAngle: number, maxAngle: number): boolean {
  if (minAngle <= maxAngle) {
    return angle >= minAngle && angle <= maxAngle
  }
  return angle >= minAngle || angle <= maxAngle
}

function isTargetInAnyArc(
  firer: Unit,
  firerHeading: number,
  target: Unit,
): { inArc: boolean; isBroadside: boolean; isRaking: boolean } {
  const dist = distance(firer.position, target.position)
  const angleToTarget = angleBetweenPoints(firer.position, target.position)
  const relAngle = relativeAngle(firerHeading, angleToTarget)
  const targetHeading = headingDeg(target.orientation)

  for (const arc of firer.firingArcs) {
    if (dist > arc.maxRange) continue
    const a = arcSideToAngles(arc.side)
    if (!inArc(relAngle, a.minAngle, a.maxAngle)) continue

    const broadside = arc.side === 'port' || arc.side === 'starboard'

    const targetRel = relativeAngle(targetHeading, angleBetweenPoints(target.position, firer.position))
    const targetBow = { minAngle: 326.25, maxAngle: 33.75 }
    const targetStern = { minAngle: 146.25, maxAngle: 213.75 }
    const raking = inArc(targetRel, targetBow.minAngle, targetBow.maxAngle) ||
                   inArc(targetRel, targetStern.minAngle, targetStern.maxAngle)

    return { inArc: true, isBroadside: broadside, isRaking: raking }
  }

  return { inArc: false, isBroadside: false, isRaking: false }
}

function getEnemiesInFiringArcs(unit: Unit, enemies: Unit[]): {
  firingCount: number
  broadsideCount: number
  rakingCount: number
} {
  const h = headingDeg(unit.orientation)
  let firingCount = 0
  let broadsideCount = 0
  let rakingCount = 0

  for (const e of enemies) {
    const result = isTargetInAnyArc(unit, h, e)
    if (result.inArc) {
      firingCount++
      if (result.isBroadside) broadsideCount++
      if (result.isRaking) rakingCount++
    }
  }

  return { firingCount, broadsideCount, rakingCount }
}

function isEnemyBroadsideOnUnit(unit: Unit, enemy: Unit): boolean {
  const eh = headingDeg(enemy.orientation)
  const angleFromEnemy = angleBetweenPoints(enemy.position, unit.position)
  const enemyRel = relativeAngle(eh, angleFromEnemy)
  const portArc = arcSideToAngles('port')
  const starboardArc = arcSideToAngles('starboard')
  return inArc(enemyRel, portArc.minAngle, portArc.maxAngle) ||
         inArc(enemyRel, starboardArc.minAngle, starboardArc.maxAngle)
}

function scoreAttitude(attitude: Attitude): number {
  return (ATTITUDE_ORDER[attitude] - 1) * 25
}

function scoreFiring(unit: Unit, enemies: Unit[]): number {
  const { broadsideCount, rakingCount } = getEnemiesInFiringArcs(unit, enemies)
  return broadsideCount * 50 + rakingCount * 40
}

function scoreDistanceByStyle(unit: Unit, enemies: Unit[]): number {
  if (enemies.length === 0) return 0
  let score = 0

  for (const e of enemies) {
    const dist = distance(unit.position, e.position)
    const { close, medium, long } = getRangeTiers(e)

    switch (unit.aiStyle) {
      case 'aggressive': {
        if (dist < GRAPPLE_RANGE) score += 80
        else if (dist < close) score += 50
        else if (dist < medium) score += 20
        else score -= Math.floor(dist / 100) * 5
        break
      }
      case 'cautious': {
        if (dist >= close && dist <= medium) score += 40
        else if (dist < close) score -= 20
        else score -= 10
        break
      }
      case 'defensive': {
        if (dist > long) score += 40
        else if (dist > medium) score += 20
        else if (dist < close) score -= 30
        break
      }
    }
  }

  return score
}

function scoreEdgeProximity(pos: { x: number; y: number }, tableW: number, tableH: number): number {
  const edgeDist = Math.min(pos.x, pos.y, tableW - pos.x, tableH - pos.y)
  if (edgeDist < EDGE_DANGER) {
    return -(EDGE_DANGER - edgeDist) * 0.5
  }
  return 0
}

function scoreTerrainProximity(pos: { x: number; y: number }, terrain: TableTerrain[]): number {
  let penalty = 0
  for (const t of terrain) {
    for (const v of t.vertices) {
      const d = distance(pos, v)
      if (d < TERRAIN_DANGER) {
        penalty -= (TERRAIN_DANGER - d) * 0.3
      }
    }
  }
  return penalty
}

function scoreEnemyBroadsideDanger(unit: Unit, enemies: Unit[]): number {
  let penalty = 0
  for (const e of enemies) {
    if (isEnemyBroadsideOnUnit(unit, e)) {
      const dist = distance(unit.position, e.position)
      const { medium, long } = getRangeTiers(e)
      if (dist < medium) {
        penalty -= 20
      } else if (dist < long) {
        penalty -= 10
      }
    }
  }
  return penalty
}

function scoreStyleSpecific(unit: Unit, enemies: Unit[]): number {
  if (enemies.length === 0) return 0
  let bonus = 0

  switch (unit.aiStyle) {
    case 'aggressive': {
      const h = headingDeg(unit.orientation)
      for (const e of enemies) {
        const dist = distance(unit.position, e.position)
        if (dist < GRAPPLE_RANGE) bonus += 40
        const result = isTargetInAnyArc(unit, h, e)
        if (result.isRaking) bonus += 30
        else if (result.isBroadside) bonus += 20
      }
      break
    }
    case 'cautious': {
      for (const e of enemies) {
        const dist = distance(unit.position, e.position)
        const { close, medium } = getRangeTiers(e)
        const h = headingDeg(unit.orientation)
        const result = isTargetInAnyArc(unit, h, e)
        if (result.isRaking && dist >= close && dist <= medium) bonus += 40
        else if (result.isBroadside && dist >= close && dist <= medium) bonus += 20
        if (result.inArc && dist < close && !result.isRaking) bonus -= 15
        if (!result.inArc && dist > medium) bonus -= 10
      }
      break
    }
    case 'defensive': {
      for (const en of enemies) {
        const dist = distance(unit.position, en.position)
        const { close, long } = getRangeTiers(en)
        if (dist < close) bonus -= 20
        if (isEnemyBroadsideOnUnit(unit, en)) {
          bonus -= 15
        }
        if (dist > long) bonus += 20
      }
      break
    }
  }

  return bonus
}

export function evaluatePosition(
  unit: Unit,
  enemies: Unit[],
  terrain: TableTerrain[],
  tableWidth: number,
  tableHeight: number,
): number {
  let score = 0

  score += scoreAttitude(unit.attitude)
  score += scoreFiring(unit, enemies)
  score += scoreDistanceByStyle(unit, enemies)
  score += scoreStyleSpecific(unit, enemies)
  score += scoreEdgeProximity(unit.position, tableWidth, tableHeight)
  score += scoreTerrainProximity(unit.position, terrain)
  score += scoreEnemyBroadsideDanger(unit, enemies)

  return score
}

function selectPlan(
  plans: MovementPlan[],
  scores: number[],
  difficulty: number,
): MovementPlan | null {
  if (plans.length === 0) return null
  if (plans.length === 1) return plans[0]

  if (difficulty <= 0) {
    return plans[Math.floor(Math.random() * plans.length)]
  }

  if (difficulty >= 1) {
    const best = Math.max(...scores)
    const bestIdx = scores.indexOf(best)
    return plans[bestIdx]
  }

  const minS = Math.min(...scores)
  const maxS = Math.max(...scores)
  const range = maxS - minS || 1

  const noisy = scores.map((s) => s + (Math.random() - 0.5) * range * (1 - difficulty) * 2)
  const bestNoisy = Math.max(...noisy)
  return plans[noisy.indexOf(bestNoisy)]
}

export function suggestMovement(
  unit: Unit,
  allUnits: Unit[],
  terrain: TableTerrain[],
  windDirection: number,
  tableWidth: number,
  tableHeight: number,
  prevAttitude: Attitude | null,
  difficulty = 1,
): MovementPlan | null {
  if (
    unit.status === 'destroyed' ||
    unit.status === 'surrendered' ||
    unit.status === 'grappled'
  ) {
    return null
  }

  const enemies = allUnits.filter(
    (u) => u.side !== unit.side && u.status !== 'destroyed' && u.status !== 'surrendered',
  )

  if (unit.status === 'immobilised') {
    const idlePlan: MovementPlan = {
      chunks: [
        { distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 }, { distance: 0 },
      ],
      totalTurnPoints: 0,
      effectiveMaxSpeed: 0,
    }
    const newState = applyMovementPlan(unit, idlePlan, windDirection, tableWidth, tableHeight)
    const testUnit: Unit = { ...unit, ...newState }
    const score = evaluatePosition(testUnit, enemies, terrain, tableWidth, tableHeight)
    return selectPlan([idlePlan], [score], difficulty)
  }

  const plans = enumerateMovementPlans(unit, windDirection, prevAttitude)

  if (plans.length === 0) return null

  const planScores = plans.map((plan) => {
    const newState = applyMovementPlan(unit, plan, windDirection, tableWidth, tableHeight)
    const testUnit: Unit = { ...unit, ...newState, attitude: newState.attitude }
    return evaluatePosition(testUnit, enemies, terrain, tableWidth, tableHeight)
  })

  return selectPlan(plans, planScores, difficulty)
}
