import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./server.ts";

test("numeric runtime predicates ignore blank strings and non-numeric values", () => {
  assert.equal(__test__.toComparableNumber(""), undefined);
  assert.equal(__test__.toComparableNumber("   "), undefined);
  assert.equal(__test__.toComparableNumber("abc"), undefined);
  assert.equal(__test__.toComparableNumber({}), undefined);

  assert.equal(__test__.matchesRuntimeCondition("", "greater_than", -1), false);
  assert.equal(__test__.matchesRuntimeCondition("   ", "greater_than", -1), false);
  assert.equal(__test__.matchesRuntimeCondition("abc", "greater_than", -1), false);
});

test("numeric runtime predicates still accept finite numbers and numeric strings", () => {
  assert.equal(__test__.toComparableNumber(3), 3);
  assert.equal(__test__.toComparableNumber(" 3.5 "), 3.5);

  assert.equal(__test__.matchesRuntimeCondition("3.5", "greater_than", 3), true);
  assert.equal(__test__.matchesRuntimeCondition(3, "greater_or_equal", "3"), true);
  assert.equal(__test__.matchesRuntimeCondition("2", "less_than", "3"), true);
});
