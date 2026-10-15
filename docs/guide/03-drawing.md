# Drawing

## Shapes

Pick a tool on the left (or press its key) and drag on the canvas:

- **Rectangle (R)**, **Ellipse (E)**: hold Shift for a square or circle.
- **Polygon (G)**, **Star (S)**: drag out from the centre.
- **Line (L)**: a straight open line.
- **Arc (A)**: click the start, click the end, then click a point the arc passes through.
- **Pen (P)**: click for corners, click and drag for curves. Click the first point to close the
  shape, or press Enter (or Finish) to leave it open.

Closed shapes can be pocketed, V-carved and turned into reliefs. Open shapes are used for profile
"on the line" cuts and as rails and cross-sections for sweeps.

## Selecting and moving

- **Select (V)**: click a shape; Shift+click adds; drag empty space to box-select.
- Drag the square handles to resize, the round one to rotate (Shift keeps proportions / snaps the
  angle).
- In the **Selected shape** panel, type an exact position, width or height. The lock keeps the
  proportions.
- Snapping to the grid and to points is in the zoom bar above the canvas.

## Editing points

**Edit points (N)**: click a shape, then drag its points. Double-click the outline to add a point;
Delete removes the selected point.

## Combining and offsetting

Select shapes, then in **Shape operations**: **Weld** joins them into one outline, **Trim** cuts the
others out of the first one you selected, **Intersect** keeps only the overlap. **Offset distance**
with **Outward** or **Inward** adds a new outline that far outside or inside each shape. Mirror,
flip, rotate, centre, duplicate and delete are in the Selected shape panel and on
the toolbar.

## Corners, arrays and lining up

In **Arrange and edit** (Vectors panel), with shapes selected:

- **Fillet** rounds, **Chamfer** cuts every corner between two straight lines, by the corner size.
- **Join** links open shapes whose ends meet (closing them if they form a loop); **Repair** removes
  zero-length pieces and duplicate shapes and closes shapes whose ends nearly meet. Use it on imported
  DXF files.
- **Align** left, centre, right, top, middle or bottom; **Space across / Space up** gives equal gaps.
- **Grid array** copies the selection into columns and rows; **Circular array** copies it around a
  centre (the material centre unless you type one) over an angle.

## Layers

Layers are listed under Vectors in the Project tree (**+** adds one). Hide or lock a layer in the
Layers section. New shapes go into the layer picked in the tree.

## Import and export

- **Import**: SVG and DXF (lines, arcs, polylines, splines) come in at their real size.
- **Export**: SVG and DXF of the visible layers.
