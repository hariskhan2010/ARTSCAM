import { addLayer, type Toolpath } from '@naqsh/core';
import {
  Box,
  Circle,
  ClipboardPaste,
  Copy,
  Crosshair,
  Download,
  Drill,
  Eraser,
  FilePlus,
  FileDown,
  FileUp,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Grid3x3,
  Hand,
  Hexagon,
  Image as ImageIcon,
  Layers3,
  Magnet,
  Maximize,
  Minus,
  Mountain,
  MountainSnow,
  Move,
  MousePointer2,
  PaintBucket,
  PenTool,
  Plus,
  Redo2,
  Rotate3d,
  RotateCcw,
  Route,
  Save,
  ScanSearch,
  Scissors,
  Shapes,
  Slash,
  Spline,
  Square,
  SquareDashed,
  SquaresIntersect,
  SquaresSubtract,
  SquaresUnite,
  Star,
  Triangle,
  Type,
  Undo2,
  Waves,
  Waypoints,
  Blend,
  ArrowUpDown,
  CopyPlus,
  Trash,
  Undo,
  Brush,
  ZoomIn,
  ZoomOut,
  Droplets,
  ChevronsUpDown,
  Spline as ArcIcon,
} from 'lucide-react';
import {
  addImageRelief,
  booleanSelection,
  confirmNew,
  copySelection,
  createToolpath,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  ensureRelief,
  exportDxfFile,
  exportGcode,
  exportStl,
  exportSvgFile,
  importVectors,
  invertRelief,
  openProject,
  pasteClipboard,
  saveProjectFile,
  scaleRelief,
  selectAll,
  shapesToRelief,
  smoothRelief,
  transformSelection,
  TOOLPATH_LABEL,
  openReliefSide,
  addExtrude,
  addSpin,
  addTwoRail,
  addTexture,
  openSample,
} from '../actions';
import type { CamRunner } from '../cam/runner';
import type { EditorStore, SidebarTab, ToolName } from '../editor/store';
import { zoomBy, zoomFit, zoomPrevious, zoomSelection } from '../editor/viewActions';
import type { IconEntry, IconItem } from './IconBar';
import type { MenuDef, MenuEntry } from './MenuBar';
import { SAMPLES } from '../samples';

/**
 * Every command of the menu bar, the two toolbar rows, the left tool strip
 * and the zoom bar, in ArtCAM-like positions (our own icons and wording).
 * Each one calls the same actions the panels use.
 */

const show = (store: EditorStore, tab: SidebarTab) => store.setUi({ sidebarTab: tab });

const TOOL_ICON: Record<Toolpath['type'], IconItem['icon']> = {
  profile: Route,
  pocket: SquareDashed,
  vcarve: Triangle,
  drill: Drill,
  rough3d: Layers3,
  finish3d: Waves,
};

function newToolpath(store: EditorStore, type: Toolpath['type']) {
  show(store, 'cam');
  createToolpath(store, type);
}

function reliefStep(store: EditorStore, run: (s: EditorStore) => void) {
  run(store);
  show(store, 'relief');
}

function setTool(store: EditorStore, tool: ToolName) {
  store.setUi({ tool, show3d: false });
}

// --- Toolbars -------------------------------------------------------------------

