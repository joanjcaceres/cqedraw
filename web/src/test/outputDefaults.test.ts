import { describe, expect, it } from "vitest";

import {
  applyOutputDefaultsToProject,
  buildOutputDefaults,
  extractProjectParameterNames,
  outputDefaultsStateFromProject,
  readProjectOutputDefaults,
} from "../outputDefaults";
import type { CircuitProject } from "../types";

describe("output defaults metadata", () => {
  it("builds sorted optional metadata from non-empty values and energy modes", () => {
    expect(
      buildOutputDefaults(
        ["Lj", "Cj"],
        { Cj: "0.25", Lj: "20", stale: "ignore" },
        { Cj: "energy", Lj: "physical", stale: "energy" },
      ),
    ).toEqual({
      parameter_input_modes: { Cj: "energy" },
      parameter_values: { Cj: "0.25", Lj: "20" },
      schema_version: 1,
    });
  });

  it("round-trips web metadata without changing the graph payload", () => {
    const project = projectWithExpressions("Cj", "Lj");
    const defaults = buildOutputDefaults(
      ["Cj", "Lj"],
      { Cj: "0.25", Lj: "20" },
      { Cj: "energy", Lj: "energy" },
    );
    const projectForSave = applyOutputDefaultsToProject(project, defaults);

    expect(projectForSave.state).toEqual(project.state);
    expect(projectForSave.web?.output_defaults).toEqual(defaults);
    expect(outputDefaultsStateFromProject(projectForSave, ["Cj", "Lj"])).toEqual({
      parameterInputModes: { Cj: "energy", Lj: "energy" },
      parameterValues: { Cj: "0.25", Lj: "20" },
    });
  });

  it("prunes stale saved defaults against the loaded project parameters", () => {
    const projectForSave = applyOutputDefaultsToProject(
      projectWithExpressions("Ckeep", null),
      {
        parameter_input_modes: { Ckeep: "energy", Cstale: "energy" },
        parameter_values: { Ckeep: "0.2", Cstale: "99" },
        schema_version: 1,
      },
    );

    expect(extractProjectParameterNames(projectForSave)).toEqual(["Ckeep"]);
    expect(readProjectOutputDefaults(projectForSave, ["Ckeep"])).toEqual({
      parameter_input_modes: { Ckeep: "energy" },
      parameter_values: { Ckeep: "0.2" },
      schema_version: 1,
    });
  });
});

function projectWithExpressions(
  capacitanceText: string | null,
  josephsonInductanceText: string | null,
): CircuitProject {
  return {
    version: 2,
    state: {
      edge_counter: 1,
      focus_node: null,
      mode: null,
      node_counter: 1,
      nodes: [{ identifier: 0, name: "N1", x: 100, y: 100 }],
      selected_node: null,
      selected_nodes: [],
      view_scale: 1,
      edges: [
        {
          capacitance_expr: capacitanceText,
          capacitance_text: capacitanceText,
          ground_offset_x: 0,
          ground_offset_y: 104,
          identifier: 0,
          inductance_expr: null,
          inductance_text: null,
          is_ground: true,
          josephson_inductance_expr: josephsonInductanceText,
          josephson_inductance_text: josephsonInductanceText,
          josephson_phase_sign: 1,
          l_inverse_expr: null,
          nodes: [0, -1],
        },
      ],
    },
  };
}
