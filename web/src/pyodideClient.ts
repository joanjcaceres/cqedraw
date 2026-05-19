import { CircuitProject, OutputResult } from "./types";

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
  }

  generate(project: CircuitProject): Promise<OutputResult> {
    return this.send<OutputResult>("generate", project);
  }

  normalize(project: unknown): Promise<CircuitProject> {
    return this.send<CircuitProject>("normalize", project);
  }

  dispose(): void {
    this.worker.terminate();
    for (const request of this.pending.values()) {
      request.reject(new Error("Pyodide worker disposed."));
    }
    this.pending.clear();
  }

  private send<T>(type: "generate" | "normalize", project: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.worker.postMessage({ id, type, project });
    });
  }
}
