(EXPECT rule=envelope line=8)
(Both arc end points are inside the stock; the arc itself bulges out to X340)
G21 G90 G17 G54
M3 S18000
G0 Z5
G0 X290 Y50
G1 Z-2 F300
G3 X290 Y150 I0 J50 F1200
G0 Z5
M5
M30
