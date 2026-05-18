import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

let cleanupDirs: string[] = [];

function createSettingsPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-relay-settings-test-"));
  cleanupDirs.push(dir);
  return join(dir, "settings.json");
}

afterEach(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
  cleanupDirs = [];
});

test("loadConfig returns defaults when settings.json does not exist", () => {
  const settingsPath = createSettingsPath();

  assert.deepEqual(loadConfig(settingsPath), DEFAULT_CONFIG);
});

test("loadConfig reads pi-relay settings from settings.json", () => {
  const settingsPath = createSettingsPath();
  writeFileSync(settingsPath, JSON.stringify({
    "pi-relay": {
      enabled: false,
      pollIntervalMs: 2500,
      askTimeoutMs: 12345,
    },
  }), "utf-8");

  assert.deepEqual(loadConfig(settingsPath), {
    ...DEFAULT_CONFIG,
    enabled: false,
    pollIntervalMs: 2500,
    askTimeoutMs: 12345,
  });
});

test("loadConfig ignores malformed settings.json and returns defaults", () => {
  const settingsPath = createSettingsPath();
  writeFileSync(settingsPath, "{not json", "utf-8");

  assert.deepEqual(loadConfig(settingsPath), DEFAULT_CONFIG);
});
