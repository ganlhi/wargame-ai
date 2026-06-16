import type { Unit, MovementPlan, TableTerrain, Attitude, SpeedRange } from '../types'
import { arcSideToAngles } from '../types'
import { enumerateMovementPlans, applyMovementPlan, orientationToVector } from './movement'

const GRAPPLE_RANGE = 20
const EDGE_DANGER = 120
const EDGE_PENALTY_MULT = 2
const TERRAIN_DANGER = 30
const TERRAIN_PENALTY_MULT = 0.5

const BOUNDARY_PENALTY = -5000
const FUTURE_BOUNDARY_PENALTY = -3000
const LOOKAHEAD_DISCOUNT = 0.5

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

function getEngageableWeapons(
  firer: Unit,
  firerHeading: number,
  target: Unit,
): { totalWeapons: number; broadsideWeapons: number; isRaking: boolean } {
  const dist = distance(firer.position, target.position)
  const angleToTarget = angleBetweenPoints(firer.position, target.position)
  const relAngle = relativeAngle(firerHeading, angleToTarget)
  const targetHeading = headingDeg(target.orientation)
  const targetRelAngle = relativeAngle(targetHeading, angleBetweenPoints(target.position, firer.position))

  let totalWeapons = 0
  let broadsideWeapons = 0
  let isRaking = false
  const targetBow = { minAngle: 326.25, maxAngle: 33.75 }
  const targetStern = { minAngle: 146.25, maxAngle: 213.75 }

  for (const arc of firer.firingArcs) {
    if (dist > arc.maxRange) continue
    const a = arcSideToAngles(arc.side)
    if (!inArc(relAngle, a.minAngle, a.maxAngle)) continue

    const weapons = arc.weapons || 1
    totalWeapons += weapons
    if (arc.side === 'port' || arc.side === 'starboard') {
      broadsideWeapons += weapons
    }
    if (
      inArc(targetRelAngle, targetBow.minAngle, targetBow.maxAngle) ||
      inArc(targetRelAngle, targetStern.minAngle, targetStern.maxAngle)
    ) {
      isRaking = true
    }
  }

  return { totalWeapons, broadsideWeapons, isRaking }
}

function getTotalEnemyWeaponsInArc(unit: Unit, enemies: Unit[]): {
  totalWeapons: number
  broadsideWeapons: number
  anyRaking: boolean
} {
  const h = headingDeg(unit.orientation)
  let totalWeapons = 0
  let broadsideWeapons = 0
  let anyRaking = false

  for (const e of enemies) {
    const result = getEngageableWeapons(unit, h, e)
    totalWeapons += result.totalWeapons
    broadsideWeapons += result.broadsideWeapons
    if (result.isRaking) anyRaking = true
  }

  return { totalWeapons, broadsideWeapons, anyRaking }
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

function pointToSegmentDist(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return distance(p, a)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * abx
  const cy = a.y + t * aby
  return distance(p, { x: cx, y: cy })
}

function pointInTerrain(p: { x: number; y: number }, terrain: TableTerrain[]): boolean {
  for (const t of terrain) {
    const v = t.vertices
    if (v.length < 3) continue
    let inside = false
    for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
      const xi = v[i].x, yi = v[i].y
      const xj = v[j].x, yj = v[j].y
      if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
        inside = !inside
      }
    }
    if (inside) return true
  }
  return false
}

function minEdgeDistance(pos: { x: number; y: number }, terrain: TableTerrain[]): number {
  let minDist = Infinity
  for (const t of terrain) {
    const v = t.vertices
    if (v.length < 3) continue
    for (let i = 0; i < v.length; i++) {
      const j = (i + 1) % v.length
      const d = pointToSegmentDist(pos, v[i], v[j])
      if (d < minDist) minDist = d
    }
  }
  return minDist
}

function scoreAttitude(_attitude: Attitude): number {
  return 0
}

