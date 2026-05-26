import { describe, expect, it } from "vitest";

import {
  buildParameterInputSpecs,
  convertAnalysisParameterValues,
  convertParameterDisplayValue,
  energyGHzToPhysicalValue,
  type ParameterInputMode,
} from "../parameterUnits";
import type { CircuitEdge, OutputResult } from "../types";

describe("parameter unit conversions", () => {
  it("converts Ec, El, and Ej in GHz to physical analysis values", () => {
    expect(energyGHzToPhysicalValue("capacitance", 1)).toBeCloseTo(
      1.937e-14,
      17,
    );
    expect(energyGHzToPhysicalValue("linear_inductance", 1)).toBeCloseTo(
      1.634615128e-7,
      10,
    );
    expect(energyGHzToPhysicalValue("josephson_inductance", 10)).toBeCloseTo(
      1.634615128e-8,
      10,
    );
  });

  it("round-trips display values when switching representation", () => {
    const output = outputWithParameters(["C"]);
    output.c_parameters = ["C"];
    const specs = buildParameterInputSpecs(output, [
      edge({ capacitance_text: "C" }),
    ]);

    const energyText = convertParameterDisplayValue(
      "1.937e-14",
      specs.C,
      "physical",
      "energy",
    );
    const physicalText = convertParameterDisplayValue(
      energyText,
      specs.C,
      "energy",
      "physical",
    );

    expect(Number(energyText)).toBeCloseTo(1, 3);
    expect(Number(physicalText)).toBeCloseTo(1.937e-14, 17);
  });

  it("offers energy input only for exact component parameters", () => {
    const output = outputWithParameters(["C", "L", "Linv", "Lj", "shared"]);
    output.c_parameters = ["C", "shared"];
    output.l_inv_parameters = ["L", "Linv", "Lj", "shared"];
    output.josephson_parameters = ["Lj"];
    const specs = buildParameterInputSpecs(output, [
      edge({ capacitance_text: "C" }),
      edge({ inductance_text: "L" }),
      edge({ inductance_text: "1/Linv" }),
      edge({ josephson_inductance_text: "Lj" }),
      edge({ capacitance_text: "shared", inductance_text: "shared" }),
    ]);

    expect(specs.C.kind).toBe("capacitance");
    expect(specs.L.kind).toBe("linear_inductance");
    expect(specs.Lj.kind).toBe("josephson_inductance");
    expect(specs.Linv.kind).toBeNull();
    expect(specs.shared.kind).toBeNull();
  });

  it("converts selected energy-mode parameters before analysis", () => {
    const output = outputWithParameters(["C", "L", "Lj"]);
    output.c_parameters = ["C"];
    output.l_inv_parameters = ["L", "Lj"];
    output.josephson_parameters = ["Lj"];
    const specs = buildParameterInputSpecs(output, [
      edge({ capacitance_text: "C" }),
      edge({ inductance_text: "L" }),
      edge({ josephson_inductance_text: "Lj" }),
    ]);
    const modes: Record<string, ParameterInputMode> = {
      C: "energy",
      L: "physical",
      Lj: "energy",
    };

    const converted = convertAnalysisParameterValues(
      output.parameters,
      { C: "1", L: "3e-9", Lj: "10" },
      modes,
      specs,
    );

    expect(converted.error).toBeNull();
    expect(Number(converted.values.C)).toBeCloseTo(
      energyGHzToPhysicalValue("capacitance", 1),
      17,
    );
    expect(converted.values.L).toBe("3e-9");
    expect(Number(converted.values.Lj)).toBeCloseTo(
      energyGHzToPhysicalValue("josephson_inductance", 10),
      10,
    );
  });

  it("rejects non-positive energy values", () => {
    const output = outputWithParameters(["C"]);
    output.c_parameters = ["C"];
    const specs = buildParameterInputSpecs(output, [
      edge({ capacitance_text: "C" }),
    ]);

    const converted = convertAnalysisParameterValues(
      output.parameters,
      { C: "0" },
      { C: "energy" },
      specs,
    );

    expect(converted.error).toBe("Enter a positive E_C/h value in GHz for C.");
  });
});

function outputWithParameters(parameters: string[]): OutputResult {
  return {
    c_entries: [],
    c_parameters: [],
    josephson_branches: [],
    josephson_parameters: [],
    l_inv_entries: [],
    l_inv_parameters: [],
    matrix_nodes: [],
    parameters,
    size: 0,
    snippet: "",
  };
}

function edge(updates: Partial<CircuitEdge>): CircuitEdge {
  return {
    capacitance_expr: null,
    capacitance_text: null,
    ground_offset_x: 0,
    ground_offset_y: 0,
    identifier: 0,
    inductance_expr: null,
    inductance_text: null,
    is_ground: false,
    josephson_inductance_expr: null,
    josephson_inductance_text: null,
    josephson_phase_sign: 1,
    l_inverse_expr: null,
    nodes: [0, 1],
    ...updates,
  };
}
