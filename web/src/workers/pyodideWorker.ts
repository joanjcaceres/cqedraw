import { loadPyodide } from "pyodide";

import coreSource from "../../../cqedraw/core.py?raw";
import bridgeSource from "../../../cqedraw/web_bridge.py?raw";

interface WorkerRequest {
  id: number;
  type: "generate" | "normalize" | "analyze" | "export" | "prewarm";
  project: unknown;
  params?: Record<string, string>;
  target?: "base" | "analysis";
  analysis?: unknown;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

let readyPromise: Promise<unknown> | null = null;
let pyodideRuntime: Awaited<ReturnType<typeof loadPyodide>> | null = null;
let sccircuitsReadyPromise: Promise<void> | null = null;

const SCCIRCUITS_BBQ_SOURCE_URL =
  "https://raw.githubusercontent.com/joanjcaceres/sccircuits/main/sccircuits/bbq.py";

async function ensureReady() {
  if (readyPromise) {
    return readyPromise;
  }

  readyPromise = initializePyodide().catch((error) => {
    readyPromise = null;
    pyodideRuntime = null;
    throw error;
  });
  return readyPromise;
}

async function initializePyodide() {
    pyodideRuntime = await loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/",
    });
    await pyodideRuntime.loadPackage(["sympy"]);
    pyodideRuntime.FS.mkdirTree("/home/pyodide/cqedraw");
    pyodideRuntime.FS.writeFile("/home/pyodide/cqedraw/__init__.py", "");
    pyodideRuntime.FS.writeFile("/home/pyodide/cqedraw/core.py", coreSource);
    pyodideRuntime.FS.writeFile(
      "/home/pyodide/cqedraw/web_bridge.py",
      bridgeSource,
    );
    pyodideRuntime.runPython(
      [
        "import sys",
        'sys.path.insert(0, "/home/pyodide")',
        "from cqedraw.web_bridge import (",
        "    analyze_modal_cached_json,",
        "    export_analysis_results_json,",
        "    generate_output_json,",
        "    normalize_project_json,",
        ")",
      ].join("\n"),
    );
}

async function ensureSccircuitsBBQ() {
  if (sccircuitsReadyPromise) {
    return sccircuitsReadyPromise;
  }
  sccircuitsReadyPromise = installSccircuitsBBQ().catch((error) => {
    sccircuitsReadyPromise = null;
    throw error;
  });
  return sccircuitsReadyPromise;
}

async function installSccircuitsBBQ() {
  if (!pyodideRuntime) {
    throw new Error("Pyodide did not initialize.");
  }
  await pyodideRuntime.loadPackage(["numpy", "scipy"]);
  try {
    pyodideRuntime.runPython("from sccircuits import BBQ");
    return;
  } catch {
    // The browser bundle loads the numerical BBQ class on demand.
  }

  const response = await fetch(SCCIRCUITS_BBQ_SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Unable to load sccircuits BBQ source: ${response.status}`);
  }
  const source = patchSccircuitsBBQSourceForPyodide(await response.text());
  pyodideRuntime.FS.mkdirTree("/home/pyodide/sccircuits");
  pyodideRuntime.FS.writeFile(
    "/home/pyodide/sccircuits/__init__.py",
    "from .bbq import BBQ\n\n__all__ = [\"BBQ\"]\n",
  );
  pyodideRuntime.FS.writeFile("/home/pyodide/sccircuits/bbq.py", source);
  pyodideRuntime.runPython("from sccircuits import BBQ");
}

function patchSccircuitsBBQSourceForPyodide(source: string): string {
  return source.replace(
    "import matplotlib.pyplot as plt",
    [
      "class _UnavailablePlot:",
      "    def __getattr__(self, name):",
      "        raise RuntimeError(",
      "            \"BBQ plotting is unavailable in the cQEDraw browser worker.\"",
      "        )",
      "",
      "plt = _UnavailablePlot()",
    ].join("\n"),
  );
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, project, params, target, analysis } = event.data;
  try {
    await ensureReady();
    if (!pyodideRuntime) {
      throw new Error("Pyodide did not initialize.");
    }
    if (type === "prewarm") {
      if (target === "analysis") {
        await ensureSccircuitsBBQ();
      }
      const response: WorkerResponse = {
        id,
        ok: true,
        result: { target: target ?? "base" },
      };
      self.postMessage(response);
      return;
    }
    if (type === "analyze") {
      await ensureSccircuitsBBQ();
    }
    pyodideRuntime.globals.set("project_json", JSON.stringify(project));
    let raw: string;
    if (type === "analyze") {
      pyodideRuntime.globals.set("params_json", JSON.stringify(params ?? {}));
      raw = pyodideRuntime.runPython(
        "analyze_modal_cached_json(project_json, params_json)",
      ) as string;
    } else if (type === "export") {
      pyodideRuntime.globals.set("params_json", JSON.stringify(params ?? {}));
      pyodideRuntime.globals.set(
        "analysis_json",
        JSON.stringify(analysis ?? null),
      );
      raw = pyodideRuntime.runPython(
        "export_analysis_results_json(project_json, params_json, analysis_json)",
      ) as string;
    } else {
      const functionName =
        type === "normalize" ? "normalize_project_json" : "generate_output_json";
      raw = pyodideRuntime.runPython(`${functionName}(project_json)`) as string;
    }
    const result = JSON.parse(raw) as unknown;
    const response: WorkerResponse = { id, ok: true, result };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
