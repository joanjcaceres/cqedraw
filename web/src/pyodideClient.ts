import {
  CircuitProject,
  ModalAnalysisResult,
  OutputResult,
  StructuredExportResult,
} from "./types";

type PrewarmTarget = "base" | "analysis";

type WorkerResult<T> = {
  id: number;
  ok: boolean;
  result?: T;
  error?: string;
};

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

export class PyodideBridgeClient {
  private worker: Worker;
  private failure: Error | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest<unknown>>();

  constructor() {
    this.worker = new Worker(new URL("./workers/pyodideWorker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResult<unknown>>) => {
      const request = this.pending.get(event.data.id);
      if (!request) {
        return;
      }
      this.pending.delete(event.data.id);
      if (event.data.ok) {
        request.resolve(event.data.result);
      } else {
        request.reject(new Error(event.data.error ?? "Pyodide worker failed."));
      }
    };
    this.worker.onerror = (event) => {
      this.handleWorkerFailure(
        new Error(event.message || "Pyodide worker failed."),
      );
    };
    this.worker.onmessageerror = () => {
      this.handleWorkerFailure(new Error("Pyodide worker sent an invalid message."));
    };
  }

  generate(project: CircuitProject): Promise<OutputResult> {
    return this.send<OutputResult>("generate", project);
  }

  analyze(
    project: CircuitProject,
    params: Record<string, string>,
  ): Promise<ModalAnalysisResult> {
    return this.send<ModalAnalysisResult>("analyze", project, params);
  }

  exportStructuredJson(
    project: CircuitProject,
    params: Record<string, string>,
    analysis: ModalAnalysisResult | null,
  ): Promise<StructuredExportResult> {
    return this.send<StructuredExportResult>(
      "export",
      project,
      params,
      undefined,
      analysis,
    );
  }

  normalize(project: unknown): Promise<CircuitProject> {
    return this.send<CircuitProject>("normalize", project);
  }

  async prewarmBase(): Promise<void> {
    await this.send("prewarm", null, undefined, "base");
  }

  async prewarmAnalysis(): Promise<void> {
    await this.send("prewarm", null, undefined, "analysis");
  }

  dispose(): void {
    this.worker.terminate();
    this.rejectPending(new Error("Pyodide worker disposed."));
  }

  private send<T>(
    type: "generate" | "normalize" | "analyze" | "export" | "prewarm",
    project: unknown,
    params?: Record<string, string>,
    target?: PrewarmTarget,
    analysis?: ModalAnalysisResult | null,
  ): Promise<T> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ id, type, project, params, target, analysis });
    });
  }

  private handleWorkerFailure(error: Error): void {
    this.failure = error;
    this.worker.terminate();
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}
