import { describe, it, expect } from 'vitest'
import { computeAttitude } from './attitude'
import type { Attitude } from '../types'

describe('computeAttitude', () => {
  it('maps points off the wind to the attitude bands (wind = 0)', () => {
    const cases: [number, Attitude][] = [
      [0, 'in_irons'],
      [4, 'in_irons'],
      [5, 'beating'],
      [7, 'beating'],
      [8, 'reaching'],
      [9, 'reaching'],
      [10, 'quarter_reaching'],
      [13, 'quarter_reaching'],
      [14, 'running'],
      [16, 'running'],
    ]
    for (const [orientation, expected] of cases) {
      expect(computeAttitude(0, orientation)).toBe(expected)
    }
  })

  it('is symmetric about the wind axis (port vs starboard tack are equivalent)', () => {
    for (let orientation = 0; orientation < 32; orientation++) {
      const mirrored = (32 - orientation) % 32
      expect(computeAttitude(0, mirrored)).toBe(computeAttitude(0, orientation))
    }
  })

  it('handles wrap-around when wind - orientation goes negative', () => {
    // wind=0, orientation=24 is 8 points off the wind the "short way" round.
    expect(computeAttitude(0, 24)).toBe('reaching')
    expect(computeAttitude(0, 8)).toBe('reaching')
  })

  it('handles wrap-around for a non-zero wind direction', () => {
    // wind=30, orientation=2 are 4 points apart across the 0 boundary.
    expect(computeAttitude(30, 2)).toBe('in_irons')
    // 8 points apart -> reaching, also wrapping past 0.
    expect(computeAttitude(30, 6)).toBe('reaching')
  })

  it('gives the same result regardless of how many full turns the wind is offset', () => {
    for (let orientation = 0; orientation < 32; orientation++) {
      expect(computeAttitude(32, orientation)).toBe(computeAttitude(0, orientation))
    }
  })
})
