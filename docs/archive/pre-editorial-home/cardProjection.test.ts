import { describe, expect, it } from 'vitest';
import { projectCardPoint } from './cardProjection';

describe('rigid card projection', () => {
  it('returns the original points at rest and keeps the hinge fixed', () => {
    expect(projectCardPoint(120, 460, [196, 555], 0)[0]).toBeCloseTo(120);
    expect(projectCardPoint(120, 460, [196, 555], 0)[1]).toBeCloseTo(460);
    expect(projectCardPoint(196, 555, [196, 555], -.65)).toEqual([196, 555]);
  });
  it('foreshortens the far edge instead of stretching the photograph', () => {
    const left = projectCardPoint(100, 400, [200, 550], -.65);
    const right = projectCardPoint(200, 380, [200, 550], -.65);
    expect(Math.hypot(right[0] - left[0], right[1] - left[1])).toBeLessThan(Math.hypot(100, 20));
    expect(left[1]).toBeGreaterThan(400);
  });
});
