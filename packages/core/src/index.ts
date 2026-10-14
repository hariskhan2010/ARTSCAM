export * from './model/schema';
export * from './model/projectFile';

/** Internal length unit. All geometry in core is millimetres, float64. */
export const INTERNAL_UNIT = 'mm';
export * from './model/units';
export * from './model/history';
export * from './gcode/parser';
export * from './gcode/checker';
export * from './vector/path';
export * from './vector/flatten';
export * from './vector/clip';
export * from './vector/shapes';
export * from './vector/svg';
export * from './vector/dxf';
export { parseXml, XmlError, type XmlElement } from './vector/xml';
