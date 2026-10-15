# Before the first cut

Bad G-code breaks bits, damages machines and can injure people. Naqsh checks every file it
exports, but no software check replaces you watching the machine.

## What Naqsh checks for you

Every exported file is read back by an independent G-code checker. **Export is blocked** if any
of these fails:

| Check | Rule |
|---|---|
| Envelope | Every move inside machine travel and inside stock + clearance |
| Depth | No cut below stock bottom (or below spoilboard allowance) |
| Rapids | `G0` only at or above safe Z, except a final plunge approach |
| Feeds | Feed and plunge ≤ machine max; spindle on before cutting moves |
| Units/modal | Explicit `G21`/`G20`, `G90`, work-coordinate setup in header |
| Tool | Tool geometry consistent with toolpath type (e.g. V-carve needs V-bit) |
| Preview | Export blocked until the toolpath has been simulated once |

The checker only knows what you told it. If the material size, machine travel, Z zero or tool
are wrong in the project, the file can pass the checks and still be wrong for your machine.

## Your checklist, every job

1. **Machine settings** (Toolpaths › Machine): controller, safe height, max feed and travel
   match your router.
2. **Material** (Vectors › Material): size, thickness, origin corner and Z zero match the board
   on the bed and how you will zero the machine.
3. **Tool**: the bit in the spindle is the one the toolpath uses (type, diameter, angle). The
   G-code header names it.
4. **Simulate** and look at the result: depth, position, tabs. Read any warnings.
5. **Clamp** the material clear of the tool path, including the cut-out. Use tabs or a
   spoilboard.
6. **Zero** X, Y and Z exactly as the project says (origin corner, top of material or bed).
7. **Air-cut first**: raise Z well above the material (or zero Z higher) and run the file. Watch
   that every move goes where you expect.
8. Then cut **foam or soft wood**, check the sizes, and only then your real material.
9. **Stay at the machine** with the stop button in reach. Wear eye and ear protection.

## Back reliefs

A back relief file says so in its header: turn the material over **left to right** (about its
vertical centre line), keep the same X0 Y0 corner, then run it.

## If something looks wrong

Stop the machine. Save the project and the `.nc` file and report it (Help › Report a problem).
Never "fix" a file by hand to get past the checker.
