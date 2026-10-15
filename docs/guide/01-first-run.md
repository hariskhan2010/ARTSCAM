# First run

## The window

- **Menu bar** (top): File, Edit, View, Model, Vector, Bitmap, Relief, Toolpath, 3D Printing,
  Window, Help. Items that are not built yet are greyed out and say "Coming later".
- **Toolbars** (two rows): file, clipboard, undo/redo and vector editing; then zoom, the 3D view,
  relief tools and toolpath types.
- **Drawing tools** (left): select (V), edit points (N), pen (P), line (L), rectangle (R), ellipse
  (E), star (S), polygon (G), text (T), sculpt (B).
- **2D View / 3D View** tabs above the canvas, with zoom buttons and rulers (mm or inch).
- **Project tree** (right): Vectors (with layers), Bitmaps, Front Relief, Back Relief, Toolpaths.
  Click an item to show its settings underneath; **+** creates one.
- **Model Information** (bottom right) and the **status bar**: X, Y, Z (relief height) under the
  cursor, and the width and height of the selection.

## Set up the material first

In the Project tree click **Vectors**, then open **Material** in the panel below:

- Width, height and thickness of the board.
- **XY origin**: which corner (or the centre) is X0 Y0 on your machine.
- **Z zero**: the top of the material or the machine bed. This must match how you zero the router.
- **Units**: mm or inch. Everything is stored in mm; this only changes what you see and type.

## Try a sample

**Help › Sample: …** opens a ready-made project:

- **House sign**: recessed panel (pocket), mounting holes (peck drill), cut-out with tabs.
- **Calligraphy plaque**: Nastaliq text V-carved inside an oval, then cut out.
- **Relief panel**: a framed border, rosette and leaves on a hammered background; 3D roughing and
  finishing.

Open a toolpath in the Project tree, press **Simulate**, and look at the result and the time
estimate. Change something and simulate again.

## Saving

- **File › Save** downloads the project as a `.zip` (vectors, reliefs, images, tools, toolpaths).
  **File › Open** loads it back.
- The app also autosaves in your browser and restores your work when you come back. That copy
  lives only in this browser: save a file for anything you care about.