/** Row 1: file, clipboard, undo, vector import/export and vector editing. */
export function toolbarRow1(store: EditorStore): IconEntry[] {
  const { history } = store;
  const hasSel = store.ui.selection.length > 0;
  return [
    { icon: FilePlus, title: 'New project', onClick: () => confirmNew(store), testId: 'tb-new' },
    {
      icon: FolderOpen,
      title: 'Open a project file (.zip)',
      onClick: () => void openProject(store),
      testId: 'tb-open',
    },
    {
      icon: Save,
      title: 'Save the project as a .zip file',
      onClick: () => saveProjectFile(store),
      testId: 'save',
    },
    'sep',
    {
      icon: Scissors,
      title: 'Cut (Ctrl+X)',
      onClick: () => cutSelection(store),
      disabled: !hasSel,
      testId: 'tb-cut',
    },
    {
      icon: Copy,
      title: 'Copy (Ctrl+C)',
      onClick: () => copySelection(store),
      disabled: !hasSel,
      testId: 'tb-copy',
    },
    {
      icon: ClipboardPaste,
      title: 'Paste (Ctrl+V)',
      onClick: () => pasteClipboard(store),
      disabled: store.clipboard.length === 0,
      testId: 'tb-paste',
    },
    'sep',
    {
      icon: Undo2,
      title: history.undoLabel ? `Undo ${history.undoLabel} (Ctrl+Z)` : 'Nothing to undo',
      onClick: () => store.undo(),
      disabled: !history.canUndo,
      testId: 'undo',
    },
    {
      icon: Redo2,
      title: history.redoLabel ? `Redo ${history.redoLabel} (Ctrl+Y)` : 'Nothing to redo',
      onClick: () => store.redo(),
      disabled: !history.canRedo,
      testId: 'redo',
    },
    'sep',
    {
      icon: FileUp,
      title: 'Import shapes from an SVG or DXF file',
      onClick: () => void importVectors(store),
      testId: 'import',
    },
    {
      icon: FileDown,
      title: 'Export the visible shapes as SVG',
      onClick: () => exportSvgFile(store),
      testId: 'export-svg',
    },
    {
      icon: Download,
      title: 'Export the visible shapes as DXF (mm)',
      onClick: () => exportDxfFile(store),
      testId: 'export-dxf',
    },
    'sep',
    {
      icon: SquaresUnite,
      title: 'Weld: join the selected shapes into one outline',
      onClick: () => booleanSelection(store, 'union', 'Weld'),
      testId: 'tb-weld',
    },
    {
      icon: SquaresSubtract,
      title: 'Trim: cut the other shapes out of the first one selected',
      onClick: () => booleanSelection(store, 'difference', 'Trim'),
      testId: 'tb-trim',
    },
    {
      icon: SquaresIntersect,
      title: 'Intersect: keep where the first shape overlaps the others',
      onClick: () => booleanSelection(store, 'intersect', 'Intersect'),
      testId: 'tb-intersect',
    },
    'sep',
    {
      icon: FlipHorizontal,
      title: 'Mirror left to right',
      onClick: () => transformSelection(store, 'mirror'),
      disabled: !hasSel,
      testId: 'tb-mirror',
    },
    {
      icon: FlipVertical,
      title: 'Flip top to bottom',
      onClick: () => transformSelection(store, 'flip'),
      disabled: !hasSel,
      testId: 'tb-flip',
    },
    {
      icon: RotateCcw,
      title: 'Rotate 90° anticlockwise',
      onClick: () => transformSelection(store, 'rotateCcw'),
      disabled: !hasSel,
      testId: 'tb-rotate',
    },
    {
      icon: Crosshair,
      title: 'Centre on the material',
      onClick: () => transformSelection(store, 'centre'),
      disabled: !hasSel,
      testId: 'tb-centre',
    },
    {
      icon: CopyPlus,
      title: 'Duplicate (Ctrl+D)',
      onClick: () => duplicateSelection(store),
      disabled: !hasSel,
      testId: 'tb-duplicate',
    },
    {
      icon: Trash,
      title: 'Delete (Del)',
      onClick: () => deleteSelection(store),
      disabled: !hasSel,
      testId: 'tb-delete',
    },
  ];
}

/** Zoom and view buttons (start of toolbar row 2). */
export function zoomItems(store: EditorStore, prefix: string): IconItem[] {
  return [
    {
      icon: ZoomIn,
      title: 'Zoom in',
      onClick: () => zoomBy(store, 1.25),
      testId: `${prefix}zoom-in`,
    },
    {
      icon: ZoomOut,
      title: 'Zoom out',
      onClick: () => zoomBy(store, 1 / 1.25),
      testId: `${prefix}zoom-out`,
    },
    {
      icon: Undo,
      title: 'Previous view',
      onClick: () => zoomPrevious(store),
      disabled: !store.ui.prevView,
      testId: `${prefix}zoom-prev`,
    },
    {
      icon: Maximize,
      title: 'Fit the material in view',
      onClick: () => zoomFit(store),
      testId: `${prefix}zoom-fit`,
    },
    {
      icon: ScanSearch,
      title: 'Zoom to the selection',
      onClick: () => zoomSelection(store),
      disabled: store.ui.selection.length === 0,
      testId: `${prefix}zoom-sel`,
    },
  ];
}

