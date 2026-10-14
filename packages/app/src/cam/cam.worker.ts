/// <reference lib="webworker" />
import type { CamRequest } from './protocol';
import { handle } from './work';

/** CAM worker: toolpath generation, simulation and export off the UI thread (plan.md §5 rule 2). */
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<CamRequest>) => {
  const { response, transfer } = handle(e.data);
  scope.postMessage(response, transfer);
};
