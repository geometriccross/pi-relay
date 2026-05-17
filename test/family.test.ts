import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { buildChildEnv, detectParentFromEnv, listFamilyMembers, registerMember } from "../src/family.js";
import {
  FAMILY_ENV_CHILD_INDEX,
  FAMILY_ENV_FAMILY_ID,
  FAMILY_ENV_PARENT_NAME,
  FAMILY_ENV_PARENT_SESSION,
} from "../src/types.js";

const originalEnv = { ...process.env };
let cleanupDirs: string[] = [];

afterEach(() => {
  process.env = { ...originalEnv };
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
  cleanupDirs = [];
});

test("detectParentFromEnv normalizes invalid child index to zero", () => {
  process.env[FAMILY_ENV_FAMILY_ID] = "family-1";
  process.env[FAMILY_ENV_PARENT_SESSION] = "parent-1";
  process.env[FAMILY_ENV_PARENT_NAME] = "Parent";
  process.env[FAMILY_ENV_CHILD_INDEX] = "not-a-number";

  assert.deepEqual(detectParentFromEnv(), {
    familyId: "family-1",
    parentSessionId: "parent-1",
    parentName: "Parent",
    childIndex: 0,
  });
});

test("buildChildEnv includes all variables required by a child session", () => {
  assert.deepEqual(
    buildChildEnv("parent-1", "Parent", "family-1", 3, "child-1"),
    {
      PI_FAMILY_SESSION_ID: "child-1",
      PI_FAMILY_ID: "family-1",
      PI_FAMILY_ROLE: "child",
      PI_FAMILY_PARENT_SESSION: "parent-1",
      PI_FAMILY_PARENT_NAME: "Parent",
      PI_FAMILY_CHILD_INDEX: "3",
    },
  );
});

test("registerMember and listFamilyMembers use an injected family directory", () => {
  const familyDir = mkdtempSync(join(tmpdir(), "pi-family-registry-test-"));
  cleanupDirs.push(familyDir);

  const familyId = `family-${Date.now()}`;

  registerMember(familyId, {
    sessionId: "parent-1",
    name: "Parent",
    role: "parent",
    pid: process.pid,
    cwd: "/tmp/project",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastActivity: "2026-01-01T00:00:00.000Z",
  }, familyDir);

  assert.equal(existsSync(join(familyDir, familyId, "parent-1.json")), true);
  assert.deepEqual(listFamilyMembers(familyId, familyDir).map((m) => m.sessionId), ["parent-1"]);
});
