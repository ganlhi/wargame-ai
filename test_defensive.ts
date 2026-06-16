import type { Unit, MovementPlan, Attitude, AIStyle, TableTerrain } from './src/types'
import { suggestMovement } from './src/game/ai'
import { applyMovementPlan } from './src/game/movement'
import { computeAttitude } from './src/utils/attitude'

const defaultProfile: Record<Attitude, { max: number }> = {
  in_irons: { max: 0 },
  beating: { max: 60 },
  reaching: { max: 100 },
  quarter_reaching: { max: 120 },
  running: { max: 110 },
}

const island1 = {
  id: 'island1',
  vertices: [{x:215,y:291},{x:225,y:278},{x:226,y:246},{x:242,y:223},{x:248,y:180},{x:273,y:146},{x:299,y:145},{x:311,y:152},{x:313,y:175},{x:330,y:177},{x:390,y:230},{x:394,y:249},{x:389,y:278},{x:390,y:304},{x:394,y:325},{x:385,y:340},{x:361,y:358},{x:333,y:361},{x:322,y:346},{x:305,y:317},{x:292,y:311},{x:279,y:314},{x:276,y:324},{x:261,y:330},{x:244,y:325},{x:239,y:316},{x:239,y:307},{x:221,y:297}],
  type: 'island' as const
}
const island2 = {
  id: 'island2',
  vertices: [{x:582,y:625},{x:596,y:612},{x:602,y:615},{x:624,y:609},{x:644,y:592},{x:658,y:566},{x:666,y:542},{x:674,y:536},{x:679,y:520},{x:687,y:506},{x:687,y:479},{x:690,y:456},{x:706,y:438},{x:716,y:447},{x:716,y:469},{x:707,y:480},{x:707,y:502},{x:705,y:520},{x:714,y:561},{x:713,y:583},{x:702,y:600},{x:686,y:612},{x:667,y:630},{x:649,y:646},{x:631,y:653},{x:614,y:658},{x:600,y:652},{x:591,y:642}],
  type: 'island' as const
}
const terrain = [island1, island2]

function makePlayerShip(): Unit {
  return {
    id: 'player-1', name: 'Foo', side: 'player',
    position: { x: 168, y: 826 }, orientation: 4,
    status: 'active', aiStyle: 'cautious' as AIStyle,
    maxTurnPoints: 6, speedProfile: { ...defaultProfile },
    driftSpeed: 10, firingArcs: [],
    attitude: computeAttitude(13, 4), isInIrons: false,
    prevAttitude: computeAttitude(13, 4),
    prevMoveDistance: 0,
    hiddenAIOrder: null,
    playerOrder: null,
    hiddenAIFirePlan: null,
    lastFireChunk: null,
  }
}

function makeAIShip(style: AIStyle): Unit {
  return {
    id: 'ai-1', name: 'Bar', side: 'ai',
    position: { x: 879, y: 229 }, orientation: 23,
    status: 'active', aiStyle: style,
    maxTurnPoints: 6, speedProfile: { ...defaultProfile },
    driftSpeed: 10,
    firingArcs: [
      { id: 'bow', side: 'bow', maxRange: 120, weapons: 5 },
      { id: 'port', side: 'port', maxRange: 210, weapons: 15 },
      { id: 'starboard', side: 'starboard', maxRange: 210, weapons: 15 },
    ],
    attitude: computeAttitude(13, 23), isInIrons: false,
    prevAttitude: computeAttitude(13, 23),
    prevMoveDistance: 0,
    hiddenAIOrder: null,
    playerOrder: null,
    hiddenAIFirePlan: null,
    lastFireChunk: null,
  }
}

function distance(a: {x:number;y:number}, b: {x:number;y:number}): number {
  return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2)
}

const COMPASS: Record<number, string> = {
  0:'N',1:'NbE',2:'NNE',3:'NEbN',4:'NE',5:'NEbE',6:'ENE',7:'EbN',
  8:'E',9:'EbS',10:'ESE',11:'SEbE',12:'SE',13:'SEbS',14:'SSE',15:'SbE',
  16:'S',17:'SbW',18:'SSW',19:'SWbS',20:'SW',21:'SWbW',22:'WSW',23:'WbS',
  24:'W',25:'WbN',26:'WNW',27:'NWbW',28:'NW',29:'NWbN',30:'NNW',31:'NbW',
}
const ATT_LABELS: Record<Attitude, string> = {
  in_irons:'Iron',beating:'Beat',reaching:'Reach',quarter_reaching:'QReach',running:'Run'
}

const WIND = 13, TW = 900, TH = 900

for (const style of ['defensive', 'aggressive', 'cautious'] as AIStyle[]) {
  console.log(`\n=== ${style.toUpperCase()} ===`)
  console.log(`Wind: ${COMPASS[WIND]} (${WIND}) | Table: ${TW}x${TH}mm`)
  
  let ai = makeAIShip(style)
  const player = makePlayerShip()
  let prevAtt: Attitude | null = ai.attitude
  let stuckCount = 0

  for (let turn = 1; turn <= 30; turn++) {
    const plan = suggestMovement(ai, [ai, player], terrain, WIND, TW, TH, prevAtt, 1)
    if (!plan) { console.log(`T${turn}: No plan!`); break }

    const result = applyMovementPlan(ai, plan, WIND, TW, TH)
    const totalDist = plan.chunks.reduce((s,c) => s + c.distance, 0)
    const planDesc = plan.chunks.map((c,ci) =>
      `${Math.round(c.distance)}mm${c.turn ? ` ${c.turn.direction==='port'?'L':'R'}${c.turn.points}`:''}`
    ).join(' → ')

    const distToPlayer = distance(result.position, player.position)

    if (totalDist === 0) stuckCount++
    else stuckCount = 0

    console.log(
      `T${turn}: →(${Math.round(result.position.x)},${Math.round(result.position.y)}) ` +
      `ori=${result.orientation}(${COMPASS[result.orientation]}) ` +
      `att=${ATT_LABELS[result.attitude]}${result.isInIrons?' IRONS':''} ` +
      `dist=${Math.round(distToPlayer)}mm moved=${totalDist}mm ` +
      `${result.hitBoundary?'HIT_EDGE ':''}${stuckCount>=3?'STUCK! ':''}` +
      `plan: ${planDesc}`
    )

    if (stuckCount >= 3 && totalDist === 0) {
      console.log(`  *** STUCK for ${stuckCount} turns at (${Math.round(result.position.x)},${Math.round(result.position.y)}) ***`)
      if (stuckCount >= 5) break
    }

    prevAtt = ai.attitude
    ai = { ...ai, position: result.position, orientation: result.orientation,
      attitude: result.attitude, prevAttitude: prevAtt, isInIrons: result.isInIrons }
  }
}
