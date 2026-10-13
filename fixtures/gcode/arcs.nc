(Arc forms: I/J, R+, R-, full circle, helix)
G21 G90 G17 G54
M3 S16000
G0 Z5
G0 X10 Y0
G1 Z-1 F200
; quarter CCW about the origin: (10,0) -> (0,10)
G3 X0 Y10 I-10 J0 F800
; quarter CW back, centre at the origin, R form (short way)
G2 X10 Y0 R10
; three-quarter CW the long way, negative R: (10,0) -> (0,10)
G2 X0 Y10 R-10
; full circle CCW about (0,0), start = end
G3 X0 Y10 I0 J-10
; helix: half circle CCW down 2 mm
G3 X0 Y-10 Z-3 I0 J-10
G0 Z5
M5
M30
