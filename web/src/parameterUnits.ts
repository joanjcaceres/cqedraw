import type { CircuitEdge, OutputResult } from "./types";

export type EnergyParameterKind =
  | "capacitance"
  | "linear_inductance"
  | "josephson_inductance";

export type ParameterInputMode = "physical" | "energy";

export interface ParameterInputSpec {
  energyButtonLabel: string | null;
  energyButtonTitle: string | null;
  energyLabel: string | null;
  energyUnit: string | null;
  kind: EnergyParameterKind | null;
  physicalButtonLabel: string;
  physicalButtonTitle: string;
  physicalLabel: string;
  physicalUnit: string;
}

export interface ConvertedParameterValues {
  error: string | null;
  values: Record<string, string>;
}

const ELEMENTARY_CHARGE_C = 1.602176634e-19;
const PLANCK_J_S = 6.62607015e-34;
const REDUCED_FLUX_QUANTUM_WB =
  PLANCK_J_S / (2 * Math.PI) / (2 * ELEMENTARY_CHARGE_C);
const GHZ = 1e9;

const DEFAULT_PARAMETER_SPEC: ParameterInputSpec = {
  energyButtonLabel: null,
  energyButtonTitle: null,
  energyLabel: null,
  energyUnit: null,
  kind: null,
  physicalButtonLabel: "Value",
  physicalButtonTitle: "Value",
  physicalLabel: "Value",
  physicalUnit: "",
};

const PARAMETER_KIND_SPECS: Record<EnergyParameterKind, ParameterInputSpec> = {
  capacitance: {
    energyButtonLabel: "GHz",
    energyButtonTitle: "Gigahertz (GHz), equivalent to E_C/h",
    energyLabel: "E_C",
    energyUnit: "GHz",
    kind: "capacitance",
    physicalButtonLabel: "F",
    physicalButtonTitle: "Farad (F)",
    physicalLabel: "C",
    physicalUnit: "F",
  },
  josephson_inductance: {
    energyButtonLabel: "GHz",
    energyButtonTitle: "Gigahertz (GHz), equivalent to E_J/h",
    energyLabel: "E_J",
    energyUnit: "GHz",
    kind: "josephson_inductance",
    physicalButtonLabel: "H",
    physicalButtonTitle: "Henry (H)",
    physicalLabel: "LJ",
    physicalUnit: "H",
  },
  linear_inductance: {
    energyButtonLabel: "GHz",
    energyButtonTitle: "Gigahertz (GHz), equivalent to E_L/h",
    energyLabel: "E_L",
    energyUnit: "GHz",
    kind: "linear_inductance",
    physicalButtonLabel: "H",
    physicalButtonTitle: "Henry (H)",
    physicalLabel: "L",
    physicalUnit: "H",
  },
};

export function buildParameterInputSpecs(
  output: OutputResult | null,
  edges: CircuitEdge[],
): Record<string, ParameterInputSpec> {
  if (!output) {
    return {};
  }

  return Object.fromEntries(
    output.parameters.map((parameter) => [
      parameter,
      parameterInputSpec(parameter, output, edges),
    ]),
  );
}

export function convertAnalysisParameterValues(
  parameters: string[],
  rawValues: Record<string, string>,
  inputModes: Record<string, ParameterInputMode>,
  inputSpecs: Record<string, ParameterInputSpec>,
): ConvertedParameterValues {
  const values: Record<string, string> = {};
  for (const parameter of parameters) {
    const rawValue = rawValues[parameter] ?? "";
    const trimmedValue = rawValue.trim();
    if (trimmedValue === "") {
      values[parameter] = rawValue;
      continue;
    }

    const mode = inputModes[parameter] ?? "physical";
    const spec = inputSpecs[parameter] ?? DEFAULT_PARAMETER_SPEC;
    const inputError = analysisParameterInputError(
      parameter,
      trimmedValue,
      mode,
      spec,
    );
    if (inputError) {
      return { error: inputError, values };
    }

    if (mode !== "energy" || !spec.kind) {
      values[parameter] = rawValue;
      continue;
    }

    const parsedEnergy = Number(trimmedValue);
    values[parameter] = formatConvertedParameterValue(
      energyGHzToPhysicalValue(spec.kind, parsedEnergy),
    );
  }
  return { error: null, values };
}

