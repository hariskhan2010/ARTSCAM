import { toolpathKey, type Issue, type Project } from '@naqsh/core';
import type {
  CamRequest,
  CamResponse,
  ExportResultMsg,
  PreviewResult,
  SimResult,
} from './protocol';

/**
 * Talks to the CAM worker and remembers derived results per toolpath. A
 * toolpath counts as simulated only while its `toolpathKey` (everything its
 * output depends on) matches the key it was simulated with, so any edit
 * re-locks export (plan.md §7 "Preview").
 */

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never;
type Job = Distribute<CamRequest>;

export interface ToolpathState {
  /** Key of the inputs the preview was made from. */
  key: string;
  preview?: PreviewResult | undefined;
  sim?: (SimResult & { key: string }) | undefined;
  error?: string | undefined;
  busy?: 'preview' | 'simulate' | 'export' | undefined;
  lastExport?: { ok: boolean; issues: Issue[]; fileName: string } | undefined;
}

export class CamRunner {
  #worker: Worker | undefined;
  #nextId = 1;
  #pending = new Map<number, (r: CamResponse) => void>();
  readonly state = new Map<string, ToolpathState>();

  constructor(
    private readonly onChange: () => void,
    /** Relief images, read on every request (they can be added at any time). */
    private readonly getImages: () => Record<string, Uint8Array> = () => ({}),
    private readonly createWorker: () => Worker = () =>
      new Worker(new URL('./cam.worker.ts', import.meta.url), { type: 'module' }),
  ) {}

  #call(job: Job): Promise<CamResponse> {
    if (!this.#worker) {
      this.#worker = this.createWorker();
      this.#worker.onmessage = (e: MessageEvent<CamResponse>) => {
        const resolve = this.#pending.get(e.data.id);
        this.#pending.delete(e.data.id);
        resolve?.(e.data);
      };
    }
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      (this.#worker as Worker).postMessage({ ...job, id });
    });
  }

  #patch(tpId: string, patch: Partial<ToolpathState>) {
    const cur = this.state.get(tpId) ?? { key: '' };
    this.state.set(tpId, { ...cur, ...patch });
    this.onChange();
  }

  isSimulated(project: Project, tpId: string): boolean {
    const s = this.state.get(tpId)?.sim;
    return !!s && s.key === toolpathKey(project, tpId);
  }

  /** Regenerates the preview when the toolpath's inputs changed. */
  async refresh(project: Project, tpId: string): Promise<void> {
    const key = toolpathKey(project, tpId);
    const cur = this.state.get(tpId);
    if (!key || (cur && cur.key === key && (cur.preview || cur.error || cur.busy))) return;
    this.#patch(tpId, { key, busy: 'preview' });
    const res = await this.#call({
      kind: 'preview',
      project,
      toolpathId: tpId,
      images: this.getImages(),
    });
    const now = this.state.get(tpId);
    if (now?.key !== key) return; // superseded by a newer edit
    this.#patch(
      tpId,
      res.ok && res.kind === 'preview'
        ? { preview: res.result, error: undefined, busy: undefined }
        : { preview: undefined, error: res.ok ? 'Unexpected reply' : res.error, busy: undefined },
    );
  }

  async simulate(project: Project, tpId: string): Promise<void> {
    const key = toolpathKey(project, tpId);
    this.#patch(tpId, { busy: 'simulate' });
    const res = await this.#call({
      kind: 'simulate',
      project,
      toolpathId: tpId,
      images: this.getImages(),
    });
    if (res.ok && res.kind === 'simulate')
      this.#patch(tpId, { sim: { ...res.result, key }, busy: undefined });
    else if (!res.ok) this.#patch(tpId, { error: res.error, busy: undefined });
  }

  async export(project: Project, tpId: string): Promise<ExportResultMsg | undefined> {
    this.#patch(tpId, { busy: 'export' });
    const res = await this.#call({
      kind: 'export',
      project,
      toolpathId: tpId,
      simulated: this.isSimulated(project, tpId),
      images: this.getImages(),
    });
    if (res.ok && res.kind === 'export') {
      const { ok, issues, fileName } = res.result;
      this.#patch(tpId, { busy: undefined, lastExport: { ok, issues, fileName } });
      return res.result;
    }
    if (!res.ok) this.#patch(tpId, { error: res.error, busy: undefined });
    return undefined;
  }

  dispose(): void {
    this.#worker?.terminate();
  }
}
