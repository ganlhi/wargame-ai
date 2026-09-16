import { COMPASS_16 } from '../utils/coordinates'
import type { Bearing } from '../utils/coordinates'
import { Select } from './Select'

const DIRECTION_OPTIONS = COMPASS_16.map((label, value) => ({ value: String(value), label }))

interface BearingInputProps {
  value: Bearing
  onChange: (bearing: Bearing) => void
  disabled?: boolean
}

/**
 * Enter a position the way it is read across the table: so many millimetres
 * in such a direction from the origin ship. The rose is the 16-point one —
 * a bearing eyeballed across a table is not accurate to a degree.
 */
export function BearingInput({ value, onChange, disabled }: BearingInputProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Distance (mm)</label>
        <input
          type="number"
          min={0}
          value={Math.round(value.distance)}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, distance: Math.max(0, Math.round(Number(e.target.value))) })}
          className="w-full min-w-0 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Direction</label>
        <Select
          value={String(value.direction)}
          onChange={(next) => onChange({ ...value, direction: Number(next) })}
          ariaLabel="Direction from the origin ship"
          className={`w-full ${disabled ? 'pointer-events-none opacity-40' : ''}`}
          options={DIRECTION_OPTIONS}
        />
      </div>
    </div>
  )
}