export function invalidAnalysisParameterNames(
  parameters: string[],
  rawValues: Record<string, string>,
  inputModes: Record<string, ParameterInputMode>,
  inputSpecs: Record<string, ParameterInputSpec>,
): string[] {
  return parameters.filter((parameter) => {
    const rawValue = rawValues[parameter] ?? "";
    const trimmedValue = rawValue.trim();
    if (trimmedValue === "") {
      return false;
    }
    return Boolean(
      analysisParameterInputError(
        parameter,
        trimmedValue,
        inputModes[parameter] ?? "physical",
        inputSpecs[parameter] ?? DEFAULT_PARAMETER_SPEC,
      ),
    );
  });
}

export function convertParameterDisplayValue(
  valueText: string,
  spec: ParameterInputSpec | undefined,
  fromMode: ParameterInputMode,
  toMode: ParameterInputMode,
): string {
  if (fromMode === toMode || !spec?.kind) {
    return valueText;
  }
  const value = Number(valueText.trim());
  if (!Number.isFinite(value) || value <= 0) {
    return valueText;
  }

  const physicalValue =
    fromMode === "energy" ? energyGHzToPhysicalValue(spec.kind, value) : value;
  const convertedValue =
    toMode === "energy"
      ? physicalValueToEnergyGHz(spec.kind, physicalValue)
      : physicalValue;
  return formatConvertedParameterValue(convertedValue);
}

export function energyGHzToPhysicalValue(
  kind: EnergyParameterKind,
  energyGHz: number,
): number {
  const energyJ = PLANCK_J_S * energyGHz * GHZ;
  if (kind === "capacitance") {
    return ELEMENTARY_CHARGE_C ** 2 / (2 * energyJ);
  }
  return REDUCED_FLUX_QUANTUM_WB ** 2 / energyJ;
}

export function physicalValueToEnergyGHz(
  kind: EnergyParameterKind,
  physicalValue: number,
): number {
  const energyJ =
    kind === "capacitance"
      ? ELEMENTARY_CHARGE_C ** 2 / (2 * physicalValue)
      : REDUCED_FLUX_QUANTUM_WB ** 2 / physicalValue;
  return energyJ / PLANCK_J_S / GHZ;
}

function parameterInputSpec(
  parameter: string,
  output: OutputResult,
  edges: CircuitEdge[],
): ParameterInputSpec {
  const roles = new Set<EnergyParameterKind>();
  const isCapacitanceParameter = output.c_parameters.includes(parameter);
  const isLInvParameter = output.l_inv_parameters.includes(parameter);
  const isJosephsonParameter = output.josephson_parameters.includes(parameter);

  for (const edge of edges) {
    if (
      isCapacitanceParameter &&
      isExactComponentParameter(edge.capacitance_text, parameter)
    ) {
      roles.add("capacitance");
    }
    if (
      isLInvParameter &&
      isExactComponentParameter(edge.inductance_text, parameter)
    ) {
      roles.add("linear_inductance");
    }
    if (
      isJosephsonParameter &&
      isExactComponentParameter(edge.josephson_inductance_text, parameter)
    ) {
      roles.add("josephson_inductance");
    }
  }

  if (roles.size !== 1) {
    return DEFAULT_PARAMETER_SPEC;
  }
  const kind = roles.values().next().value as EnergyParameterKind;
  return PARAMETER_KIND_SPECS[kind];
}

function isExactComponentParameter(
  valueText: string | null,
  parameter: string,
): boolean {
  return valueText?.trim() === parameter;
}

function formatConvertedParameterValue(value: number): string {
  return Number(value.toPrecision(12)).toString();
}

function analysisParameterInputError(
  parameter: string,
  trimmedValue: string,
  mode: ParameterInputMode,
  spec: ParameterInputSpec,
): string | null {
  const parsedValue = Number(trimmedValue);
  if (!Number.isFinite(parsedValue)) {
    return `Parameter ${parameter} must be a finite number.`;
  }
  if (mode === "energy" && spec.kind && parsedValue <= 0) {
    return `Enter a positive ${spec.energyLabel}/h value in GHz for ${parameter}.`;
  }
  return null;
}
