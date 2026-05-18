/**
 * File-based mailbox IPC for pi-family.
 *
 * Each session has a mailbox file under ~/.pi/agent/family/<familyId>/mailboxes/<sessionId>.jsonl
 * Messages are appended as JSONL. The recipient polls their mailbox for new messages.
 *
 * This approach is simpler than pi-intercom's socket-based broker because:
 * - No broker process to manage
 * - Works across any process boundary (shell, ssh, etc.)
 * - Survives temporary disconnections
 * - Lower complexity for the parent-child use case
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { FamilyMessage } from "./types.js";

export interface MailboxOptions {
  familyDir: string;
  familyId: string;
}

/**
 * Get the mailbox directory for a family.
 */
function mailboxDir(opts: MailboxOptions): string {
  return join(opts.familyDir, opts.familyId, "mailboxes");
}

/**
 * Get the mailbox file path for a session.
 */
function mailboxPath(opts: MailboxOptions, sessionId: string): string {
  return join(mailboxDir(opts), `${sessionId}.jsonl`);
}

/**
 * Ensure the mailbox directory exists.
 */
function ensureMailboxDir(opts: MailboxOptions): void {
  mkdirSync(mailboxDir(opts), { recursive: true });
}

/**
 * Send a message to a session's mailbox.
 * Returns the message ID.
 */
export function sendMessage(
  opts: MailboxOptions,
  params: {
    from: string;
    fromName?: string;
    to: string;
    text: string;
    replyTo?: string;
    expectsReply?: boolean;
    attachments?: FamilyMessage["attachments"];
  },
): string {
  ensureMailboxDir(opts);

  const message: FamilyMessage = {
    id: randomUUID(),
    from: params.from,
    fromName: params.fromName,
    to: params.to,
    text: params.text,
    timestamp: new Date().toISOString(),
    replyTo: params.replyTo,
    expectsReply: params.expectsReply,
    attachments: params.attachments,
  };

  const filePath = mailboxPath(opts, params.to);
  appendFileSync(filePath, JSON.stringify(message) + "\n", "utf-8");
  return message.id;
}

/**
 * Read all messages from a session's mailbox.
 */
export function readMessages(opts: MailboxOptions, sessionId: string): FamilyMessage[] {
  const filePath = mailboxPath(opts, sessionId);
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, "utf-8");
  const messages: FamilyMessage[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as FamilyMessage);
    } catch {
      // Skip malformed lines
    }
  }
  return messages;
}

/**
 * Read only unread messages (those with timestamp after the given cursor).
 */
export function readUnreadMessages(
  opts: MailboxOptions,
  sessionId: string,
  afterTimestamp: string,
): FamilyMessage[] {
  const all = readMessages(opts, sessionId);
  return all.filter((m) => m.timestamp >= afterTimestamp);
}

/**
 * Clear the mailbox for a session.
 */
export function clearMailbox(opts: MailboxOptions, sessionId: string): void {
  const filePath = mailboxPath(opts, sessionId);
  try {
    unlinkSync(filePath);
  } catch {
    // Already cleared
  }
}

/**
 * Check if a mailbox exists and has any messages.
 */
export function hasMessages(opts: MailboxOptions, sessionId: string): boolean {
  return readMessages(opts, sessionId).length > 0;
}

/**
 * Get the latest message timestamp from a mailbox.
 */
export function getLatestTimestamp(opts: MailboxOptions, sessionId: string): string {
  const messages = readMessages(opts, sessionId);
  if (messages.length === 0) return "";
  return messages[messages.length - 1]!.timestamp;
}
