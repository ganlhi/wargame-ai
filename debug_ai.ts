import type { Unit, GameState, MovementPlan, Attitude, AIStyle } from './src/types'
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
    orientation: 0,
    status: 'active',
    aiStyle: 'aggressive' as AIStyle,
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

function makeAIShip(style: AIStyle): Unit {
  return {
    id: 'ai-1',
    name: `AI Ship (${style})`,
    side: 'ai',
    position: { x: 879, y: 229 },
    orientation: 23,
    status: 'active',
    aiStyle: style,
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
    `enemyAngle=${Math.round(angle)}°`
  )
}

function runStyle(style: AIStyle, turns: number) {
  const player = makePlayerShip()
  let ai = makeAIShip(style)
  const terrain: { vertices: { x: number; y: number }[]; type: string }[] = []

  console.log(`\n========== ${style.toUpperCase()} ==========`)
  console.log('Wind: SEbS (13) | Table: 900x900mm')
  printState(ai, player, 0)

  for (let turn = 1; turn <= turns; turn++) {
    const plan = suggestMovement(ai, [player, ai], terrain, 13, 900, 900, ai.prevAttitude, 1)
    if (!plan) { console.log('No plan!'); break }

    const result = applyMovementPlan(ai, plan, 13, 900, 900)
    const prevAtt = ai.attitude
    ai = {
      ...ai,
      position: result.position,
      orientation: result.orientation,
      attitude: result.attitude,
      prevAttitude: prevAtt,
      isInIrons: result.isInIrons,
    }

    const dist = distance(ai.position, player.position)
    const planDesc = plan.chunks.map((c, ci) =>
      `${Math.round(c.distance)}mm${c.turn ? ` ${c.turn.direction === 'port' ? 'L' : 'R'}${c.turn.points}` : ''}`
    ).join(' → ')
    console.log(
      `T${turn}: →(${Math.round(ai.position.x)},${Math.round(ai.position.y)}) ` +
      `ori=${ai.orientation}(${COMPASS[ai.orientation]}) ` +
      `dist=${Math.round(dist)}mm ` +
      `plan: ${planDesc}`
    )
  }
}

runStyle('aggressive', 12)
runStyle('cautious', 12)
runStyle('defensive', 12)
