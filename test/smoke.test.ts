import assert from "node:assert/strict";
import { test } from "node:test";

import * as family from "../src/family.js";
import * as mailbox from "../src/mailbox.js";
import * as shell from "../src/shell.js";
import * as toolLogic from "../src/tool-logic.js";
import * as types from "../src/types.js";

test("smoke: family module exports relationship helpers", () => {
  assert.equal(typeof family.getFamilyDir, "function");
  assert.equal(typeof family.detectParentFromEnv, "function");
  assert.equal(typeof family.detectOwnSessionId, "function");
  assert.equal(typeof family.detectSelfFromEnv, "function");
  assert.equal(typeof family.buildChildEnv, "function");
  assert.equal(typeof family.buildSelfEnv, "function");
  assert.equal(typeof family.registerMember, "function");
  assert.equal(typeof family.unregisterMember, "function");
  assert.equal(typeof family.listFamilyMembers, "function");
  assert.equal(typeof family.cleanupStaleMembers, "function");
});

test("smoke: mailbox module exports mailbox operations", () => {
  assert.equal(typeof mailbox.sendMessage, "function");
  assert.equal(typeof mailbox.readMessages, "function");
  assert.equal(typeof mailbox.readUnreadMessages, "function");
  assert.equal(typeof mailbox.clearMailbox, "function");
  assert.equal(typeof mailbox.hasMessages, "function");
  assert.equal(typeof mailbox.getLatestTimestamp, "function");
});

test("smoke: shell module exports command helpers", () => {
  assert.equal(typeof shell.isPiLaunchCommand, "function");
  assert.equal(typeof shell.shellEscape, "function");
  assert.equal(typeof shell.prependEnv, "function");
});

test("smoke: tool-logic module exports pure tool helpers", () => {
  assert.equal(typeof toolLogic.resolveChild, "function");
  assert.equal(typeof toolLogic.findLastIncoming, "function");
});

test("smoke: types module exports runtime environment constants", () => {
  assert.equal(types.RELAY_ENV_SESSION_ID, "PI_RELAY_SESSION_ID");
  assert.equal(types.RELAY_ENV_RELAY_ID, "PI_RELAY_ID");
  assert.equal(types.RELAY_ENV_ROLE, "PI_RELAY_ROLE");
  assert.equal(types.RELAY_ENV_PARENT_SESSION, "PI_RELAY_PARENT_SESSION");
  assert.equal(types.RELAY_ENV_PARENT_NAME, "PI_RELAY_PARENT_NAME");
  assert.equal(types.RELAY_ENV_CHILD_INDEX, "PI_RELAY_CHILD_INDEX");
  assert.equal(types.RELAY_ENV_DIR, "PI_RELAY_DIR");
});
