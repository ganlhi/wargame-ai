import { describe, it, expect } from 'vitest'
import {
  arcBestBand, arcEffectiveGuns, arcGunCount, arcMaxRange, bandForDistance,
  RANGE_BAND_MODIFIERS,
} from './index'
import type { FiringArc, GunProfile } from './index'

const longGuns: GunProfile = {
  id: 'g1',
  type: 'long_24',
  guns: 10,
  ranges: { point_blank: 20, close: 100, medium: 200, long: 300, extreme: 400 },
}

/** Heavy but short: carronades smash at close quarters and reach no further. */
const carronades: GunProfile = {
  id: 'g2',
  type: 'carr_32',
  guns: 6,
  ranges: { point_blank: 20, close: 80, medium: 120, long: 150, extreme: 150 },
}

const broadside: FiringArc = { id: 'a', side: 'starboard', guns: [longGuns, carronades] }

describe('bandForDistance', () => {
  it('takes the first band the range is still within', () => {
    expect(bandForDistance(longGuns, 0)).toBe('point_blank')
    expect(bandForDistance(longGuns, 20)).toBe('point_blank')
    expect(bandForDistance(longGuns, 21)).toBe('close')
    expect(bandForDistance(longGuns, 100)).toBe('close')
    expect(bandForDistance(longGuns, 101)).toBe('medium')
    expect(bandForDistance(longGuns, 300)).toBe('long')
    expect(bandForDistance(longGuns, 400)).toBe('extreme')
  })

  it('is out of reach past the extreme range', () => {
    expect(bandForDistance(longGuns, 401)).toBeNull()
  })
})

describe('an arc of mixed guns', () => {
  it('reaches as far as its longest-ranged guns', () => {
    expect(arcMaxRange(broadside)).toBe(400)
  })

  it('counts every gun in it, irrespective of range', () => {
    expect(arcGunCount(broadside)).toBe(16)
  })

  it('weighs each kind of gun at its own band', () => {
    // 70mm: close for both, so the whole broadside counts at full weight.
    expect(arcEffectiveGuns(broadside, 70)).toBeCloseTo(16)
    // 130mm: medium for the long guns, long for the carronades.
    expect(arcEffectiveGuns(broadside, 130)).toBeCloseTo(
      10 * RANGE_BAND_MODIFIERS.medium + 6 * RANGE_BAND_MODIFIERS.long,
    )
    // 200mm: past the carronades entirely.
    expect(arcEffectiveGuns(broadside, 200)).toBeCloseTo(10 * RANGE_BAND_MODIFIERS.medium)
    expect(arcEffectiveGuns(broadside, 500)).toBe(0)
  })

  it('reports the best band anything in it puts the target at', () => {
    expect(arcBestBand(broadside, 70)).toBe('close')
    // Medium for the long guns beats long for the carronades.
    expect(arcBestBand(broadside, 130)).toBe('medium')
    expect(arcBestBand(broadside, 350)).toBe('extreme')
    expect(arcBestBand(broadside, 500)).toBeNull()
  })

  it('ignores guns nobody mounted', () => {
    const empty: FiringArc = { id: 'a', side: 'port', guns: [{ ...longGuns, guns: 0 }] }
    expect(arcBestBand(empty, 50)).toBeNull()
    expect(arcEffectiveGuns(empty, 50)).toBe(0)
  })
})
