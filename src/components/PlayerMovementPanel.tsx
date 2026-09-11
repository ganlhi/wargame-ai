import { useState, useCallback, useEffect, useMemo } from 'react'
import type { Unit, MovementPlan, MoveChunk } from '../types'
import { useGameStore } from '../stores/gameStore'
import { computeAttitude, ATTITUDE_LABELS } from '../utils/attitude'
import {
  splitMovement, computeEffectiveMaxSpeed, minMoveDistance, buildTackPlan, canTack, scaleSpeed,
} from '../game/movement'
import { Select } from './Select'

const TURN_DIRECTION_OPTIONS = [
  { value: '', label: 'No turn', shortLabel: '–' },
  { value: 'port', label: '← Port', shortLabel: '←P' },
  { value: 'starboard', label: '→ Starboard', shortLabel: '→S' },
]

interface Props {
  unit: Unit
}

export function PlayerMovementPanel({ unit }: Props) {
  const setPlayerOrder = useGameStore((s) => s.setPlayerOrder)
  const windDirection = useGameStore((s) => s.currentGame?.windDirection ?? 0)
  const currentPhase = useGameStore((s) => s.currentGame?.currentPhase)
  const attitude = computeAttitude(windDirection, unit.orientation, unit.foreAndAftRigged)

  // Mid-tack the ship has no decision to make: it keeps swinging the same way
  // under no sail until it is beating on the new tack, so the order is forced.
  const tacking = unit.isInIrons
  const isEditable = currentPhase === 'orders' && !tacking
  const mayTack = currentPhase === 'orders' && canTack(unit, unit.prevAttitude)
  const tackPlan = useMemo(
    () => (tacking || mayTack ? buildTackPlan(unit, windDirection) : null),
    [tacking, mayTack, unit, windDirection],
  )

  // A forced tack still has to reach the resolve step, so write it in as soon
  // as the orders phase opens rather than waiting for the player to confirm
  // something they cannot change.
  useEffect(() => {
    if (currentPhase !== 'orders' || !tacking || unit.playerOrder?.isTack || !tackPlan) return
    setPlayerOrder(unit.id, tackPlan)
  }, [currentPhase, tacking, unit.playerOrder, unit.id, tackPlan, setPlayerOrder])

  const [expanded, setExpanded] = useState(false)

  const existingOrder = unit.playerOrder

  const [totalDist, setTotalDist] = useState(() => {
    if (existingOrder) return existingOrder.chunks.reduce((s, c) => s + c.distance, 0)
    return 0
  })

  const [turns, setTurns] = useState<
    { direction: 'port' | 'starboard' | ''; points: number }[]
  >(() => {
    if (existingOrder) {
      return existingOrder.chunks.map((c) => ({
        direction: c.turn?.direction ?? '',
        points: c.turn?.points ?? 0,
      }))
    }
    return Array.from({ length: 5 }, () => ({ direction: '' as const, points: 0 }))
  })

  const chunkDists = useMemo(() => splitMovement(totalDist), [totalDist])

  // Turn points cost 5% of top speed each, so the ceiling depends on the plan
  // being built — it drops live as turns are added. The floor is half of last
  // turn's distance (half the maximum if the ship has yet to move) and is fixed
  // for the turn, so a heavily-turning plan can push the ceiling below it: that
  // combination is simply not a legal order.
  const totalTurnPoints = useMemo(
    () => turns.reduce((sum, t) => sum + (t.direction ? t.points : 0), 0),
    [turns],
  )
  const baseMax = Math.round(scaleSpeed(unit.speedProfile[attitude].max, unit.speedMultiplier))
  const maxDist = Math.floor(computeEffectiveMaxSpeed(baseMax, totalTurnPoints))
  const minDist = Math.ceil(minMoveDistance(unit.prevMoveDistance, baseMax))
  const outOfRange = totalDist < minDist || totalDist > maxDist

  const updateTurn = useCallback(
    (index: number, field: string, value: number | string) => {
      setTurns((prev) => {
        const next = prev.map((t) => ({ ...t }))
        ;(next[index] as Record<string, unknown>)[field] = value
        return next
      })
    },
    [],
  )

  const handleApply = useCallback(() => {
    const planChunks = chunkDists.map(
      (d, i) =>
        ({
          distance: d,
          ...(turns[i].direction
            ? { turn: { direction: turns[i].direction as 'port' | 'starboard', points: turns[i].points } }
            : {}),
        }) as MoveChunk,
    ) as [MoveChunk, MoveChunk, MoveChunk, MoveChunk, MoveChunk]

    const plan: MovementPlan = {
      chunks: planChunks,
      totalTurnPoints,
      effectiveMaxSpeed: totalDist,
    }

    setPlayerOrder(unit.id, plan)
    setExpanded(false)
  }, [chunkDists, turns, totalTurnPoints, totalDist, setPlayerOrder, unit.id])

  const handleClear = useCallback(() => {
    setTotalDist(0)
    setTurns(Array.from({ length: 5 }, () => ({ direction: '' as const, points: 0 })))
    setPlayerOrder(unit.id, null)
  }, [setPlayerOrder, unit.id])

  const planString = existingOrder?.isTack
    ? `Tack: ${existingOrder.totalTurnPoints} pt${existingOrder.totalTurnPoints === 1 ? '' : 's'}, drifting`
    : existingOrder
    ? existingOrder.chunks
        .map(
          (c) =>
            `${Math.round(c.distance)}mm${c.turn ? ` ${c.turn.direction === 'port' ? '←' : '→'}${c.turn.points}` : ''}`,
        )
        .join(' → ')
    : null

  return (
    <div className="bg-gray-900/90 border border-gray-700 rounded-lg p-3 pointer-events-auto backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-white truncate">{unit.name}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/30 text-blue-300 shrink-0">Player</span>
          {unit.status !== 'active' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 shrink-0 capitalize">{unit.status}</span>
          )}
        </div>
        {isEditable && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-400 hover:text-blue-300 shrink-0 ml-2 cursor-pointer"
          >
            {expanded ? '▲' : 'Edit'}
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {ATTITUDE_LABELS[attitude]}
        {tacking && unit.tackDirection
          ? ` · tacking to ${unit.tackDirection}`
          : unit.isInIrons
            ? ' (in irons)'
            : ''}
      </p>

      {tacking && tackPlan && (
        <p className="text-xs text-amber-400 mt-0.5">
          Coming about: {tackPlan.totalTurnPoints} pt{tackPlan.totalTurnPoints === 1 ? '' : 's'} to{' '}
          {unit.tackDirection}, drifting {unit.driftSpeed}mm downwind. No sail until she's beating
          on the new tack.
        </p>
      )}

      {mayTack && tackPlan && (
        <div className="mt-1.5">
          <button
            onClick={() => setPlayerOrder(unit.id, tackPlan)}
            className={`w-full text-xs px-2 py-1.5 rounded border transition-colors cursor-pointer ${
              unit.playerOrder?.isTack
                ? 'bg-amber-600/30 border-amber-700 text-amber-200'
                : 'border-amber-800 text-amber-400 hover:text-amber-300'
            }`}
          >
            {unit.playerOrder?.isTack ? '⟳ Tacking declared' : '⟳ Declare tack'}
          </button>
          <p className="text-xs text-gray-600 mt-0.5">
            Turns {tackPlan.totalTurnPoints} pt{tackPlan.totalTurnPoints === 1 ? '' : 's'} into the
            wind, no way on, drifting downwind until she's beating on the other side.
          </p>
        </div>
      )}
      {planString ? (
        <p className="text-xs text-gray-400 mt-0.5 break-all">{planString}</p>
      ) : (
        <p className="text-xs text-gray-600 mt-0.5 italic">No movement plan</p>
      )}
      {expanded && isEditable && (
        <div className="mt-2 space-y-1 border-t border-gray-700 pt-2">
          <div className="mb-2">
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-500">Total:</span>
              <input
                type="number"
                min={0}
                value={totalDist}
                onChange={(e) => setTotalDist(Math.max(0, Number(e.target.value)))}
                className={`w-16 bg-gray-800 border rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 ${
                  outOfRange
                    ? 'border-red-700 text-red-300 focus:ring-red-500'
                    : 'border-gray-700 text-gray-200 focus:ring-blue-500'
                }`}
              />
              <span className="text-gray-500">mm</span>
              <button
                type="button"
                onClick={() => setTotalDist(minDist)}
                className="ml-auto text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-1 py-0.5 cursor-pointer"
                title="Set to the minimum"
              >
                min
              </button>
              <button
                type="button"
                onClick={() => setTotalDist(maxDist)}
                className="text-gray-500 hover:text-gray-300 border border-gray-700 rounded px-1 py-0.5 cursor-pointer"
                title="Set to the maximum"
              >
                max
              </button>
            </div>
            <p className={`text-xs mt-1 ${outOfRange ? 'text-red-400' : 'text-gray-500'}`}>
              Min <span className="text-gray-300">{minDist}mm</span>
              {' · '}
              Max <span className="text-gray-300">{maxDist}mm</span>
              {totalTurnPoints > 0 && (
                <span className="text-gray-600"> ({baseMax}mm &minus;{totalTurnPoints * 5}% for {totalTurnPoints} turn pt{totalTurnPoints === 1 ? '' : 's'})</span>
              )}
            </p>
            <p className="text-xs text-gray-600">
              {unit.prevMoveDistance === null
                ? 'Min is half the maximum — this ship has not moved yet.'
                : `Min is half of last turn's ${Math.round(unit.prevMoveDistance)}mm.`}
            </p>
            {minDist > maxDist && (
              <p className="text-xs text-red-400 mt-0.5">
                Too many turn points: the ceiling has dropped below the minimum move.
              </p>
            )}
          </div>
          {turns.map((turn, i) => (
            <div key={i} className="flex items-center gap-0.5 text-xs">
              <span className="text-gray-500 w-8 shrink-0">{i + 1}:</span>
              <span className="text-gray-400 w-10 text-right">{chunkDists[i]}mm</span>
              <span className="text-gray-600 mx-0.5">→</span>
              <Select
                value={turn.direction}
                onChange={(direction) => updateTurn(i, 'direction', direction)}
                size="sm"
                className="w-14"
                ariaLabel={`Chunk ${i + 1} turn direction`}
                options={TURN_DIRECTION_OPTIONS}
              />
              {turn.direction && (
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={turn.points}
                  onChange={(e) => updateTurn(i, 'points', Number(e.target.value))}
                  className="w-10 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              )}
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleApply}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs transition-colors cursor-pointer"
            >
              Apply
            </button>
            <button
              onClick={handleClear}
              className="text-red-400 hover:text-red-300 border border-red-800 px-3 py-1 rounded text-xs transition-colors cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
