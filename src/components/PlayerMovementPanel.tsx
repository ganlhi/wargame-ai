import { useState, useCallback, useMemo } from 'react'
import type { Unit, MovementPlan, MoveChunk } from '../types'
import { useGameStore } from '../stores/gameStore'
import { computeAttitude, ATTITUDE_LABELS } from '../utils/attitude'
import { splitMovement } from '../game/movement'

interface Props {
  unit: Unit
}

export function PlayerMovementPanel({ unit }: Props) {
  const setPlayerOrder = useGameStore((s) => s.setPlayerOrder)
  const windDirection = useGameStore((s) => s.currentGame?.windDirection ?? 0)
  const currentPhase = useGameStore((s) => s.currentGame?.currentPhase)
  const isEditable = currentPhase === 'orders'
  const attitude = computeAttitude(windDirection, unit.orientation)

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

    const totalTurnPts = turns.reduce((s, t) => s + (t.direction ? t.points : 0), 0)

    const plan: MovementPlan = {
      chunks: planChunks,
      totalTurnPoints: totalTurnPts,
      effectiveMaxSpeed: totalDist,
    }

    setPlayerOrder(unit.id, plan)
    setExpanded(false)
  }, [chunkDists, turns, totalDist, setPlayerOrder, unit.id])

  const handleClear = useCallback(() => {
    setTotalDist(0)
    setTurns(Array.from({ length: 5 }, () => ({ direction: '' as const, points: 0 })))
    setPlayerOrder(unit.id, null)
  }, [setPlayerOrder, unit.id])

  const planString = existingOrder
    ? existingOrder.chunks
        .map(
          (c, i) =>
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
      <p className="text-xs text-gray-500 mt-1">{ATTITUDE_LABELS[attitude]}{unit.isInIrons ? ' (in irons)' : ''}</p>
      {planString ? (
        <p className="text-xs text-gray-400 mt-0.5 break-all">{planString}</p>
      ) : (
        <p className="text-xs text-gray-600 mt-0.5 italic">No movement plan</p>
      )}
      {expanded && isEditable && (
        <div className="mt-2 space-y-1 border-t border-gray-700 pt-2">
          <div className="flex items-center gap-1 text-xs mb-2">
            <span className="text-gray-500">Total:</span>
            <input
              type="number"
              min={0}
              value={totalDist}
              onChange={(e) => setTotalDist(Math.max(0, Number(e.target.value)))}
              className="w-16 bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-gray-500">mm</span>
          </div>
          {turns.map((turn, i) => (
            <div key={i} className="flex items-center gap-0.5 text-xs">
              <span className="text-gray-500 w-8 shrink-0">{i + 1}:</span>
              <span className="text-gray-400 w-10 text-right">{chunkDists[i]}mm</span>
              <span className="text-gray-600 mx-0.5">→</span>
              <select
                value={turn.direction}
                onChange={(e) => updateTurn(i, 'direction', e.target.value)}
                className="w-12 bg-gray-800 border border-gray-700 rounded px-1 py-1 text-gray-200 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <option value="">-</option>
                <option value="port">←P</option>
                <option value="starboard">→S</option>
              </select>
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
