import assert from "node:assert/strict";
import { test } from "node:test";

import { isPiLaunchCommand } from "../src/shell.js";

test("isPiLaunchCommand detects direct pi launches", () => {
  assert.equal(isPiLaunchCommand("pi"), true);
  assert.equal(isPiLaunchCommand("pi --model gpt"), true);
});
