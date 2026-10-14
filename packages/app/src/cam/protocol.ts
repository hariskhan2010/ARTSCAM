import type { Issue, Project } from '@naqsh/core';

/** Messages between the UI and the CAM worker. */

export type CamRequest =
  | { id: number; kind: 'preview'; project: Project; toolpathId: string }
  | { id: number; kind: 'simulate'; project: Project; toolpathId: string }
  | { id: number; kind: 'export'; project: Project; toolpathId: string; simulated: boolean };

export interface PreviewResult {
  /** x, y, z, kind per move, in world coordinates (kind: 0 rapid, 1 plunge, 2 cut). */
  path: Float64Array;
  seconds: number;
  cuttingLength: number;
  warnings: string[];
  /** Checker issues other than "not simulated yet". */
  issues: Issue[];
}

export interface SimResult {
  /** Heights, row-major from the bottom-left of the stock. */
  z: Float32Array;
  cols: number;
  rows: number;
  top: number;
  bottom: number;
}

export interface ExportResultMsg {
  ok: boolean;
  gcode: string;
  fileName: string;
  issues: Issue[];
}

export type CamResponse =
  | { id: number; ok: true; kind: 'preview'; result: PreviewResult }
  | { id: number; ok: true; kind: 'simulate'; result: SimResult }
  | { id: number; ok: true; kind: 'export'; result: ExportResultMsg }
  | { id: number; ok: false; error: string };
