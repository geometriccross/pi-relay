/**
 * Pure logic extracted from tool execute handlers for testability.
 *
 * These functions have no side effects and depend only on their arguments.
 */

import type { FamilyMember, FamilyMessage } from "./types.js";

/**
 * Resolve a target child from the family member list.
 *
 * Resolution order:
 * 1. Exact session ID match
 * 2. Session ID prefix match
 * 3. Case-insensitive name match
 * 4. If no query given, the most recently started child
 *
 * Returns `undefined` when no match is found.
 */
export function resolveChild(
  children: FamilyMember[],
  query: string | undefined,
): FamilyMember | undefined {
  if (children.length === 0) return undefined;

  if (!query) {
    // Default: most recently started child
    return children[children.length - 1];
  }

  const lowerQuery = query.toLowerCase();

  return children.find(
    (c) => c.sessionId === query,
  ) ?? children.find(
    (c) => c.sessionId.startsWith(query),
  ) ?? children.find(
    (c) => c.name?.toLowerCase() === lowerQuery,
  );
}

/**
 * Find the last incoming message addressed to `selfSessionId`.
 *
 * Returns `undefined` when no such message exists.
 */
export function findLastIncoming(
  messages: FamilyMessage[],
  selfSessionId: string,
): FamilyMessage | undefined {
  const incoming = messages.filter((m) => m.to === selfSessionId);
  return incoming.pop();
}
