(EXPECT rule=envelope line=0)
(Z range -2 to 150 is 152 mm; machine Z travel is 100 mm)
G21 G90 G17 G54
M3 S18000
G0 Z150
G0 X10 Y10
G0 Z5
G1 Z-2 F300
G1 X100 F1200
G0 Z5
M5
M30
