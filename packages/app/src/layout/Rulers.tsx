import { useEffect, useRef } from 'react';
import { gridStep } from '../editor/geometry';
import { useStore, type EditorStore } from '../editor/store';
import { currentView } from '../editor/viewActions';

/** Ruler thickness in CSS px (matches the stage grid in styles.css). */
export const RULER = 20;

/**
 * Rulers along the top and left of the 2D canvas, in the project's units
 * (mm or inch), following pan and zoom, with a mark at the cursor.
 */
export function Rulers({ store }: { store: EditorStore }) {
  useStore(store);
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const v = currentView(store);
    const [w, h] = store.canvasSize;
    const perUnit = store.doc.units === 'inch' ? 25.4 : 1;
    // Labelled ticks at least 50 px apart; minor ticks in between.
    const majorU = gridStep(v.scale * perUnit, 50);
    const major = majorU * perUnit;
    const lead = Math.round(majorU / 10 ** Math.floor(Math.log10(majorU)));
    const per = lead === 2 ? 4 : 5; // minor ticks per major tick
    const minor = major / per;
    const cursor = store.ui.cursor;
    const draw = (cv: HTMLCanvasElement | null, horizontal: boolean) => {
      if (!cv) return;
      const len = horizontal ? w : h;
      const dpr = window.devicePixelRatio || 1;
      const cw = horizontal ? len : RULER;
      const ch = horizontal ? RULER : len;
      if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
        cv.width = Math.round(cw * dpr);
        cv.height = Math.round(ch * dpr);
        cv.style.width = `${cw}px`;
        cv.style.height = `${ch}px`;
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const css = getComputedStyle(cv);
      const col = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = col('--panel-2', '#f8f9fb');
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = col('--faint', '#98a2b3');
      ctx.fillStyle = col('--muted', '#667085');
      ctx.font = '10px system-ui, sans-serif';
      ctx.lineWidth = 1;
      // Screen position of world coordinate t along this ruler.
      const at = (t: number) => (horizontal ? v.originX + t * v.scale : v.originY - t * v.scale);
      const world = (s: number) =>
        horizontal ? (s - v.originX) / v.scale : (v.originY - s) / v.scale;
      const a = Math.min(world(0), world(len));
      const b = Math.max(world(0), world(len));
      ctx.beginPath();
      for (let i = Math.floor(a / minor); i * minor <= b; i++) {
        const t = i * minor;
        const s = Math.round(at(t)) + 0.5;
        const isMajor = i % per === 0;
        const tick = isMajor ? RULER * 0.6 : RULER * 0.25;
        if (horizontal) {
          ctx.moveTo(s, RULER);
          ctx.lineTo(s, RULER - tick);
        } else {
          ctx.moveTo(RULER, s);
          ctx.lineTo(RULER - tick, s);
        }
        if (isMajor) {
          const label = String(Number((t / perUnit).toFixed(4)));
          if (horizontal) ctx.fillText(label, s + 2, 9);
          else {
            ctx.save();
            ctx.translate(9, s - 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
      }
      ctx.stroke();
      // Edge line next to the canvas.
      ctx.strokeStyle = col('--border-strong', '#cfd4dc');
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(0, RULER - 0.5);
        ctx.lineTo(cw, RULER - 0.5);
      } else {
        ctx.moveTo(RULER - 0.5, 0);
        ctx.lineTo(RULER - 0.5, ch);
      }
      ctx.stroke();
      if (cursor) {
        const s = Math.round(at(horizontal ? cursor[0] : cursor[1])) + 0.5;
        ctx.strokeStyle = col('--accent', '#2f6fed');
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(s, 0);
          ctx.lineTo(s, RULER);
        } else {
          ctx.moveTo(0, s);
          ctx.lineTo(RULER, s);
        }
        ctx.stroke();
      }
    };
    draw(top.current, true);
    draw(left.current, false);
  });

  const unit = store.doc.units === 'inch' ? 'in' : 'mm';
  return (
    <>
      <div className="ruler-corner" title={`Rulers in ${unit}`}>
        {unit}
      </div>
      <canvas ref={top} className="ruler ruler-top" data-testid="ruler-top" aria-hidden />
      <canvas ref={left} className="ruler ruler-left" data-testid="ruler-left" aria-hidden />
    </>
  );
}
