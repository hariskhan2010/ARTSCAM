# Sweeps, textures and sculpting

These are in the Relief panel (and the Relief menu). Each one adds a step to the relief, using the
**Combine** setting from Add shapes.

## Cross-sections

A cross-section is an **open** shape (draw it with the pen or line tool) at true size. Its two ends
sit on the base; its height at each point is measured from the straight line between its ends. It
does not matter where you draw it or which way.

## Sweeps

Select a shape and press **Use selection** next to its role:

- **Extrude**: pick a cross-section and a **rail**. The section is swept along the rail. A closed
  rail makes a frame; an open rail has square ends. An optional **end section** blends from one
  shape to the other along the rail.
- **Spin**: pick a cross-section and press Spin. It is turned around its **left end**, so draw it
  from the centre outward (rosettes, bosses, dishes).
- **Two-rail sweep**: pick a cross-section, a rail and a **second rail**. The section is stretched
  between the rails, getting wider and narrower with them. **Scale height with width** makes it
  taller where it is wider.

## Textures

Pick a **pattern** (lines, dimples, hammered, basket weave), its **spacing**, **height** and
**angle**, then **Add texture**. With one closed shape selected it goes only inside that shape;
otherwise over the whole relief.

## Sculpting

1. In **Sculpt**, pick a brush: **raise**, **lower** or **smooth**, its size (radius) and strength
   (mm for raise and lower, 0–1 for smooth).
2. Press **Start sculpting** (or the brush tool, B) and drag over the relief.

Each stroke is one step: Ctrl+Z undoes it. A stroke changes heights by at most its strength, and
nothing beyond its radius.
