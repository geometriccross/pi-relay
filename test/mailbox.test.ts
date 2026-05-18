import assert from "node:assert/strict";
import fc from "fast-check";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { readMessages, sendMessage } from "../src/mailbox.js";
import type { MailboxOptions } from "../src/mailbox.js";

let cleanupDirs: string[] = [];

const idValue = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((value) => !value.includes("\0") && !value.includes("/") && !value.includes("\\"));

const textValue = fc
  .string({ maxLength: 120 })
  .filter((value) => !value.includes("\0"));

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

test("readMessages skips malformed JSONL lines", () => {
  const opts = createMailboxOptions();

  sendMessage(opts, {
    from: "parent-1",
    to: "child-1",
    text: "valid before malformed line",
  });

  const mailboxPath = join(opts.familyDir, opts.familyId, "mailboxes", "child-1.jsonl");
  appendFileSync(mailboxPath, "this is not json\n", "utf-8");

  sendMessage(opts, {
    from: "parent-1",
    to: "child-1",
    text: "valid after malformed line",
  });

  const messages = readMessages(opts, "child-1");

  assert.deepEqual(messages.map((m) => m.text), [
    "valid before malformed line",
    "valid after malformed line",
  ]);
});

test("mailbox preserves randomized message order and payloads", () => {
  fc.assert(
    fc.property(
      idValue,
      fc.array(
        fc.record({
          from: idValue,
          fromName: fc.option(textValue, { nil: undefined }),
          text: textValue,
        }),
        { minLength: 1, maxLength: 25 },
      ),
      (recipient, messagesToSend) => {
        const opts = createMailboxOptions();

        for (const message of messagesToSend) {
          sendMessage(opts, {
            from: message.from,
            fromName: message.fromName,
            to: recipient,
            text: message.text,
          });
        }

        const messages = readMessages(opts, recipient);

        assert.deepEqual(
          messages.map((message) => ({
            from: message.from,
            fromName: message.fromName,
            to: message.to,
            text: message.text,
          })),
          messagesToSend.map((message) => ({
            from: message.from,
            fromName: message.fromName,
            to: recipient,
            text: message.text,
          })),
        );
      },
    ),
  );
});
