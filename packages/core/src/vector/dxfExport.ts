import type { Segment } from '../model/schema';
import { flatten } from './flatten';

/**
 * DXF export: every subpath becomes an LWPOLYLINE (curves flattened within
 * `tolerance`), closed subpaths are flagged closed, units are millimetres
 * ($INSUNITS 4). Minimal R2000 DXF that common CAD/CAM programs read.
 */

export interface DxfExportVector {
  segments: readonly Segment[];
  closed?: boolean;
  /** DXF layer name. Default "0". */
  layer?: string;
}

const num = (v: number) => String(Math.round(v * 1e6) / 1e6);

export function exportDxf(vectors: readonly DxfExportVector[], tolerance = 0.01): string {
  const out: string[] = [];
  const pair = (code: number, value: string | number) => out.push(String(code), String(value));
  pair(0, 'SECTION');
  pair(2, 'HEADER');
  pair(9, '$ACADVER');
  pair(1, 'AC1015');
  pair(9, '$INSUNITS');
  pair(70, 4);
  pair(0, 'ENDSEC');
  pair(0, 'SECTION');
  pair(2, 'ENTITIES');
  for (const v of vectors) {
    const layer = (v.layer ?? '0').replace(/[<>/\\":;?*|=`]/g, '_') || '0';
    for (const poly of flatten(v.segments, tolerance, v.closed ?? false)) {
      if (poly.points.length < 2) continue;
      pair(0, 'LWPOLYLINE');
      pair(8, layer);
      pair(100, 'AcDbEntity');
      pair(100, 'AcDbPolyline');
      pair(90, poly.points.length);
      pair(70, poly.closed ? 1 : 0);
      for (const [x, y] of poly.points) {
        pair(10, num(x));
        pair(20, num(y));
      }
    }
  }
  pair(0, 'ENDSEC');
  pair(0, 'EOF');
  return out.join('\n') + '\n';
}
