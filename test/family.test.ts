import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { buildChildEnv, detectParentFromEnv } from "../src/family.js";
import {
  FAMILY_ENV_CHILD_INDEX,
  FAMILY_ENV_FAMILY_ID,
  FAMILY_ENV_PARENT_NAME,
  FAMILY_ENV_PARENT_SESSION,
} from "../src/types.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
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
