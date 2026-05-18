/**
 * Shared types for pi-relay extension.
 */

/** A message in the mailbox */
export interface FamilyMessage {
  id: string;
  /** Sender session ID */
  from: string;
  /** Sender display name */
  fromName?: string;
  /** Recipient session ID */
  to: string;
  /** Message body */
  text: string;
  /** ISO timestamp */
  timestamp: string;
  /** Message this is replying to (for threading) */
  replyTo?: string;
  /** Whether sender expects a reply */
  expectsReply?: boolean;
  /** Attachments */
  attachments?: FamilyAttachment[];
}

export interface FamilyAttachment {
  type: "file" | "snippet" | "context";
  name: string;
  content: string;
  language?: string;
}

/** Family member info */
export interface FamilyMember {
  sessionId: string;
  name?: string;
  role: "parent" | "child";
  pid: number;
  cwd: string;
  startedAt: string;
  lastActivity: string;
}

/** Configuration */
export interface FamilyConfig {
  /** Enable/disable the extension (default: true) */
  enabled: boolean;
  /** Maximum mailbox file size in bytes before rotation (default: 1MB) */
  maxMailboxSize: number;
  /** Polling interval for mailbox changes in ms (default: 1000) */
  pollIntervalMs: number;
  /** Timeout for ask operations in ms (default: 10 minutes) */
  askTimeoutMs: number;
}

export const RELAY_ENV_SESSION_ID = "PI_RELAY_SESSION_ID";
export const RELAY_ENV_RELAY_ID = "PI_RELAY_ID";
export const RELAY_ENV_ROLE = "PI_RELAY_ROLE";
export const RELAY_ENV_PARENT_SESSION = "PI_RELAY_PARENT_SESSION";
export const RELAY_ENV_PARENT_NAME = "PI_RELAY_PARENT_NAME";
export const RELAY_ENV_CHILD_INDEX = "PI_RELAY_CHILD_INDEX";
export const RELAY_ENV_DIR = "PI_RELAY_DIR";
