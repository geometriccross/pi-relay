import assert from "node:assert/strict";
import { test } from "node:test";

import type { FamilyMember, FamilyMessage } from "../src/types.js";
import { resolveChild, findLastIncoming } from "../src/tool-logic.js";

// ── resolveChild ──────────────────────────────────────────────────────────

const members: FamilyMember[] = [
  {
    sessionId: "child-aaa-1111",
    name: "worker-1",
    role: "child",
    pid: 1001,
    cwd: "/tmp/a",
    startedAt: "2026-01-01T00:00:00.000Z",
    lastActivity: "2026-01-01T00:01:00.000Z",
  },
  {
    sessionId: "child-bbb-2222",
    name: "worker-2",
    role: "child",
    pid: 1002,
    cwd: "/tmp/b",
    startedAt: "2026-01-01T00:00:01.000Z",
    lastActivity: "2026-01-01T00:02:00.000Z",
  },
];

test("resolveChild returns undefined when no children exist", () => {
  assert.equal(resolveChild([], undefined), undefined);
});

test("resolveChild defaults to the most recently started child", () => {
  const result = resolveChild(members, undefined);
  assert.equal(result?.sessionId, "child-bbb-2222");
});

test("resolveChild matches by exact session ID", () => {
  const result = resolveChild(members, "child-aaa-1111");
  assert.equal(result?.sessionId, "child-aaa-1111");
});

test("resolveChild matches by session ID prefix", () => {
  const result = resolveChild(members, "child-aaa");
  assert.equal(result?.sessionId, "child-aaa-1111");
});

test("resolveChild matches by case-insensitive name", () => {
  const result = resolveChild(members, "WORKER-2");
  assert.equal(result?.sessionId, "child-bbb-2222");
});

test("resolveChild returns undefined when query matches nothing", () => {
  const result = resolveChild(members, "nonexistent");
  assert.equal(result, undefined);
});

// ── findLastIncoming ──────────────────────────────────────────────────────

test("findLastIncoming returns undefined when no messages exist", () => {
  assert.equal(findLastIncoming([], "self-1"), undefined);
});

test("findLastIncoming returns the latest message addressed to self", () => {
  const messages: FamilyMessage[] = [
    { id: "m1", from: "other", to: "self-1", text: "first", timestamp: "2026-01-01T00:00:00.000Z" },
    { id: "m2", from: "self-1", to: "other", text: "reply", timestamp: "2026-01-01T00:00:01.000Z" },
    { id: "m3", from: "other", to: "self-1", text: "second", timestamp: "2026-01-01T00:00:02.000Z" },
  ];

  const result = findLastIncoming(messages, "self-1");
  assert.equal(result?.id, "m3");
});

test("findLastIncoming ignores messages not addressed to self", () => {
  const messages: FamilyMessage[] = [
    { id: "m1", from: "self-1", to: "other", text: "outgoing", timestamp: "2026-01-01T00:00:00.000Z" },
  ];

  assert.equal(findLastIncoming(messages, "self-1"), undefined);
});
