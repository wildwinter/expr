// The PUBLIC surface, imported the way a host imports it.
//
// Every other suite imports from `../src/<module>.js` directly, which is convenient and blind: a
// function can be written, documented and tested while never being exported from the package index.
// That happened to `initialValueFor` in 0.12.0 - the README described it as the shared decision both
// target paths make, and a host could not reach it. This suite is the guard.

import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

const PUBLIC_NAMES = [
  // mounting
  "mountExpressionEditor", "mountEffectsEditor", "valueWizard",
  "renderConditionPreview", "renderEffectsPreview",
  // effects model + the value decisions a host may need to mirror
  "addSet", "addEmit", "removeAt", "moveAt", "updateAt", "seedValueSrc", "initialValueFor",
  // catalogue + operator vocabulary
  "choicesOf", "refOf", "displayName", "filterCatalogue",
  "COMPARABLE_TYPES", "comparisonOpsFor", "rhsTypesFor", "BINARY_LABEL",
];

describe("the package index", () => {
  for (const name of PUBLIC_NAMES) {
    it(`exports ${name}`, () => {
      expect(api, `${name} is missing from the package index - hosts import from here, not from src/`)
        .toHaveProperty(name);
    });
  }
});
