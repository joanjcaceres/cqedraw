import { loadPyodide } from "pyodide";

import coreSource from "../../../cqedraw/core.py?raw";
import bridgeSource from "../../../cqedraw/web_bridge.py?raw";

interface WorkerRequest {
  id: number;
  type: "generate" | "normalize";
  project: unknown;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

let readyPromise: Promise<unknown> | null = null;
let pyodideRuntime: Awaited<ReturnType<typeof loadPyodide>> | null = null;

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
        "from cqedraw.web_bridge import generate_output_json, normalize_project_json",
      ].join("\n"),
    );
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, project } = event.data;
  try {
    await ensureReady();
    if (!pyodideRuntime) {
      throw new Error("Pyodide did not initialize.");
    }
    pyodideRuntime.globals.set("project_json", JSON.stringify(project));
    const functionName =
      type === "normalize" ? "normalize_project_json" : "generate_output_json";
    const raw = pyodideRuntime.runPython(`${functionName}(project_json)`) as string;
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
