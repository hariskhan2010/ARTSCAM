import {
  Brush,
  Check,
  Circle,
  Hand,
  Hexagon,
  MousePointer2,
  PenTool,
  Slash,
  Spline,
  Square,
  Star,
  Type,
  Waypoints,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Btn } from '../panels/common';
import { useStore, type EditorStore, type ToolName } from './store';
import { TextEditor } from './TextEditor';

/**
 * Floating help and controls over the canvas: what the active tool does and
 * which keys it takes, the pen's Finish/Cancel buttons, and view controls.
 */

export const TOOL_INFO: Record<
  ToolName,
  { name: string; icon: LucideIcon; key: string; steps: string[] }
> = {
  select: {
    name: 'Select',
    icon: MousePointer2,
    key: 'V',
    steps: [
      'Click a shape to select',
      'Shift+click adds',
      'Drag empty space to box-select',
      'Drag square handles to resize, the round one to rotate',
    ],
  },
  node: {
    name: 'Edit points',
    icon: Spline,
    key: 'N',
    steps: [
      'Click a shape, then drag its points',
      'Double-click the outline to add a point',
      'Delete removes the selected point',
    ],
  },
  pen: {
    name: 'Pen',
    icon: PenTool,
    key: 'P',
    steps: ['Click for a corner', 'Click and drag for a curve', 'Click the first point to close'],
  },
  rect: {
    name: 'Rectangle',
    icon: Square,
    key: 'R',
    steps: ['Drag to draw', 'Hold Shift for a square'],
  },
  ellipse: {
    name: 'Ellipse',
    icon: Circle,
    key: 'E',
    steps: ['Drag to draw', 'Hold Shift for a circle'],
  },
  polygon: { name: 'Polygon', icon: Hexagon, key: 'G', steps: ['Drag out from the centre'] },
  star: { name: 'Star', icon: Star, key: 'S', steps: ['Drag out from the centre'] },
  line: { name: 'Line', icon: Slash, key: 'L', steps: ['Drag to draw a straight line'] },
  arc: {
    name: 'Arc',
    icon: Spline,
    key: 'A',
    steps: [
      'Click the start',
      'Click the end',
      'Click a point the arc passes through',
      'Esc cancels',
    ],
  },
  text: {
    name: 'Text',
    icon: Type,
    key: 'T',
    steps: ['Click where the text should start', 'Type in Urdu, Arabic or English'],
  },
  pan: { name: 'Pan', icon: Hand, key: 'H', steps: ['Drag to move the view', 'Scroll to zoom'] },
  sculpt: {
    name: 'Sculpt',
    icon: Brush,
    key: 'B',
    steps: [
      'Drag over the relief to raise, lower or smooth it',
      'Brush, size and strength are in the Relief panel',
      'Each stroke is one step: Ctrl+Z undoes it',
    ],
  },
};

export function CanvasOverlay(props: {
  store: EditorStore;
  penCount: number;
  onFinishPen: (closed: boolean) => void;
  onCancelPen: () => void;
}) {
  const store = useStore(props.store);
  const { ui } = store;
  const info = TOOL_INFO[ui.tool];
  const Icon = info.icon;
  const drawingPen = ui.tool === 'pen' && props.penCount > 0;

  return (
    <>
      <div className="float tool-hint" data-testid="tool-hint">
        <div className="title">
          <Icon size={15} aria-hidden />
          {info.name}
          {drawingPen && (
            <span className="chip muted" data-testid="pen-count">
              {props.penCount} point{props.penCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="keys">
          {info.steps.map((s) => (
            <span key={s}>{s}</span>
          ))}
          {drawingPen && (
            <>
              <span>
                <kbd>Enter</kbd> finish
              </span>
              <span>
                <kbd>Esc</kbd> cancel
              </span>
            </>
          )}
        </div>
        {(ui.tool === 'polygon' || ui.tool === 'star') && (
          <div className="row">
            <span className="field-label">{ui.tool === 'star' ? 'Points' : 'Sides'}</span>
            <span className="input">
              <input
                type="number"
                min={ui.tool === 'star' ? 2 : 3}
                max={64}
                value={ui.sides}
                aria-label={ui.tool === 'star' ? 'Star points' : 'Polygon sides'}
                onChange={(e) =>
                  store.setUi({
                    sides: Math.max(2, Math.min(64, Math.round(Number(e.target.value) || 3))),
                  })
                }
              />
            </span>
          </div>
        )}
        {ui.tool === 'text' && <TextEditor store={store} />}
        {drawingPen && (
          <div className="row">
            <Btn
              icon={Check}
              label="Finish"
              variant="primary"
              onClick={() => props.onFinishPen(false)}
              disabled={props.penCount < 2}
              testId="pen-finish"
            />
            <Btn
              icon={Waypoints}
              label="Close shape"
              onClick={() => props.onFinishPen(true)}
              disabled={props.penCount < 3}
              testId="pen-close"
            />
            <Btn
              icon={X}
              label="Cancel"
              variant="ghost"
              onClick={props.onCancelPen}
              testId="pen-cancel"
            />
          </div>
        )}
      </div>
    </>
  );
}
