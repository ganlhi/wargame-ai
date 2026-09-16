import { useGameStore } from '../stores/gameStore'
import { applyMovementPlan, planSailedDistance } from '../game/movement'
import { COMPASS_LABELS } from '../utils/attitude'
import { formatBearing, formatDisplacement, originName, toBearing } from '../utils/coordinates'
import type { GameState, Unit } from '../types'

const STYLE_BADGE: Record<Unit['aiStyle'], string> = {
  aggressive: 'bg-red-900/50 text-red-300',
  cautious: 'bg-yellow-900/50 text-yellow-300',
  defensive: 'bg-blue-900/50 text-blue-300',
}

/**
 * The AI's revealed orders, one card a ship, written the way the player will
 * carry them out on the table: the whole move first, then the five steps with
 * each turn at the end of the step it belongs to, then what to check once the
 * model has been moved — her final heading, where she ends relative to where
 * she started, and her bearing from the origin ship once the orders are done.
 */

/**
 * Where the origin ship stands once this turn's orders are carried out. The
 * player's ships have already been moved by the time the orders are laid, so
 * a player origin is where she was entered; an AI origin ends where her own
 * order leaves her.
 */
function originAfterOrders(game: GameState): { x: number; y: number } | null {
  const origin = game.units.find((u) => u.id === game.originId)
  if (!origin) return null
  const plan = origin.side === 'ai' ? origin.aiOrder : null
  return plan ? applyMovementPlan(origin, plan, game.windDirection).position : origin.position
}
export function AIOrdersPanel() {
  const currentGame = useGameStore((s) => s.currentGame)
  if (!currentGame || currentGame.phase !== 'orders') return null

  const ships = currentGame.units.filter(
    (u) => u.side === 'ai' && u.status !== 'destroyed' && u.status !== 'surrendered',
  )
  if (ships.length === 0) return null

  const originEnd = originAfterOrders(currentGame)
  const anchor = originName(currentGame)

  return (
    <div className="absolute right-2 top-2 bottom-2 w-72 max-w-[calc(100vw-1rem)] flex flex-col gap-2 pointer-events-none overflow-y-auto">
      {ships.map((u) => {
        const order = u.aiOrder
        const end = order ? applyMovementPlan(u, order, currentGame.windDirection) : null
        const drifting = !!order && (order.isTack || u.isInIrons)
        const sailed = order ? planSailedDistance(order, u.isInIrons) : 0

        return (
          <div key={u.id} className="bg-gray-900/90 border border-gray-700 rounded-lg p-3 pointer-events-auto backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-white truncate">{u.name}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${STYLE_BADGE[u.aiStyle]}`}>{u.aiStyle}</span>
            </div>

            {!order ? (
              <p className="text-xs text-gray-500 mt-1 italic">No move.</p>
            ) : (
              <>
                <p className="text-xs text-gray-300 mt-1">
                  {drifting ? (
                    <>
                      <span className="text-amber-400">Drifts</span> {u.driftSpeed} mm downwind, no way on
                    </>
                  ) : (
                    <>
                      Sails <span className="text-white font-medium">{sailed} mm</span>
                    </>
                  )}
                  {order.totalTurnPoints > 0 && (
                    <span className="text-gray-400">
                      {' '}· turns {order.totalTurnPoints} pt{order.totalTurnPoints === 1 ? '' : 's'}
                      {order.isTack ? ' (tacking)' : ''}
                    </span>
                  )}
                </p>
                <ol className="mt-1.5 space-y-0.5 text-xs text-gray-400">
                  {order.chunks.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-gray-600 w-3 shrink-0">{i + 1}</span>
                      <span>
                        {drifting ? 'drift' : `${Math.round(c.distance)} mm`}
                        {c.turn && (
                          <span className="text-gray-200">
                            {' '}then {c.turn.points} pt{c.turn.points === 1 ? '' : 's'} to {c.turn.direction}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                {end && (
                  <p className="text-xs text-gray-400 mt-1.5 border-t border-gray-800 pt-1.5">
                    Ends heading <span className="font-mono text-gray-200">{COMPASS_LABELS[end.orientation]}</span>,{' '}
                    {formatDisplacement(u.position, end.position)}
                    {originEnd && u.id !== currentGame.originId && (
                      <>
                        {' '}— <span className="font-mono text-gray-200">{formatBearing(toBearing(end.position, originEnd))}</span>
                        {' '}from {anchor ?? 'the origin ship'}
                      </>
                    )}
                    .
                  </p>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
