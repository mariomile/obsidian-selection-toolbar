import assert from "node:assert/strict";
import { test } from "node:test";

import { selectionMatchesOriginal } from "./guard.ts";

test("accepts an unchanged selection", () => {
  assert.equal(selectionMatchesOriginal("selected text", "selected text"), true);
});

test("rejects edits made while the AI suggestion was pending", () => {
  assert.equal(selectionMatchesOriginal("user edited", "selected text"), false);
});
