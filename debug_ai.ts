import type { Unit, GameState, MovementPlan, Attitude } from './src/types'
import { suggestMovement, evaluatePosition } from './src/game/ai'
import { applyMovementPlan, enumerateMovementPlans } from './src/game/movement'
import { computeAttitude } from './src/utils/attitude'

const defaultProfile: Record<Attitude, { min: number; max: number }> = {
  in_irons: { min: 0, max: 0 },
  beating: { min: 20, max: 60 },
  reaching: { min: 40, max: 100 },
  quarter_reaching: { min: 60, max: 120 },
  running: { min: 50, max: 110 },
}

function makePlayerShip(): Unit {
  return {
    id: 'player-1',
    name: 'Player Ship',
    side: 'player',
    position: { x: 168, y: 826 },
    orientation: 0, // facing North
    status: 'active',
    aiStyle: 'aggressive',
    maxTurnPoints: 6,
    speedProfile: { ...defaultProfile },
    driftSpeed: 10,
    firingArcs: [
      { id: 'port', side: 'port', maxRange: 300 },
      { id: 'starboard', side: 'starboard', maxRange: 300 },
    ],
    attitude: computeAttitude(13, 0),
    isInIrons: false,
    prevAttitude: computeAttitude(13, 0),
    hiddenAIOrder: null,
  }
}

function makeAIShip(): Unit {
  return {
    id: 'ai-1',
    name: 'AI Ship',
    side: 'ai',
    position: { x: 879, y: 229 },
    orientation: 23, // WbS
    status: 'active',
    aiStyle: 'aggressive',
    maxTurnPoints: 6,
    speedProfile: { ...defaultProfile },
    driftSpeed: 10,
    firingArcs: [
      { id: 'port', side: 'port', maxRange: 300 },
      { id: 'starboard', side: 'starboard', maxRange: 300 },
    ],
    attitude: computeAttitude(13, 23),
    isInIrons: false,
    prevAttitude: computeAttitude(13, 23),
    hiddenAIOrder: null,
  }
}

