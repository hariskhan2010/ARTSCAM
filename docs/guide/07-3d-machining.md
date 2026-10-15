# 3D machining

The relief's highest point sits at the top of the material. Rough it with a flat end mill, then
finish it with a ball nose.

## 3D rough

**New toolpath › 3D rough** with a flat end mill. It clears the material above the relief in
levels (the tool's depth per pass), leaving **Leave on relief** (default 0.5 mm) for the finish.

## 3D finish

**New toolpath › 3D finish** with a ball nose. The tool follows the surface in parallel lines:

- **Pattern**: along X, along Y, or X then Y (smoother, twice the time).
- **Stepover**: distance between the lines. Smaller is smoother but slower.

## Limiting to a shape

By default both cover the whole material. To machine only part of it, select closed shapes and
press **Use selection**: the tool centre stays inside them. **Whole material** goes back to the
full board.

## Tips

- Simulate both and compare the estimated times before you cut.
- The relief must not be deeper than the material: Naqsh warns, and the checker blocks the export.
- Air-cut first: 3D files are long, and the first minutes show whether the zero is right.
