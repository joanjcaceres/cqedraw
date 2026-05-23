import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PyodideBridgeClient } from "../pyodideClient";

interface PostedMessage {
  analysis?: unknown;
  id: number;
  params?: Record<string, string>;
  project?: unknown;
  type: string;
  target?: string;
}

class FakeWorker {
  static instances: FakeWorker[] = [];

  messages: PostedMessage[] = [];
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: PostedMessage) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(id: number, payload: { ok: boolean; result?: unknown; error?: string }) {
    this.onmessage?.({ data: { id, ...payload } } as MessageEvent);
  }
}

describe("PyodideBridgeClient prewarm", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends base and analysis prewarm requests", async () => {
    const client = new PyodideBridgeClient();
    const worker = FakeWorker.instances[0];

    const basePrewarm = client.prewarmBase();
    expect(worker.messages.at(-1)).toMatchObject({
      id: 1,
      target: "base",
      type: "prewarm",
    });
    worker.respond(1, { ok: true, result: { target: "base" } });
    await expect(basePrewarm).resolves.toBeUndefined();

    const analysisPrewarm = client.prewarmAnalysis();
    expect(worker.messages.at(-1)).toMatchObject({
      id: 2,
      target: "analysis",
      type: "prewarm",
    });
    worker.respond(2, { ok: true, result: { target: "analysis" } });
    await expect(analysisPrewarm).resolves.toBeUndefined();

    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("allows a failed prewarm request to be retried", async () => {
    const client = new PyodideBridgeClient();
    const worker = FakeWorker.instances[0];

    const firstPrewarm = client.prewarmBase();
    worker.respond(1, { ok: false, error: "temporary preload failure" });
    await expect(firstPrewarm).rejects.toThrow("temporary preload failure");

    const retryPrewarm = client.prewarmBase();
    expect(worker.messages.at(-1)).toMatchObject({
      id: 2,
      target: "base",
      type: "prewarm",
    });
    worker.respond(2, { ok: true, result: { target: "base" } });
    await expect(retryPrewarm).resolves.toBeUndefined();

    client.dispose();
  });

  it("sends structured export requests with parameters and analysis", async () => {
    const client = new PyodideBridgeClient();
    const worker = FakeWorker.instances[0];
    const project = {
      version: 2,
      state: {
        edge_counter: 0,
        edges: [],
        focus_node: null,
        mode: null,
        node_counter: 0,
        nodes: [],
        selected_node: null,
        selected_nodes: [],
        view_scale: 1,
      },
    };
    const analysis = {
      available: true,
      branches: [],
      frequencies_ghz: [5.1],
    };

    const exportRequest = client.exportStructuredJson(
      project,
      { C: "1e-15" },
      analysis,
    );
    expect(worker.messages.at(-1)).toMatchObject({
      analysis,
      id: 1,
      params: { C: "1e-15" },
      project,
      type: "export",
    });
    worker.respond(1, {
      ok: true,
      result: { format: "cqedraw.evaluated_circuit", schema_version: 1 },
    });
    await expect(exportRequest).resolves.toMatchObject({
      format: "cqedraw.evaluated_circuit",
    });

    client.dispose();
  });
});
