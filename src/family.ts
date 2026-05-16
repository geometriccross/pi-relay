/**
 * Family relationship detection via environment variables.
 *
 * When a parent pi session spawns a child pi via bash, the extension:
 * 1. Intercepts the bash tool_call to inject PI_FAMILY_* env vars
 * 2. The child pi reads those env vars on startup to discover its parent
 * 3. Both sessions register in a shared family directory
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type { FamilyMember, FamilyConfig } from "./types.js";
import {
  FAMILY_ENV_SESSION_ID,
  FAMILY_ENV_FAMILY_ID,
  FAMILY_ENV_ROLE,
  FAMILY_ENV_PARENT_SESSION,
  FAMILY_ENV_PARENT_NAME,
  FAMILY_ENV_CHILD_INDEX,
} from "./types.js";

const FAMILY_DIR = join(homedir(), ".pi/agent/family");

export function getFamilyDir(): string {
  return FAMILY_DIR;
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
  const familyId = process.env[FAMILY_ENV_FAMILY_ID]?.trim();
  const parentSession = process.env[FAMILY_ENV_PARENT_SESSION]?.trim();
  const parentName = process.env[FAMILY_ENV_PARENT_NAME]?.trim() || undefined;
  const childIndexStr = process.env[FAMILY_ENV_CHILD_INDEX]?.trim();

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
 * Detect if this session itself has a PI_FAMILY_SESSION_ID set
 * (meaning the extension already assigned it one).
 */
export function detectOwnSessionId(): string | null {
  return process.env[FAMILY_ENV_SESSION_ID]?.trim() ?? null;
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
    [FAMILY_ENV_SESSION_ID]: childSessionId,
    [FAMILY_ENV_FAMILY_ID]: familyId,
    [FAMILY_ENV_ROLE]: "child",
    [FAMILY_ENV_PARENT_SESSION]: parentSessionId,
    ...(parentName ? { [FAMILY_ENV_PARENT_NAME]: parentName } : {}),
    [FAMILY_ENV_CHILD_INDEX]: String(childIndex),
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
    [FAMILY_ENV_SESSION_ID]: sessionId,
    [FAMILY_ENV_FAMILY_ID]: familyId,
    [FAMILY_ENV_ROLE]: role,
  };
}

/**
 * Register a family member by writing a JSON file to the family directory.
 */
export function registerMember(familyId: string, member: FamilyMember): void {
  const dir = join(FAMILY_DIR, familyId);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${member.sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(member, null, 2), "utf-8");
}

/**
 * Unregister a family member.
 */
export function unregisterMember(familyId: string, sessionId: string): void {
  const filePath = join(FAMILY_DIR, familyId, `${sessionId}.json`);
  try {
    unlinkSync(filePath);
  } catch {
    // Already removed or never registered
  }
}

/**
 * List all members of a family.
 */
export function listFamilyMembers(familyId: string): FamilyMember[] {
  const dir = join(FAMILY_DIR, familyId);
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
export function cleanupStaleMembers(familyId: string): void {
  const members = listFamilyMembers(familyId);
  for (const member of members) {
    try {
      process.kill(member.pid, 0);
    } catch {
      // Process is dead, unregister
      unregisterMember(familyId, member.sessionId);
    }
  }
}
