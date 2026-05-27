import type { ParameterInputMode } from "./parameterUnits";
import type {
  CircuitProject,
  CircuitProjectOutputDefaults,
} from "./types";

export const EMPTY_OUTPUT_DEFAULTS_SNAPSHOT = "null";

const OUTPUT_DEFAULTS_SCHEMA_VERSION = 1;
const WEB_METADATA_SCHEMA_VERSION = 1;
const PARAMETER_NAME_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g;

export interface OutputDefaultsState {
  parameterInputModes: Record<string, ParameterInputMode>;
  parameterValues: Record<string, string>;
}

export function applyOutputDefaultsToProject(
  project: CircuitProject,
  defaults: CircuitProjectOutputDefaults | undefined,
): CircuitProject {
  if (!defaults) {
    const { web: _web, ...projectWithoutWeb } = project;
    return projectWithoutWeb;
  }
  return {
    ...project,
    web: {
      ...project.web,
      output_defaults: defaults,
      schema_version: WEB_METADATA_SCHEMA_VERSION,
    },
  };
}

export function buildOutputDefaults(
  parameterNames: string[],
  parameterValues: Record<string, string>,
  parameterInputModes: Record<string, ParameterInputMode>,
): CircuitProjectOutputDefaults | undefined {
  const names = normalizedParameterNames(parameterNames, [
    ...Object.keys(parameterValues),
    ...Object.keys(parameterInputModes),
  ]);
  const values: Record<string, string> = {};
  const modes: Record<string, "energy" | "physical"> = {};

  for (const name of names) {
    const value = parameterValues[name] ?? "";
    if (value.trim()) {
      values[name] = value;
    }
    const mode = parameterInputModes[name];
    if (mode === "energy") {
      modes[name] = mode;
    }
  }

  if (Object.keys(values).length === 0 && Object.keys(modes).length === 0) {
    return undefined;
  }
  return {
    parameter_input_modes: modes,
    parameter_values: values,
    schema_version: OUTPUT_DEFAULTS_SCHEMA_VERSION,
  };
}

export function extractProjectParameterNames(project: CircuitProject): string[] {
  const names = new Set<string>();
  for (const edge of project.state.edges) {
    for (const value of [
      edge.capacitance_text,
      edge.capacitance_expr,
      edge.inductance_text,
      edge.inductance_expr,
      edge.josephson_inductance_text,
      edge.josephson_inductance_expr,
    ]) {
      for (const name of value?.match(PARAMETER_NAME_PATTERN) ?? []) {
        names.add(name);
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function outputDefaultsStateFromProject(
  input: unknown,
  validParameterNames: string[],
): OutputDefaultsState {
  const defaults = readProjectOutputDefaults(input, validParameterNames);
  return outputDefaultsStateFromMetadata(defaults);
}

export function outputDefaultsStateFromMetadata(
  defaults: CircuitProjectOutputDefaults | undefined,
): OutputDefaultsState {
  return {
    parameterInputModes: defaults?.parameter_input_modes ?? {},
    parameterValues: defaults?.parameter_values ?? {},
  };
}

export function readProjectOutputDefaults(
  input: unknown,
  validParameterNames: string[],
): CircuitProjectOutputDefaults | undefined {
  const root = asRecord(input);
  const web = asRecord(root.web);
  const rawDefaults = asRecord(web.output_defaults);
  const validNames = new Set(validParameterNames);
  const shouldKeepName =
    validParameterNames.length === 0
      ? () => false
      : (name: string) => validNames.has(name);
  const values = readStringRecord(
    rawDefaults.parameter_values,
    shouldKeepName,
  );
  const modes = readInputModeRecord(
    rawDefaults.parameter_input_modes,
    shouldKeepName,
  );

  return buildOutputDefaults(
    normalizedParameterNames(validParameterNames, [
      ...Object.keys(values),
      ...Object.keys(modes),
    ]),
    values,
    modes,
  );
}

export function serializeOutputDefaultsForDirtyCheck(
  defaults: CircuitProjectOutputDefaults | undefined,
): string {
  return JSON.stringify(defaults ?? null);
}

function normalizedParameterNames(
  preferredNames: string[],
  fallbackNames: string[],
): string[] {
  const names = preferredNames.length > 0 ? preferredNames : fallbackNames;
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function readStringRecord(
  value: unknown,
  shouldKeepName: (name: string) => boolean,
): Record<string, string> {
  const record = asRecord(value);
  const result: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(record)) {
    const stringValue = String(rawValue ?? "");
    if (shouldKeepName(name) && stringValue.trim()) {
      result[name] = stringValue;
    }
  }
  return result;
}

function readInputModeRecord(
  value: unknown,
  shouldKeepName: (name: string) => boolean,
): Record<string, ParameterInputMode> {
  const record = asRecord(value);
  const result: Record<string, ParameterInputMode> = {};
  for (const [name, mode] of Object.entries(record)) {
    if (!shouldKeepName(name)) {
      continue;
    }
    if (mode === "energy") {
      result[name] = mode;
    } else if (mode === "physical") {
      result[name] = mode;
    }
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
