import { describe, it, expect } from 'vitest'
import { GUN_TYPES, RANGE_BANDS, SCALES, SHIP_TYPES, WIND_STRENGTHS } from '../types'
import {
  DEFAULT_GUN_TYPE, GUN_TYPE_LABELS, SHIP_TYPE_INFO, WIND_STRENGTH_LABELS, driftSpeed,
  gunMaxRange, gunRanges, nearestGunType, nearestShipType, speedProfile, turnPoints,
} from './binder'
import { SAILING_ATTITUDES } from '../utils/attitude'

describe('gun range charts', () => {
  it('has every gun at both scales', () => {
    for (const scale of SCALES) {
      for (const type of GUN_TYPES) {
        expect(gunMaxRange(type, scale), `${type} at ${scale}`).toBeGreaterThan(0)
        expect(GUN_TYPE_LABELS[type]).toBeTruthy()
      }
    }
  })

  it('widens outwards, so every band is reachable', () => {
    for (const scale of SCALES) {
      for (const type of GUN_TYPES) {
        const ranges = gunRanges(type, scale)
        for (let i = 1; i < RANGE_BANDS.length; i++) {
          expect(ranges[RANGE_BANDS[i]], `${type} ${RANGE_BANDS[i]} at ${scale}`)
            .toBeGreaterThan(ranges[RANGE_BANDS[i - 1]])
        }
      }
    }
  })

  it('is printed in centimetres and held in millimetres', () => {
    // Page 1: a 24# long gun at 1/700 reaches 38cm close, 288cm extreme.
    expect(gunRanges('long_24', '1/700')).toEqual({
      point_blank: 20, close: 380, medium: 790, long: 1200, extreme: 2880,
    })
    // Page 2: the same gun at 1/1200, 22cm and 168cm.
    expect(gunRanges('long_24', '1/1200')).toEqual({
      point_blank: 20, close: 220, medium: 460, long: 700, extreme: 1680,
    })
  })

  it('reaches further at the larger scale, gun for gun', () => {
    for (const type of GUN_TYPES) {
      expect(gunMaxRange(type, '1/700')).toBeGreaterThan(gunMaxRange(type, '1/1200'))
    }
  })

  it('keeps the heavier gun the longer-ranged one', () => {
    for (const scale of SCALES) {
      expect(gunMaxRange('long_32', scale)).toBeGreaterThan(gunMaxRange('long_24', scale))
      expect(gunMaxRange('long_24', scale)).toBeGreaterThan(gunMaxRange('long_18', scale))
      // A carronade smashes at close quarters but carries nothing like as far.
      expect(gunMaxRange('carr_32', scale)).toBeLessThan(gunMaxRange('long_32', scale))
    }
  })
})

describe('sailing charts', () => {
  it('rates every ship type in every wind, at both scales', () => {
    for (const scale of SCALES) {
      for (const type of SHIP_TYPES) {
        for (const wind of WIND_STRENGTHS) {
          const profile = speedProfile(type, wind, scale)
          expect(profile.in_irons.max, 'head to wind she makes no way of her own').toBe(0)
          for (const attitude of SAILING_ATTITUDES) {
            expect(profile[attitude].max, `${type} ${attitude} ${wind} ${scale}`).toBeGreaterThan(0)
          }
          expect(driftSpeed(type, wind, scale)).toBeGreaterThan(0)
        }
        expect(turnPoints(type)).toBeGreaterThan(0)
        expect(WIND_STRENGTH_LABELS[WIND_STRENGTHS[0]]).toBeTruthy()
      }
    }
  })

  it('ranks the points of sail as the rules do — quarter reaching best, beating worst', () => {
    for (const scale of SCALES) {
      for (const type of SHIP_TYPES) {
        for (const wind of WIND_STRENGTHS) {
          const p = speedProfile(type, wind, scale)
          expect(p.quarter_reaching.max).toBeGreaterThanOrEqual(p.running.max)
          expect(p.running.max).toBeGreaterThanOrEqual(p.reaching.max)
          expect(p.reaching.max).toBeGreaterThan(p.beating.max)
          expect(p.beating.max).toBeGreaterThan(driftSpeed(type, wind, scale))
        }
      }
    }
  })

  it('reads the charts by category, so ships sharing a row sail alike', () => {
    // Page 11: a 1st rate in a fresh breeze at 1/700 makes 776mm quarter
    // reaching, 391 beating, and drifts 154. A 2nd rate shares the row.
    expect(speedProfile('rate_1', 'fresh_breeze', '1/700')).toEqual({
      in_irons: { max: 0 },
      quarter_reaching: { max: 776 },
      running: { max: 622 },
      reaching: { max: 583 },
      beating: { max: 391 },
    })
    expect(driftSpeed('rate_1', 'fresh_breeze', '1/700')).toBe(154)
    expect(speedProfile('rate_2', 'fresh_breeze', '1/700')).toEqual(
      speedProfile('rate_1', 'fresh_breeze', '1/700'),
    )
  })

  it('turns by type, separating ships the sailing charts rate together', () => {
    // Page 15. The 1st and 2nd rates sail alike but do not turn alike.
    expect(turnPoints('rate_1')).toBe(3)
    expect(turnPoints('rate_2')).toBe(4)
    expect(SHIP_TYPE_INFO.rate_1.category).toBe(SHIP_TYPE_INFO.rate_2.category)
    expect(turnPoints('cutter')).toBe(10)
  })
})

describe('matching figures from before the charts were wired in', () => {
  it('takes the gun that reaches about as far', () => {
    expect(nearestGunType(gunMaxRange('long_18', '1/700'), '1/700')).toBe('long_18')
    // Between two guns, the nearer reach wins — and the same distance means a
    // different gun at a different scale.
    expect(nearestGunType(1680, '1/1200')).toBe('long_24')
    expect(nearestGunType(1680, '1/700')).toBe('long_4')
  })

  it('falls back to the default gun for a reach of nothing', () => {
    expect(nearestGunType(0, '1/1200')).toBe(DEFAULT_GUN_TYPE)
  })

  it('takes the ship whose charted speed is closest, turning breaking a tie', () => {
    for (const type of ['rate_1', 'rate_3', 'brig', 'cutter'] as const) {
      const charted = speedProfile(type, 'gentle_breeze', '1/1200').quarter_reaching.max
      const matched = nearestShipType(charted, turnPoints(type), 'gentle_breeze', '1/1200')
      // Several types can share both a row of the sailing charts and a turning
      // allowance — a cutter and a schooner are the same ship as far as the
      // charts go — so what has to come back is a ship that sails the same,
      // not necessarily the very one the figures came from.
      expect(speedProfile(matched, 'gentle_breeze', '1/1200')).toEqual(
        speedProfile(type, 'gentle_breeze', '1/1200'),
      )
      expect(turnPoints(matched)).toBe(turnPoints(type))
    }
  })

  it('separates a 1st rate from a 2nd by her turning alone', () => {
    const charted = speedProfile('rate_1', 'gale', '1/700').quarter_reaching.max
    expect(nearestShipType(charted, 3, 'gale', '1/700')).toBe('rate_1')
    expect(nearestShipType(charted, 4, 'gale', '1/700')).toBe('rate_2')
  })
})