/** Row 2: view, relief and toolpath tools. */
export function toolbarRow2(store: EditorStore): IconEntry[] {
  const tps: Toolpath['type'][] = ['profile', 'pocket', 'vcarve', 'drill', 'rough3d', 'finish3d'];
  const hasRelief = store.doc.reliefs.length > 0;
  return [
    ...zoomItems(store, 'tb-'),
    {
      icon: Rotate3d,
      title: store.ui.show3d ? 'Back to the 2D view' : 'Show the relief in 3D',
      onClick: () => store.setUi({ show3d: !store.ui.show3d }),
      pressed: store.ui.show3d,
      testId: 'tb-view3d',
    },
    'sep',
    {
      icon: Mountain,
      title: 'Shape to relief: build the selected shapes with the Relief settings',
      onClick: () => reliefStep(store, (s) => shapesToRelief(s)),
      testId: 'tb-shape-relief',
    },
    {
      icon: Plus,
      title: 'Combine: add the selected shapes to the relief (raise)',
      onClick: () => reliefStep(store, (s) => shapesToRelief(s, 'add')),
      testId: 'tb-relief-add',
    },
    {
      icon: Minus,
      title: 'Combine: subtract the selected shapes from the relief (sink)',
      onClick: () => reliefStep(store, (s) => shapesToRelief(s, 'subtract')),
      testId: 'tb-relief-subtract',
    },
    {
      icon: Blend,
      title: 'Combine: merge the selected shapes, keeping the higher surface',
      onClick: () => reliefStep(store, (s) => shapesToRelief(s, 'mergeHigh')),
      testId: 'tb-relief-merge',
    },
    {
      icon: Droplets,
      title: 'Smooth the relief',
      onClick: () => reliefStep(store, smoothRelief),
      disabled: !hasRelief,
      testId: 'tb-relief-smooth',
    },
    {
      icon: ChevronsUpDown,
      title: 'Scale the relief height',
      onClick: () => reliefStep(store, scaleRelief),
      disabled: !hasRelief,
      testId: 'tb-relief-scale',
    },
    {
      icon: ArrowUpDown,
      title: 'Invert the relief (flip high and low)',
      onClick: () => reliefStep(store, invertRelief),
      disabled: !hasRelief,
      testId: 'tb-relief-invert',
    },
    {
      icon: ImageIcon,
      title: 'Image to relief (bright parts high)',
      onClick: () => {
        show(store, 'relief');
        void addImageRelief(store);
      },
      testId: 'tb-image-relief',
    },
    {
      icon: Box,
      title: 'Export the relief as STL',
      onClick: () => exportStl(store),
      disabled: !hasRelief,
      testId: 'tb-stl',
    },
    'sep',
    ...tps.map((type): IconItem => ({
      icon: TOOL_ICON[type],
      title: `New ${TOOLPATH_LABEL[type]} toolpath`,
      onClick: () => newToolpath(store, type),
      testId: `tb-tp-${type}`,
    })),
  ];
}

