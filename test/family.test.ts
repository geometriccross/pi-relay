import assert from "node:assert/strict";
import fc from "fast-check";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { buildChildEnv, detectParentFromEnv, detectSelfFromEnv, getFamilyDir, listFamilyMembers, registerMember } from "../src/family.js";
import {
  RELAY_ENV_CHILD_INDEX,
  RELAY_ENV_RELAY_ID,
  RELAY_ENV_PARENT_NAME,
  RELAY_ENV_PARENT_SESSION,
  RELAY_ENV_SESSION_ID,
  RELAY_ENV_ROLE,
} from "../src/types.js";

const originalEnv = { ...process.env };
let cleanupDirs: string[] = [];

const envValue = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((value) => !value.includes("\0") && value.trim().length > 0);

afterEach(() => {
  process.env = { ...originalEnv };
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
  cleanupDirs = [];
});

test("getFamilyDir uses PI_RELAY_DIR when set", () => {
  process.env.PI_RELAY_DIR = "/tmp/pi-relay-e2e";

  assert.equal(getFamilyDir(), "/tmp/pi-relay-e2e");
});

test("detectSelfFromEnv reads a seeded parent session", () => {
  process.env.PI_RELAY_SESSION_ID = "parent-e2e";
  process.env.PI_RELAY_ID = "family-e2e";
  process.env.PI_RELAY_ROLE = "parent";

  assert.deepEqual(detectSelfFromEnv(), {
    sessionId: "parent-e2e",
    familyId: "family-e2e",
    role: "parent",
  });
});

test("detectParentFromEnv normalizes invalid child index to zero", () => {
  process.env[RELAY_ENV_RELAY_ID] = "family-1";
  process.env[RELAY_ENV_PARENT_SESSION] = "parent-1";
  process.env[RELAY_ENV_PARENT_NAME] = "Parent";
  process.env[RELAY_ENV_CHILD_INDEX] = "not-a-number";

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
      PI_RELAY_SESSION_ID: "child-1",
      PI_RELAY_ID: "family-1",
      PI_RELAY_ROLE: "child",
      PI_RELAY_PARENT_SESSION: "parent-1",
      PI_RELAY_PARENT_NAME: "Parent",
      PI_RELAY_CHILD_INDEX: "3",
    },
  );
});

test("buildChildEnv values round-trip through process.env parent detection", () => {
  fc.assert(
    fc.property(
      envValue,
      envValue,
      envValue,
      envValue,
      fc.integer({ min: 0, max: 10_000 }),
      (parentSessionId, parentName, familyId, childSessionId, childIndex) => {
        const childEnv = buildChildEnv(
          parentSessionId,
          parentName,
          familyId,
          childIndex,
          childSessionId,
        );

        process.env[RELAY_ENV_SESSION_ID] = childEnv[RELAY_ENV_SESSION_ID];
        process.env[RELAY_ENV_RELAY_ID] = childEnv[RELAY_ENV_RELAY_ID];
        process.env[RELAY_ENV_ROLE] = childEnv[RELAY_ENV_ROLE];
        process.env[RELAY_ENV_PARENT_SESSION] = childEnv[RELAY_ENV_PARENT_SESSION];
        process.env[RELAY_ENV_PARENT_NAME] = childEnv[RELAY_ENV_PARENT_NAME];
        process.env[RELAY_ENV_CHILD_INDEX] = childEnv[RELAY_ENV_CHILD_INDEX];

        assert.deepEqual(detectParentFromEnv(), {
          familyId: familyId.trim(),
          parentSessionId: parentSessionId.trim(),
          parentName: parentName.trim(),
          childIndex,
        });
      },
    ),
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
