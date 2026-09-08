import type { Offset } from '../utils/coordinates'
import { Select } from './Select'

interface AxisProps {
  label: string
  magnitude: number
  sign: string
  positiveLabel: string
  negativeLabel: string
  onChange: (magnitude: number, sign: string) => void
  disabled?: boolean
}

function Axis({ label, magnitude, sign, positiveLabel, negativeLabel, onChange, disabled }: AxisProps) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <div className="flex gap-1.5">
        <input
          type="number"
          min={0}
          value={magnitude}
          disabled={disabled}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value)), sign)}
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
        />
        <Select
          value={sign}
          onChange={(next) => onChange(magnitude, next)}
          ariaLabel={label}
          className={`shrink-0 ${disabled ? 'pointer-events-none opacity-40' : ''}`}
          options={[
            { value: '+', label: positiveLabel },
            { value: '-', label: negativeLabel },
          ]}
        />
      </div>
    </div>
  )
}

interface OffsetInputProps {
  value: Offset
  onChange: (offset: Offset) => void
  disabled?: boolean
}

/**
 * Enter a position as a compass offset from the game's origin entity, which is
 * how it is actually measured at the table: so many millimetres east or west,
 * so many north or south. The sign convention (+east, +south) is an
 * implementation detail kept out of the player's way.
 */
export function OffsetInput({ value, onChange, disabled }: OffsetInputProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Axis
        label="East / West (mm)"
        magnitude={Math.abs(Math.round(value.east))}
        sign={value.east < 0 ? '-' : '+'}
        positiveLabel="East"
        negativeLabel="West"
        disabled={disabled}
        onChange={(m, sign) => onChange({ ...value, east: sign === '-' ? -m : m })}
      />
      <Axis
        label="North / South (mm)"
        magnitude={Math.abs(Math.round(value.south))}
        sign={value.south < 0 ? '-' : '+'}
        positiveLabel="South"
        negativeLabel="North"
        disabled={disabled}
        onChange={(m, sign) => onChange({ ...value, south: sign === '-' ? -m : m })}
      />
    </div>
  )
}