/** Left tool strip, top to bottom, in ArtCAM's order. */
export function toolStrip(store: EditorStore): IconEntry[] {
  const t = store.ui.tool;
  const tool = (id: ToolName, icon: IconItem['icon'], title: string, kbd: string): IconItem => ({
    icon,
    title,
    kbd,
    pressed: t === id,
    onClick: () => {
      setTool(store, id);
      // The brush settings live in the Relief panel.
      if (id === 'sculpt') store.setUi({ sidebarTab: 'relief' });
    },
    testId: `tool-${id}`,
  });
  return [
    tool('select', MousePointer2, 'Select', 'V'),
    tool('node', Spline, 'Edit points', 'N'),
    {
      icon: Move,
      title: 'Transform: exact position and size of the selection',
      onClick: () => {
        setTool(store, 'select');
        show(store, 'design');
      },
      testId: 'tool-transform',
    },
    { icon: Grid3x3, title: 'Array copy', later: true, testId: 'tool-array' },
    'sep',
    { icon: Eraser, title: 'Eraser', later: true, testId: 'tool-eraser' },
    { icon: PaintBucket, title: 'Fill', later: true, testId: 'tool-fill' },
    'sep',
    tool('pen', PenTool, 'Polyline (pen)', 'P'),
    tool('line', Slash, 'Line', 'L'),
    tool('rect', Square, 'Rectangle', 'R'),
    tool('ellipse', Circle, 'Ellipse', 'E'),
    tool('star', Star, 'Star', 'S'),
    tool('polygon', Hexagon, 'Polygon', 'G'),
    { icon: ArcIcon, title: 'Arc', later: true, testId: 'tool-arc' },
    tool('text', Type, 'Text', 'T'),
    'sep',
    tool('sculpt', Brush, 'Sculpt relief', 'B'),
    { icon: MountainSnow, title: 'Relief clipart', later: true, testId: 'tool-clipart' },
  ];
}

/** Zoom bar above the canvas: zoom, pan and snapping. */
export function zoomBar(store: EditorStore): IconEntry[] {
  const { ui } = store;
  return [
    ...zoomItems(store, ''),
    {
      icon: Hand,
      title: 'Pan (H)',
      pressed: ui.tool === 'pan',
      onClick: () => setTool(store, 'pan'),
      testId: 'tool-pan',
    },
    'sep',
    {
      icon: Magnet,
      title: ui.snapGrid ? 'Grid snapping on' : 'Grid snapping off',
      pressed: ui.snapGrid,
      onClick: () => store.setUi({ snapGrid: !ui.snapGrid }),
      testId: 'snap-grid',
    },
    {
      icon: Waypoints,
      title: ui.snapPoints ? 'Snap to points on' : 'Snap to points off',
      pressed: ui.snapPoints,
      onClick: () => store.setUi({ snapPoints: !ui.snapPoints }),
      testId: 'snap-points',
    },
  ];
}

// --- Menus ----------------------------------------------------------------------