function makeState(): GameState {
  return {
    id: 'test',
    name: 'Test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tableWidth: 900,
    tableHeight: 900,
    windDirection: 13, // SEbS
    terrain: [],
    units: [makePlayerShip(), makeAIShip()],
    currentTurn: 1,
    currentPhase: 'orders',
    actionLog: [],
  }
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

const COMPASS: Record<number, string> = {
  0: 'N', 1: 'NbE', 2: 'NNE', 3: 'NEbN', 4: 'NE', 5: 'NEbE', 6: 'ENE', 7: 'EbN',
  8: 'E', 9: 'EbS', 10: 'ESE', 11: 'SEbE', 12: 'SE', 13: 'SEbS', 14: 'SSE', 15: 'SbE',
  16: 'S', 17: 'SbW', 18: 'SSW', 19: 'SWbS', 20: 'SW', 21: 'SWbW', 22: 'WSW', 23: 'WbS',
  24: 'W', 25: 'WbN', 26: 'WNW', 27: 'NWbW', 28: 'NW', 29: 'NWbN', 30: 'NNW', 31: 'NbW',
}

const ATTITUDE_LABELS: Record<Attitude, string> = {
  in_irons: 'Irons',
  beating: 'Beat',
  reaching: 'Reach',
  quarter_reaching: 'QReach',
  running: 'Run',
}

function printState(ai: Unit, player: Unit, turn: number) {
  const dist = distance(ai.position, player.position)
  const angle = angleBetweenPoints(ai.position, player.position)
  const hdg = headingDeg(ai.orientation)
  const att = computeAttitude(13, ai.orientation)
  console.log(
    `T${turn} AI@(${Math.round(ai.position.x)},${Math.round(ai.position.y)}) ` +
    `ori=${ai.orientation}(${COMPASS[ai.orientation]}) hdg=${Math.round(hdg)}° ` +
    `att=${ATTITUDE_LABELS[att]} ` +
    `dist=${Math.round(dist)}mm ` +
    `enemyAngle=${Math.round(angle)}° ` +
    `irons=${ai.isInIrons}`
  )
}

function run() {
  const state = makeState()
  const player = state.units.find(u => u.side === 'player')!
  let ai = state.units.find(u => u.side === 'ai')!
  const terrain: { vertices: { x: number; y: number }[]; type: string }[] = []

  console.log('=== Initial State ===')
  console.log('Wind: SEbS (point 13)')
  console.log('Table: 900x900mm')
  printState(ai, player, 0)

  for (let turn = 1; turn <= 10; turn++) {
    console.log(`\n=== Turn ${turn} ===`)

    const plan = suggestMovement(
      ai,
      state.units,
      terrain,
      state.windDirection,
      state.tableWidth,
      state.tableHeight,
      ai.prevAttitude,
      1, // full difficulty
    )

    if (!plan) {
      console.log('No plan returned!')
      break
    }

    const enemies = state.units.filter(u => u.side !== ai.side && u.status !== 'destroyed' && u.status !== 'surrendered')
    
    // Score all plans for debugging (matching suggestMovement exactly)
    const allPlans = enumerateMovementPlans(ai, state.windDirection, ai.prevAttitude)
    const planScores = allPlans.map(p => {
      const ns = applyMovementPlan(ai, p, state.windDirection, state.tableWidth, state.tableHeight)
      const testUnit: Unit = { ...ai, ...ns, attitude: ns.attitude }
      let score = evaluatePosition(testUnit, enemies, terrain, state.tableWidth, state.tableHeight)
      if (ns.hitBoundary) score -= 500
      const dx = ns.position.x - ai.position.x
      const dy = ns.position.y - ai.position.y
      const moveDist = Math.sqrt(dx*dx + dy*dy)
      if (moveDist > 0 && enemies.length > 0) {
        const nearestEnemy = enemies.reduce((a,b)=>distance(ns.position,a.position)<distance(ns.position,b.position)?a:b)
        const toEnemyX = nearestEnemy.position.x - ai.position.x
        const toEnemyY = nearestEnemy.position.y - ai.position.y
        const toEnemyDist = Math.sqrt(toEnemyX*toEnemyX + toEnemyY*toEnemyY)
        const dot = (dx*toEnemyX + dy*toEnemyY) / (moveDist * toEnemyDist)
        score += dot * moveDist * 3
      }
      return score
    })
    
    // Show top 5 plans
    const scored = allPlans.map((p, i) => ({ plan: p, score: planScores[i] }))
    scored.sort((a, b) => b.score - a.score)
    console.log('Top 5 plans:')
    for (let i = 0; i < Math.min(5, scored.length); i++) {
      const s = scored[i]
      const ns = applyMovementPlan(ai, s.plan, state.windDirection, state.tableWidth, state.tableHeight)
      const newDist = distance(ns.position, player.position)
      const newAtt = computeAttitude(13, ns.orientation)
      const turnStr = s.plan.chunks.map((c, ci) => 
        `${Math.round(c.distance)}mm${c.turn ? ` ${c.turn.direction === 'port' ? 'L' : 'R'}${c.turn.points}` : ''}`
      ).join(' → ')
      console.log(`  #${i+1} score=${Math.round(s.score)} dist=${Math.round(newDist)}mm ` +
        `pos=(${Math.round(ns.position.x)},${Math.round(ns.position.y)}) ` +
        `ori=${ns.orientation}(${COMPASS[ns.orientation]}) ` +
        `att=${ATTITUDE_LABELS[newAtt]} hit=${ns.hitBoundary} | ${turnStr}`)
    }

    // Apply selected plan
    const result = applyMovementPlan(ai, plan, state.windDirection, state.tableWidth, state.tableHeight)
    const prevAtt = ai.attitude
    ai = {
      ...ai,
      position: result.position,
      orientation: result.orientation,
      attitude: result.attitude,
      prevAttitude: prevAtt,
      isInIrons: result.isInIrons,
    }
    state.units = state.units.map(u => u.id === ai.id ? ai : u)
    
    printState(ai, player, turn)
    
    // Check if AI reached close range
    const dist = distance(ai.position, player.position)
    if (dist < 65) {
      console.log(`\n=== AI REACHED CLOSE RANGE (${Math.round(dist)}mm) ===`)
      break
    }
  }
}

run()
