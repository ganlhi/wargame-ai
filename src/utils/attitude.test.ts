import { describe, it, expect } from 'vitest'
import {
  COMPASS_LABELS, computeAttitude, inIronsLimit, pointsOffWind, windTowardPoint,
} from './attitude'
import type { Attitude } from '../types'

const SQUARE = false
const FORE_AND_AFT = true

describe('pointsOffWind', () => {
  it('counts 0 head to wind and 16 dead downwind', () => {
    expect(pointsOffWind(0, 0)).toBe(0)
    expect(pointsOffWind(0, 16)).toBe(16)
  })

  it('is symmetric: both tacks give the same number', () => {
    for (let orientation = 0; orientation < 32; orientation++) {
      expect(pointsOffWind(0, (32 - orientation) % 32)).toBe(pointsOffWind(0, orientation))
    }
  })

  it('wraps around the compass', () => {
    // wind=30, orientation=2 are 4 points apart across the 0 boundary.
    expect(pointsOffWind(30, 2)).toBe(4)
    expect(pointsOffWind(0, 24)).toBe(8)
  })
})

describe('computeAttitude — square rig (the default)', () => {
  it('maps points off the wind to the attitude bands (wind = 0)', () => {
    const cases: [number, Attitude][] = [
      [0, 'in_irons'],
      [4, 'in_irons'],
      // A square rig cannot sail at 5 points off the wind: still in irons.
      [5, 'in_irons'],
      [6, 'beating'],
      [7, 'beating'],
      [8, 'reaching'],
      [9, 'reaching'],
      [10, 'quarter_reaching'],
      [13, 'quarter_reaching'],
      [14, 'running'],
      [16, 'running'],
    ]
    for (const [orientation, expected] of cases) {
      expect(computeAttitude(0, orientation, SQUARE)).toBe(expected)
    }
  })

  it('is symmetric about the wind axis (port vs starboard tack are equivalent)', () => {
    for (let orientation = 0; orientation < 32; orientation++) {
      const mirrored = (32 - orientation) % 32
      expect(computeAttitude(0, mirrored, SQUARE)).toBe(computeAttitude(0, orientation, SQUARE))
    }
  })

  it('handles wrap-around when wind - orientation goes negative', () => {
    expect(computeAttitude(0, 24, SQUARE)).toBe('reaching')
    expect(computeAttitude(0, 8, SQUARE)).toBe('reaching')
  })

  it('handles wrap-around for a non-zero wind direction', () => {
    expect(computeAttitude(30, 2, SQUARE)).toBe('in_irons')
    expect(computeAttitude(30, 6, SQUARE)).toBe('reaching')
  })

  it('gives the same result regardless of how many full turns the wind is offset', () => {
    for (let orientation = 0; orientation < 32; orientation++) {
      expect(computeAttitude(32, orientation, SQUARE)).toBe(computeAttitude(0, orientation, SQUARE))
    }
  })
})

describe('computeAttitude — fore-and-aft rig', () => {
  it('points one point higher: beating where a square rig is still in irons', () => {
    expect(computeAttitude(0, 4, FORE_AND_AFT)).toBe('in_irons')
    expect(computeAttitude(0, 5, FORE_AND_AFT)).toBe('beating')
    expect(computeAttitude(0, 5, SQUARE)).toBe('in_irons')
  })

  it('differs from a square rig at exactly 5 points off the wind, and nowhere else', () => {
    for (let orientation = 0; orientation < 32; orientation++) {
      const square = computeAttitude(0, orientation, SQUARE)
      const foreAft = computeAttitude(0, orientation, FORE_AND_AFT)
      if (pointsOffWind(0, orientation) === 5) {
        expect([square, foreAft]).toEqual(['in_irons', 'beating'])
      } else {
        expect(foreAft).toBe(square)
      }
    }
  })

  it('leaves the wider bands alone', () => {
    for (const [orientation, expected] of [
      [8, 'reaching'], [10, 'quarter_reaching'], [16, 'running'],
    ] as [number, Attitude][]) {
      expect(computeAttitude(0, orientation, FORE_AND_AFT)).toBe(expected)
    }
  })
})

describe('the reported case', () => {
  it('puts a square-rigged NWbN ship in irons with the wind blowing toward E', () => {
    // Wind toward E is stored as the point it blows *from*: W (24).
    const windFrom = windTowardPoint(COMPASS_LABELS.indexOf('E'))
    const nwbn = COMPASS_LABELS.indexOf('NWbN')
    expect(pointsOffWind(windFrom, nwbn)).toBe(5)
    expect(computeAttitude(windFrom, nwbn, SQUARE)).toBe('in_irons')
    // A fore-and-aft rig can hold that heading.
    expect(computeAttitude(windFrom, nwbn, FORE_AND_AFT)).toBe('beating')
  })
})

describe('inIronsLimit', () => {
  it('is the last point still in irons for each rig', () => {
    expect(inIronsLimit(SQUARE)).toBe(5)
    expect(inIronsLimit(FORE_AND_AFT)).toBe(4)
  })

  it('agrees with computeAttitude at the boundary, for both rigs', () => {
    for (const rig of [SQUARE, FORE_AND_AFT]) {
      const limit = inIronsLimit(rig)
      expect(computeAttitude(0, limit, rig)).toBe('in_irons')
      expect(computeAttitude(0, limit + 1, rig)).toBe('beating')
    }
  })
})

describe('windTowardPoint', () => {
  it('returns the opposite compass point (180°) and wraps around', () => {
    expect(windTowardPoint(0)).toBe(16) // from N → toward S
    expect(windTowardPoint(8)).toBe(24) // from E → toward W
    expect(windTowardPoint(16)).toBe(0) // from S → toward N
    expect(windTowardPoint(24)).toBe(8) // from W → toward E
  })

  it('maps "from North" to a "toward South" label', () => {
    expect(COMPASS_LABELS[windTowardPoint(0)]).toBe('S')
  })
})
