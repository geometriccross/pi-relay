import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { readMessages, sendMessage } from "../src/mailbox.js";
import type { MailboxOptions } from "../src/mailbox.js";

let cleanupDirs: string[] = [];

function createMailboxOptions(): MailboxOptions {
  const familyDir = mkdtempSync(join(tmpdir(), "pi-family-test-"));
  cleanupDirs.push(familyDir);
  return { familyDir, familyId: "family-1" };
}

afterEach(() => {
  for (const dir of cleanupDirs) rmSync(dir, { recursive: true, force: true });
  cleanupDirs = [];
});

test("sendMessage appends a message that readMessages returns", () => {
  const opts = createMailboxOptions();

  const messageId = sendMessage(opts, {
    from: "parent-1",
    fromName: "Parent",
    to: "child-1",
    text: "hello child",
  });

  const messages = readMessages(opts, "child-1");

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.id, messageId);
  assert.equal(messages[0]?.from, "parent-1");
  assert.equal(messages[0]?.fromName, "Parent");
  assert.equal(messages[0]?.to, "child-1");
  assert.equal(messages[0]?.text, "hello child");
  assert.match(messages[0]?.timestamp ?? "", /^\d{4}-\d{2}-\d{2}T/);
});