function scoreFiring(unit: Unit, enemies: Unit[]): number {
  const { broadsideWeapons, anyRaking } = getTotalEnemyWeaponsInArc(unit, enemies)
  return broadsideWeapons * 2 + (anyRaking ? 15 : 0)
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
        if (dist >= medium && dist <= long) score += 50
        else if (dist < close) score -= 30
        else if (dist < medium) score -= 10
        else score -= 15
        break
      }
      case 'defensive': {
        if (dist > long) score += 60
        else if (dist > medium) score += 20
        else if (dist < close) score -= 50
        else score -= 20
        break
      }
    }
  }

  return score
}

const EDGE_STYLE_MULT: Record<string, number> = {
  aggressive: 1,
  cautious: 1.5,
  defensive: 2,
}

function scoreEdgeProximity(pos: { x: number; y: number }, tableW: number, tableH: number, style: string): number {
  const edgeDist = Math.min(pos.x, pos.y, tableW - pos.x, tableH - pos.y)
  if (edgeDist < EDGE_DANGER) {
    return -(EDGE_DANGER - edgeDist) * EDGE_PENALTY_MULT * (EDGE_STYLE_MULT[style] ?? 1)
  }
  return 0
}

function scoreHeadingTowardEdge(
  pos: { x: number; y: number },
  orientation: number,
  tableW: number,
  tableH: number,
  aiStyle: string,
  nearestEnemyDir: { x: number; y: number } | null,
): number {
  const vec = orientationToVector(orientation)
  const HEADING_WARN = 150
  const STRENGTH = 2

  let maxPenalty = 0
  if (pos.x < HEADING_WARN && vec.dx < 0) {
    maxPenalty = Math.max(maxPenalty, (HEADING_WARN - pos.x) * -vec.dx * STRENGTH)
  }
  if ((tableW - pos.x) < HEADING_WARN && vec.dx > 0) {
    maxPenalty = Math.max(maxPenalty, (HEADING_WARN - (tableW - pos.x)) * vec.dx * STRENGTH)
  }
  if (pos.y < HEADING_WARN && vec.dy < 0) {
    maxPenalty = Math.max(maxPenalty, (HEADING_WARN - pos.y) * -vec.dy * STRENGTH)
  }
  if ((tableH - pos.y) < HEADING_WARN && vec.dy > 0) {
    maxPenalty = Math.max(maxPenalty, (HEADING_WARN - (tableH - pos.y)) * vec.dy * STRENGTH)
  }

  if (maxPenalty === 0 || !nearestEnemyDir) return -maxPenalty

  const moveLen = Math.sqrt(vec.dx * vec.dx + vec.dy * vec.dy)
  const enemyLen = Math.sqrt(nearestEnemyDir.x * nearestEnemyDir.x + nearestEnemyDir.y * nearestEnemyDir.y)
  if (moveLen === 0 || enemyLen === 0) return -maxPenalty

  const dot = (vec.dx * nearestEnemyDir.x + vec.dy * nearestEnemyDir.y) / (moveLen * enemyLen)

  let reduction = 0
  if (aiStyle === 'defensive' && dot < -0.3) {
    reduction = 0.5
  } else if (aiStyle === 'aggressive' && dot > 0.3) {
    reduction = 0.5
  } else if (aiStyle === 'cautious') {
    reduction = 0.2
  }

  return -(maxPenalty * (1 - reduction))
}

