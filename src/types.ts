/**
 * Shared types for pi-family extension.
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

export const FAMILY_ENV_SESSION_ID = "PI_FAMILY_SESSION_ID";
export const FAMILY_ENV_FAMILY_ID = "PI_FAMILY_ID";
export const FAMILY_ENV_ROLE = "PI_FAMILY_ROLE";
export const FAMILY_ENV_PARENT_SESSION = "PI_FAMILY_PARENT_SESSION";
export const FAMILY_ENV_PARENT_NAME = "PI_FAMILY_PARENT_NAME";
export const FAMILY_ENV_CHILD_INDEX = "PI_FAMILY_CHILD_INDEX";
export const FAMILY_ENV_DIR = "PI_FAMILY_DIR";
