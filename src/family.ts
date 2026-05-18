/**
 * Family relationship detection via environment variables.
 *
 * When a parent pi session spawns a child pi via bash, the extension:
 * 1. Intercepts the bash tool_call to inject PI_RELAY_* env vars
 * 2. The child pi reads those env vars on startup to discover its parent
 * 3. Both sessions register in a shared family directory
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type { FamilyMember, FamilyConfig } from "./types.js";
import {
  RELAY_ENV_SESSION_ID,
  RELAY_ENV_RELAY_ID,
  RELAY_ENV_ROLE,
  RELAY_ENV_PARENT_SESSION,
  RELAY_ENV_PARENT_NAME,
  RELAY_ENV_CHILD_INDEX,
  RELAY_ENV_DIR,
} from "./types.js";

const FAMILY_DIR = join(homedir(), ".pi/agent/family");

export function getFamilyDir(): string {
  return process.env[RELAY_ENV_DIR]?.trim() || FAMILY_DIR;
}

/**
 * Detect if this session was launched as a child of another pi session.
 */
export function detectParentFromEnv(): {
  familyId: string;
  parentSessionId: string;
  parentName?: string;
  childIndex: number;
} | null {
  const familyId = process.env[RELAY_ENV_RELAY_ID]?.trim();
  const parentSession = process.env[RELAY_ENV_PARENT_SESSION]?.trim();
  const parentName = process.env[RELAY_ENV_PARENT_NAME]?.trim() || undefined;
  const childIndexStr = process.env[RELAY_ENV_CHILD_INDEX]?.trim();

  if (!familyId || !parentSession) return null;

  const childIndex = childIndexStr ? parseInt(childIndexStr, 10) : 0;

  return {
    familyId,
    parentSessionId: parentSession,
    parentName,
    childIndex: Number.isFinite(childIndex) ? childIndex : 0,
  };
}

/**
 * Detect if this session itself has a PI_RELAY_SESSION_ID set
 * (meaning the extension already assigned it one).
 */
export function detectOwnSessionId(): string | null {
  return process.env[RELAY_ENV_SESSION_ID]?.trim() ?? null;
}

/**
 * Detect a pre-seeded self identity from environment variables.
 * Useful for tests and externally orchestrated parent sessions.
 */
export function detectSelfFromEnv(): {
  sessionId: string;
  familyId: string;
  role: "parent" | "child";
} | null {
  const sessionId = process.env[RELAY_ENV_SESSION_ID]?.trim();
  const familyId = process.env[RELAY_ENV_RELAY_ID]?.trim();
  const roleEnv = process.env[RELAY_ENV_ROLE]?.trim();

  if (!sessionId || !familyId) return null;

  return {
    sessionId,
    familyId,
    role: roleEnv === "child" ? "child" : "parent",
  };
}

/**
 * Generate environment variables to inject when spawning a child pi.
 */
export function buildChildEnv(
  parentSessionId: string,
  parentName: string | undefined,
  familyId: string,
  childIndex: number,
  childSessionId: string,
): Record<string, string> {
  return {
    [RELAY_ENV_SESSION_ID]: childSessionId,
    [RELAY_ENV_RELAY_ID]: familyId,
    [RELAY_ENV_ROLE]: "child",
    [RELAY_ENV_PARENT_SESSION]: parentSessionId,
    ...(parentName ? { [RELAY_ENV_PARENT_NAME]: parentName } : {}),
    [RELAY_ENV_CHILD_INDEX]: String(childIndex),
  };
}

/**
 * Build prefix env vars that the extension sets for its own session.
 */
export function buildSelfEnv(
  sessionId: string,
  familyId: string,
  role: "parent" | "child",
): Record<string, string> {
  return {
    [RELAY_ENV_SESSION_ID]: sessionId,
    [RELAY_ENV_RELAY_ID]: familyId,
    [RELAY_ENV_ROLE]: role,
  };
}

/**
 * Register a family member by writing a JSON file to the family directory.
 */
export function registerMember(familyId: string, member: FamilyMember, familyDir = FAMILY_DIR): void {
  const dir = join(familyDir, familyId);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${member.sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(member, null, 2), "utf-8");
}

/**
 * Unregister a family member.
 */
export function unregisterMember(familyId: string, sessionId: string, familyDir = FAMILY_DIR): void {
  const filePath = join(familyDir, familyId, `${sessionId}.json`);
  try {
    unlinkSync(filePath);
  } catch {
    // Already removed or never registered
  }
}

/**
 * List all members of a family.
 */
export function listFamilyMembers(familyId: string, familyDir = FAMILY_DIR): FamilyMember[] {
  const dir = join(familyDir, familyId);
  if (!existsSync(dir)) return [];

  const members: FamilyMember[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      members.push(JSON.parse(raw) as FamilyMember);
    } catch {
      // Skip malformed entries
    }
  }

  // Sort: parent first, then children by index
  members.sort((a, b) => {
    if (a.role === "parent" && b.role !== "parent") return -1;
    if (a.role !== "parent" && b.role === "parent") return 1;
    return a.startedAt.localeCompare(b.startedAt);
  });

  return members;
}

/**
 * Clean up stale member registrations (where the PID is no longer alive).
 */
export function cleanupStaleMembers(familyId: string, familyDir = FAMILY_DIR): void {
  const members = listFamilyMembers(familyId, familyDir);
  for (const member of members) {
    try {
      process.kill(member.pid, 0);
    } catch {
      // Process is dead, unregister
      unregisterMember(familyId, member.sessionId, familyDir);
    }
  }
}
