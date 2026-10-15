# Reliefs

A relief is a carved 3D surface over the material, stored as heights on a grid. It is rebuilt from
its list of **steps**, so every step can be removed or undone.

## Creating one

Click **+** on **Front Relief** in the Project tree (or **Create relief** in the panel). Pick the
detail (grid spacing): 0.5 mm is fast, 0.25 mm balanced, 0.15 mm fine.

## From shapes

Select closed shapes, pick a **profile** and **height**, then **Add selected shapes**:

- **Flat**: a raised plateau.
- **Dome**: a smooth pillow over the whole shape.
- **Angle**: slopes up from the edge at the angle, flat once it reaches the height.
- **Round**: a rounded edge, flat on top.

**Combine** decides how it meets what is already there: add (raise), subtract (lower), merge high,
merge low, or zero (flatten).

## From a picture

**Add image…** places a grayscale picture over the material: bright parts high, dark parts low.
Set the image height first.

## Whole relief

Smooth, scale the height, or invert (flip high and low).

## Viewing and exporting

**Show 3D view** (or the 3D View tab) to turn it around. **Export STL** saves a watertight mesh,
for 3D printing or other programs.

## Front and back relief

**Back Relief** in the Project tree is a second relief for the other face of the board. It is
designed as seen from the front, so it lines up with the front relief. Its toolpaths are mirrored
for you: turn the material over left to right before running them (the G-code says so). Naqsh
warns when the front and back together are deeper than the material.
