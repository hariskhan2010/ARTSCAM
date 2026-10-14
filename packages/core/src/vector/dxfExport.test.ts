import { describe, expect, it } from 'vitest';
import { importDxf } from './dxf';
import { exportDxf } from './dxfExport';
import { bbox, length } from './path';
import { ellipse, line, rectangle } from './shapes';

describe('DXF export', () => {
  it('round-trips through the DXF importer at the same size, closed and open', () => {
    const text = exportDxf([
      { segments: rectangle(10, 20, 100, 50), closed: true, layer: 'Cut' },
      { segments: ellipse(200, 100, 25), closed: true, layer: 'Holes' },
      { segments: line([0, 0], [30, 40]), closed: false },
    ]);
    const back = importDxf(text, { joinTolerance: 0 });
    expect(back.scale).toBe(1); // millimetres
    expect(back.vectors).toHaveLength(3);
    const [rect, circle, ln] = back.vectors;
    expect(rect!.layer).toBe('Cut');
    expect(rect!.closed).toBe(true);
    expect(bbox(rect!.segments)).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
    expect(circle!.closed).toBe(true);
    expect(length(circle!.segments)).toBeCloseTo(2 * Math.PI * 25, 1);
    expect(ln!.closed).toBe(false);
    expect(length(ln!.segments)).toBeCloseTo(50, 9);
  });
});