function scoreTerrainProximity(pos: { x: number; y: number }, terrain: TableTerrain[]): number {
  if (terrain.length === 0) return 0

  if (pointInTerrain(pos, terrain)) {
    return -(TERRAIN_DANGER + 30) * TERRAIN_PENALTY_MULT
  }

  let penalty = 0
  for (const t of terrain) {
    const v = t.vertices
    if (v.length < 3) continue
    let minEdgeDist = Infinity
    for (let i = 0; i < v.length; i++) {
      const j = (i + 1) % v.length
      const d = pointToSegmentDist(pos, v[i], v[j])
      if (d < minEdgeDist) minEdgeDist = d
    }
    if (minEdgeDist < TERRAIN_DANGER) {
      penalty -= (TERRAIN_DANGER - minEdgeDist) * TERRAIN_PENALTY_MULT
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
  const h = headingDeg(unit.orientation)

  for (const e of enemies) {
    const dist = distance(unit.position, e.position)
    const { close, medium, long } = getRangeTiers(e)
    const weapons = getEngageableWeapons(unit, h, e)

    switch (unit.aiStyle) {
      case 'aggressive': {
        if (dist < GRAPPLE_RANGE) bonus += 40
        if (weapons.isRaking) bonus += weapons.totalWeapons * 0.6
        else if (weapons.broadsideWeapons > 0) bonus += weapons.broadsideWeapons * 0.4
        break
      }
      case 'cautious': {
        if (weapons.isRaking && dist >= medium && dist <= long) bonus += weapons.totalWeapons * 2
        else if (weapons.broadsideWeapons > 0 && dist >= medium && dist <= long) bonus += weapons.broadsideWeapons * 1.5
        if (weapons.totalWeapons > 0 && dist < close) bonus -= weapons.totalWeapons * 0.5
        if (weapons.totalWeapons === 0 && dist > long) bonus -= 15
        break
      }
      case 'defensive': {
        if (dist < close) bonus -= 30
        if (isEnemyBroadsideOnUnit(unit, e)) bonus -= 25
        if (dist > long) bonus += 30
        break
      }
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
  score += scoreEdgeProximity(unit.position, tableWidth, tableHeight, unit.aiStyle)
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

function projectNextPosition(
  pos: { x: number; y: number },
  orientation: number,
  attitude: Attitude,
  isInIrons: boolean,
  speedProfile: Record<Attitude, SpeedRange>,
  driftSpeed: number,
  windAngle: number,
): { x: number; y: number } {
  if (isInIrons) {
    const driftDir = (windAngle + 8) % 32
    const driftAngle = (driftDir * Math.PI / 16) - Math.PI / 2
    return {
      x: pos.x + Math.cos(driftAngle) * driftSpeed * 5,
      y: pos.y + Math.sin(driftAngle) * driftSpeed * 5,
    }
  }
  const range = speedProfile[attitude]
  const midSpeed = Math.round((range.min + range.max) / 2)
  const vec = orientationToVector(orientation)
  return {
    x: pos.x + vec.dx * midSpeed,
    y: pos.y + vec.dy * midSpeed,
  }
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

  const TERRAIN_RELIEF_BONUS = 0.3
  const currentTerrainDist = terrain.length > 0 ? minEdgeDistance(unit.position, terrain) : Infinity

  const planScores = plans.map((plan) => {
    const newState = applyMovementPlan(unit, plan, windDirection, tableWidth, tableHeight)
    const testUnit: Unit = { ...unit, ...newState, attitude: newState.attitude }
    let score = evaluatePosition(testUnit, enemies, terrain, tableWidth, tableHeight)
    if (newState.hitBoundary) {
      score += BOUNDARY_PENALTY
    }
    if (terrain.length > 0) {
      const newDist = minEdgeDistance(newState.position, terrain)
      if (newDist > currentTerrainDist) {
        score += (newDist - currentTerrainDist) * TERRAIN_RELIEF_BONUS
      }
    }

    const dx = newState.position.x - unit.position.x
    const dy = newState.position.y - unit.position.y
    const moveDist = Math.sqrt(dx * dx + dy * dy)

    let nearestEnemyDir: { x: number; y: number } | null = null
    if (enemies.length > 0) {
      const nearestEnemy = enemies.reduce((a, b) =>
        distance(newState.position, a.position) < distance(newState.position, b.position) ? a : b,
      )
      const toEnemyX = nearestEnemy.position.x - unit.position.x
      const toEnemyY = nearestEnemy.position.y - unit.position.y
      nearestEnemyDir = { x: toEnemyX, y: toEnemyY }

      if (moveDist > 0) {
        const toEnemyDist = Math.sqrt(toEnemyX * toEnemyX + toEnemyY * toEnemyY)
        const dot = (dx * toEnemyX + dy * toEnemyY) / (moveDist * toEnemyDist)

        if (unit.aiStyle === 'defensive') {
          const curDist = distance(unit.position, nearestEnemy.position)
          const newDist = distance(newState.position, nearestEnemy.position)
          score += (newDist - curDist) * 0.1 + 10
        } else if (unit.aiStyle === 'cautious') {
          score += dot * moveDist * 0.8
          score += (1 - Math.abs(dot)) * moveDist * 0.15 + 10
        } else {
          score += dot * moveDist * 3
        }
      }
    }

    if (moveDist > 0 || plan.totalTurnPoints > 0) {
      score += scoreHeadingTowardEdge(newState.position, newState.orientation, tableWidth, tableHeight, unit.aiStyle, nearestEnemyDir)
    }

    const orientChange = Math.abs(((newState.orientation - unit.orientation) % 32 + 32) % 32)
    const orientCost = Math.min(orientChange, 32 - orientChange)
    score += moveDist * 0.5 + orientCost * 2

    const projectedPos = projectNextPosition(
      newState.position,
      newState.orientation,
      newState.attitude,
      newState.isInIrons,
      unit.speedProfile,
      unit.driftSpeed ?? 10,
      windDirection,
    )

    if (
      projectedPos.x < 0 || projectedPos.x > tableWidth ||
      projectedPos.y < 0 || projectedPos.y > tableHeight
    ) {
      score += FUTURE_BOUNDARY_PENALTY
    }

    const projectedPos2 = projectNextPosition(
      projectedPos,
      newState.orientation,
      newState.attitude,
      newState.isInIrons,
      unit.speedProfile,
      unit.driftSpeed ?? 10,
      windDirection,
    )

    if (
      projectedPos2.x < 0 || projectedPos2.x > tableWidth ||
      projectedPos2.y < 0 || projectedPos2.y > tableHeight
    ) {
      score += FUTURE_BOUNDARY_PENALTY * LOOKAHEAD_DISCOUNT
    }

    score += scoreEdgeProximity(projectedPos, tableWidth, tableHeight, unit.aiStyle) * LOOKAHEAD_DISCOUNT
    score += scoreHeadingTowardEdge(projectedPos, newState.orientation, tableWidth, tableHeight, unit.aiStyle, nearestEnemyDir) * LOOKAHEAD_DISCOUNT

    score += scoreEdgeProximity(projectedPos2, tableWidth, tableHeight, unit.aiStyle) * LOOKAHEAD_DISCOUNT * LOOKAHEAD_DISCOUNT

    if (enemies.length > 0) {
      const projectedEnemies = enemies.map((e) => {
        const eRange = e.speedProfile[e.attitude]
        const eSpeed = Math.round((eRange.min + eRange.max) / 2)
        const eVec = orientationToVector(e.orientation)
        let ePos = { x: e.position.x + eVec.dx * eSpeed, y: e.position.y + eVec.dy * eSpeed }
        if (e.isInIrons) {
          const driftDir = (windDirection + 8) % 32
          const driftAngle = (driftDir * Math.PI / 16) - Math.PI / 2
          ePos = {
            x: e.position.x + Math.cos(driftAngle) * (e.driftSpeed ?? 10) * 5,
            y: e.position.y + Math.sin(driftAngle) * (e.driftSpeed ?? 10) * 5,
          }
        }
        return { ...e, position: ePos }
      })

      const futureUnit: Unit = {
        ...unit,
        position: projectedPos,
        orientation: newState.orientation,
        attitude: newState.attitude,
        isInIrons: newState.isInIrons,
      }
      const futureScore = evaluatePosition(futureUnit, projectedEnemies, terrain, tableWidth, tableHeight)
      score += futureScore * LOOKAHEAD_DISCOUNT
    }

    return score
  })

  return selectPlan(plans, planScores, difficulty)
}