export function menus(store: EditorStore, runner: CamRunner): MenuDef[] {
  const { history, ui, doc } = store;
  const hasSel = ui.selection.length > 0;
  const hasRelief = doc.reliefs.length > 0;
  const activeTp = doc.toolpaths.find((t) => t.id === ui.activeToolpath);
  const later = (label: string): MenuEntry => ({ label, later: true });
  const draw = (label: string, id: ToolName): MenuEntry => ({
    label,
    checked: ui.tool === id,
    onClick: () => setTool(store, id),
  });
  const tps: Toolpath['type'][] = ['profile', 'pocket', 'vcarve', 'drill', 'rough3d', 'finish3d'];

  return [
    {
      title: 'File',
      items: [
        { label: 'New', onClick: () => confirmNew(store) },
        { label: 'Open…', onClick: () => void openProject(store) },
        { label: 'Save', onClick: () => saveProjectFile(store) },
        'separator',
        { label: 'Import vectors…', onClick: () => void importVectors(store) },
        { label: 'Export vectors as SVG', onClick: () => exportSvgFile(store) },
        { label: 'Export vectors as DXF', onClick: () => exportDxfFile(store) },
        'separator',
        { label: 'Export relief as STL', onClick: () => exportStl(store), disabled: !hasRelief },
        later('Print…'),
        later('Recent projects'),
      ],
    },
    {
      title: 'Edit',
      items: [
        {
          label: history.undoLabel ? `Undo ${history.undoLabel}` : 'Undo',
          shortcut: 'Ctrl+Z',
          disabled: !history.canUndo,
          onClick: () => store.undo(),
        },
        {
          label: history.redoLabel ? `Redo ${history.redoLabel}` : 'Redo',
          shortcut: 'Ctrl+Y',
          disabled: !history.canRedo,
          onClick: () => store.redo(),
        },
        'separator',
        { label: 'Cut', shortcut: 'Ctrl+X', disabled: !hasSel, onClick: () => cutSelection(store) },
        {
          label: 'Copy',
          shortcut: 'Ctrl+C',
          disabled: !hasSel,
          onClick: () => copySelection(store),
        },
        {
          label: 'Paste',
          shortcut: 'Ctrl+V',
          disabled: store.clipboard.length === 0,
          onClick: () => pasteClipboard(store),
        },
        {
          label: 'Duplicate',
          shortcut: 'Ctrl+D',
          disabled: !hasSel,
          onClick: () => duplicateSelection(store),
        },
        {
          label: 'Delete',
          shortcut: 'Del',
          disabled: !hasSel,
          onClick: () => deleteSelection(store),
        },
        'separator',
        { label: 'Select all', shortcut: 'Ctrl+A', onClick: () => selectAll(store) },
        later('Preferences…'),
      ],
    },
    {
      title: 'View',
      items: [
        { label: '2D View', checked: !ui.show3d, onClick: () => store.setUi({ show3d: false }) },
        { label: '3D View', checked: ui.show3d, onClick: () => store.setUi({ show3d: true }) },
        'separator',
        { label: 'Zoom in', onClick: () => zoomBy(store, 1.25) },
        { label: 'Zoom out', onClick: () => zoomBy(store, 1 / 1.25) },
        { label: 'Previous view', disabled: !ui.prevView, onClick: () => zoomPrevious(store) },
        { label: 'Fit the material', onClick: () => zoomFit(store) },
        { label: 'Zoom to selection', disabled: !hasSel, onClick: () => zoomSelection(store) },
        'separator',
        {
          label: 'Snap to grid',
          checked: ui.snapGrid,
          onClick: () => store.setUi({ snapGrid: !ui.snapGrid }),
        },
        {
          label: 'Snap to points',
          checked: ui.snapPoints,
          onClick: () => store.setUi({ snapPoints: !ui.snapPoints }),
        },
      ],
    },
    {
      title: 'Model',
      items: [
        { label: 'Material size and units…', onClick: () => show(store, 'design') },
        later('Model resolution…'),
        later('Guidelines'),
      ],
    },
    {
      title: 'Vector',
      items: [
        draw('Polyline (pen)', 'pen'),
        draw('Line', 'line'),
        draw('Rectangle', 'rect'),
        draw('Ellipse', 'ellipse'),
        draw('Star', 'star'),
        draw('Polygon', 'polygon'),
        draw('Text', 'text'),
        later('Arc'),
        'separator',
        draw('Edit points', 'node'),
        'separator',
        { label: 'Weld', onClick: () => booleanSelection(store, 'union', 'Weld') },
        { label: 'Trim', onClick: () => booleanSelection(store, 'difference', 'Trim') },
        { label: 'Intersect', onClick: () => booleanSelection(store, 'intersect', 'Intersect') },
        { label: 'Offset…', onClick: () => show(store, 'design') },
        'separator',
        {
          label: 'New layer',
          onClick: () => {
            store.execute(addLayer(`Layer ${doc.layers.length + 1}`));
            show(store, 'design');
          },
        },
        later('Fillet'),
        later('Array copy'),
        later('Nesting'),
      ],
    },
    {
      title: 'Bitmap',
      items: [
        {
          label: 'Image to relief…',
          onClick: () => {
            show(store, 'relief');
            void addImageRelief(store);
          },
        },
        { label: 'Show bitmaps', onClick: () => show(store, 'bitmaps') },
        later('Trace bitmap to vectors'),
      ],
    },
    {
      title: 'Relief',
      items: [
        {
          label: 'Create relief',
          disabled: hasRelief,
          onClick: () => {
            ensureRelief(store);
            show(store, 'relief');
          },
        },
        { label: 'Shape to relief', onClick: () => reliefStep(store, (s) => shapesToRelief(s)) },
        {
          label: 'Combine: add',
          onClick: () => reliefStep(store, (s) => shapesToRelief(s, 'add')),
        },
        {
          label: 'Combine: subtract',
          onClick: () => reliefStep(store, (s) => shapesToRelief(s, 'subtract')),
        },
        {
          label: 'Combine: merge high',
          onClick: () => reliefStep(store, (s) => shapesToRelief(s, 'mergeHigh')),
        },
        {
          label: 'Combine: merge low',
          onClick: () => reliefStep(store, (s) => shapesToRelief(s, 'mergeLow')),
        },
        'separator',
        { label: 'Smooth', disabled: !hasRelief, onClick: () => reliefStep(store, smoothRelief) },
        {
          label: 'Scale height',
          disabled: !hasRelief,
          onClick: () => reliefStep(store, scaleRelief),
        },
        { label: 'Invert', disabled: !hasRelief, onClick: () => reliefStep(store, invertRelief) },
        'separator',
        { label: '3D View', onClick: () => store.setUi({ show3d: true }) },
        { label: 'Export STL', disabled: !hasRelief, onClick: () => exportStl(store) },
        'separator',
        { label: 'Extrude along a rail', onClick: () => reliefStep(store, addExtrude) },
        { label: 'Spin', onClick: () => reliefStep(store, addSpin) },
        later('Turn'),
        { label: 'Two-rail sweep', onClick: () => reliefStep(store, addTwoRail) },
        {
          label: 'Sculpt',
          onClick: () => {
            store.setUi({ sidebarTab: 'relief' });
            setTool(store, 'sculpt');
          },
        },
        { label: 'Texture', onClick: () => reliefStep(store, addTexture) },
        {
          label: store.ui.reliefSide === 'back' ? 'Front relief' : 'Back relief',
          onClick: () => openReliefSide(store, store.ui.reliefSide === 'back' ? 'front' : 'back'),
        },
      ],
    },
    {
      title: 'Toolpath',
      items: [
        ...tps.map((type): MenuEntry => ({
          label: TOOLPATH_LABEL[type],
          onClick: () => newToolpath(store, type),
        })),
        'separator',
        {
          label: 'Simulate',
          disabled: !activeTp,
          onClick: () => activeTp && void runner.simulate(doc, activeTp.id),
        },
        {
          label: 'Save G-code…',
          disabled: !activeTp,
          title: 'Blocked until the toolpath is simulated and passes the safety check',
          onClick: () => activeTp && void exportGcode(store, runner, activeTp.id),
        },
        'separator',
        { label: 'Tools and machine…', onClick: () => show(store, 'cam') },
        later('Rest machining'),
        later('Inlay'),
      ],
    },
    {
      title: '3D Printing',
      items: [
        { label: 'Export relief as STL', disabled: !hasRelief, onClick: () => exportStl(store) },
        later('Hollow and thicken'),
      ],
    },
    {
      title: 'Window',
      items: [
        {
          label: 'Vectors',
          checked: ui.sidebarTab === 'design',
          onClick: () => show(store, 'design'),
        },
        {
          label: 'Bitmaps',
          checked: ui.sidebarTab === 'bitmaps',
          onClick: () => show(store, 'bitmaps'),
        },
        {
          label: 'Relief',
          checked: ui.sidebarTab === 'relief',
          onClick: () => show(store, 'relief'),
        },
        { label: 'Toolpaths', checked: ui.sidebarTab === 'cam', onClick: () => show(store, 'cam') },
      ],
    },
    {
      title: 'Help',
      items: [
        ...SAMPLES.map((s): MenuEntry => ({
          label: `Sample: ${s.name}`,
          title: s.text,
          onClick: () => openSample(store, s.id),
        })),
        'separator',
        {
          label: 'Keyboard shortcuts',
          onClick: () =>
            store.setUi({
              message:
                'V select · N points · P pen · L line · R rectangle · E ellipse · G polygon · S star · T text · H pan · Ctrl+Z/Y undo/redo · Ctrl+C/X/V/D · Del',
            }),
        },
        {
          label: 'About Naqsh',
          onClick: () =>
            store.setUi({
              message: 'Naqsh (beta): free, open-source relief carving CAD/CAM in the browser',
            }),
        },
      ],
    },
  ];
}

/** Toolbar icons for the toolpath types (used by the Project tree too). */
export { TOOL_ICON, Shapes as VectorsIcon };
