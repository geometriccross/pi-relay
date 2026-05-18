import assert from "node:assert/strict";
import { test } from "node:test";

import { isPiLaunchCommand, prependEnv, shellEscape } from "../src/shell.js";

test("isPiLaunchCommand detects direct pi launches", () => {
  assert.equal(isPiLaunchCommand("pi"), true);
  assert.equal(isPiLaunchCommand("pi --model gpt"), true);
});

test("shellEscape preserves safe values and quotes unsafe values", () => {
  assert.equal(shellEscape("abc_123-./:@"), "abc_123-./:@");
  assert.equal(shellEscape("hello world"), "'hello world'");
  assert.equal(shellEscape("parent's session"), "'parent'\\''s session'");
});

test("prependEnv prepends escaped environment assignments", () => {
  assert.equal(
    prependEnv("pi --model test", {
      PI_RELAY_ID: "family-1",
      PI_RELAY_PARENT_NAME: "Parent Session",
    }),
    "PI_RELAY_ID=family-1 PI_RELAY_PARENT_NAME='Parent Session' pi --model test",
  );
});
