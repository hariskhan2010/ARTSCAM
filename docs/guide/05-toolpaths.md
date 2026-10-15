# Toolpaths

Open **Toolpaths** in the Project tree.

## Tools

In **Tools**, pick a bit from **Add a tool** (flat end mills, ball noses, V-bits, a tapered ball)
and adjust its diameter, angle, depth per pass, stepover, feed, plunge rate and spindle speed.
Use the real numbers for your bits and material.

## Making a toolpath

Select the shapes on the canvas, then pick a type under **New toolpath**:

| Type | What it does | Main settings |
|---|---|---|
| **Profile** | Cuts along or around shapes | Cut outside / inside / on the line, depth, holding tabs, ramp in, leave on wall |
| **Pocket** | Clears the area inside shapes (islands are left) | Depth, offset or raster pattern, line angle, leave on wall |
| **V-carve** | Carves lettering and art with a V-bit | Max depth (wider parts get a flat bottom), detail |
| **Drill** | Drills a hole at each shape's centre | Depth, pause at bottom, peck drilling |
| **3D rough / 3D finish** | Machines a relief | See [3D machining](07-3d-machining.md) |

**Use selection** changes which shapes a toolpath machines; **Show** selects them on the canvas.
Toolpaths are always rebuilt from their settings, so changing a shape updates its toolpaths.

## Simulate, check and export

1. **Simulate**: the material is cut on screen. Read the warnings and the estimated time.
2. **Export G-code**: downloads the `.nc` file. It stays disabled until the current settings have
   been simulated and the G-code checker finds no errors.

The machine and controller (GRBL, Mach3, LinuxCNC or generic G-code) are set in **Machine**.

Before running any file, go through [Before the first cut](02-before-the-first-cut.md).
