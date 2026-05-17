/**
 * pi-family — Parent-child shell session communication extension.
 *
 * Enables pi sessions launched from shell (bash) to communicate
 * as parent and child without manual session discovery.
 *
 * Architecture:
 * - Parent intercepts bash tool_call to inject PI_FAMILY_* env vars
 * - Child detects parent via env vars on startup
 * - File-based mailbox IPC (no broker process needed)
 * - Auto-registration in shared family directory
 */

import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

import {
  detectParentFromEnv,
  detectOwnSessionId,
  buildChildEnv,
  buildSelfEnv,
  registerMember,
  unregisterMember,
  listFamilyMembers,
  cleanupStaleMembers,
  getFamilyDir,
} from "./family.js";
import {
  sendMessage,
  readMessages,
  readUnreadMessages,
  clearMailbox,
  getLatestTimestamp,
  type MailboxOptions,
} from "./mailbox.js";
import type { FamilyMessage, FamilyMember, FamilyConfig } from "./types.js";
import { isPiLaunchCommand, prependEnv } from "./shell.js";

// ── Config ──────────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), ".pi/agent/family/config.json");

const DEFAULT_CONFIG: FamilyConfig = {
  enabled: true,
  maxMailboxSize: 1_000_000, // 1MB
  pollIntervalMs: 1000,
  askTimeoutMs: 10 * 60 * 1000, // 10 minutes
};

function loadConfig(): FamilyConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

type FamilyToolDetails = { ok: boolean; error?: string };

function textResult(text: string, ok = true): AgentToolResult<FamilyToolDetails> {
  return {
    content: [{ type: "text", text }],
    details: ok ? { ok: true } : { ok: false, error: text },
  };
}

function getResultText(result: AgentToolResult<unknown>): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

function isFailedResult(result: AgentToolResult<unknown>, context: { isError?: boolean }): boolean {
  const details = result.details as Partial<FamilyToolDetails> | undefined;
  return context.isError === true || details?.ok === false;
}

function formatAttachment(att: FamilyMessage["attachments"]): string {
  if (!att || att.length === 0) return "";
  return att
    .map(
      (a) =>
        `\n---\n📎 ${a.name}${a.language ? ` (${a.language})` : ""}\n${a.content}`,
    )
    .join("");
}

// ── Extension ───────────────────────────────────────────────────────────

export default function piFamilyExtension(pi: ExtensionAPI) {
  const config = loadConfig();

  // Extension state per session
  let sessionId: string | null = null;
  let familyId: string | null = null;
  let role: "parent" | "child" = "parent";
  let parentInfo: {
    sessionId: string;
    name?: string;
    childIndex: number;
  } | null = null;
  let childCounter = 0;
  let lastMailboxCursor = "";
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let askWaiter: {
    fromSessionId: string;
    replyTo: string;
    resolve: (message: FamilyMessage) => void;
    reject: (error: Error) => void;
  } | null = null;

  function getMailboxOpts(): MailboxOptions {
    return {
      familyDir: getFamilyDir(),
      familyId: familyId!,
    };
  }

  function isConnected(): boolean {
    return sessionId !== null && familyId !== null;
  }

  // ── Polling for incoming messages ───────────────────────────────────

  function startPolling(ctx: ExtensionContext): void {
    stopPolling();
    if (!isConnected()) return;

    pollTimer = setInterval(() => {
      if (!isConnected()) {
        stopPolling();
        return;
      }
      checkForNewMessages(ctx);
    }, config.pollIntervalMs);
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function checkForNewMessages(ctx: ExtensionContext): void {
    if (!isConnected()) return;

    const messages = lastMailboxCursor
      ? readUnreadMessages(getMailboxOpts(), sessionId!, lastMailboxCursor)
      : readMessages(getMailboxOpts(), sessionId!);

    if (messages.length === 0) return;

    // Update cursor
    lastMailboxCursor = messages[messages.length - 1]!.timestamp;

    for (const msg of messages) {
      // Check if this is a reply to a pending ask
      if (askWaiter && msg.replyTo === askWaiter.replyTo) {
        askWaiter.resolve(msg);
        continue;
      }

      // Deliver as an incoming message
      deliverIncomingMessage(ctx, msg);
    }
  }

  function deliverIncomingMessage(ctx: ExtensionContext, msg: FamilyMessage): void {
    const senderDisplay = msg.fromName || shortId(msg.from);
    const attachmentText = formatAttachment(msg.attachments);
    const replyHint = msg.expectsReply
      ? `\n\nReply: talk_to_child({ message: "..." }) or talk_to_parent({ message: "..." })`
      : "";

    const body = `**📨 From ${senderDisplay}** (${msg.from})${replyHint}\n\n${msg.text}${attachmentText}`;

    pi.sendMessage(
      {
        customType: "family_message",
        content: body,
        display: true,
        details: { message: msg },
      },
      { triggerTurn: true },
    );
  }

  // ── Session lifecycle ───────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    if (!config.enabled) return;

    // Check for existing session ID from env
    const existingId = detectOwnSessionId();
    const parentDetection = detectParentFromEnv();

    sessionId = existingId ?? ctx.sessionManager.getSessionId();

    if (parentDetection) {
      // This is a child session
      role = "child";
      familyId = parentDetection.familyId;
      parentInfo = {
        sessionId: parentDetection.parentSessionId,
        name: parentDetection.parentName,
        childIndex: parentDetection.childIndex,
      };
    } else {
      // This is a parent session
      role = "parent";
      familyId = randomUUID();
    }

    // Register self
    const member: FamilyMember = {
      sessionId,
      name: pi.getSessionName() || undefined,
      role,
      pid: process.pid,
      cwd: ctx.cwd ?? process.cwd(),
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };

    cleanupStaleMembers(familyId);
    registerMember(familyId, member);

    // Start mailbox polling
    lastMailboxCursor = getLatestTimestamp(getMailboxOpts(), sessionId) || "";
    startPolling(ctx);

    const roleLabel = role === "parent" ? "Parent" : `Child #${parentInfo?.childIndex ?? 0}`;
    if (ctx.hasUI) {
      ctx.ui.notify(`pi-family: ${roleLabel} session started (family: ${shortId(familyId)})`, "info");
    }
  });

  pi.on("session_shutdown", () => {
    stopPolling();

    // Reject pending ask
    if (askWaiter) {
      askWaiter.reject(new Error("Session shutting down"));
      askWaiter = null;
    }

    // Unregister self
    if (sessionId && familyId) {
      unregisterMember(familyId, sessionId);
    }

    sessionId = null;
    familyId = null;
    parentInfo = null;
    childCounter = 0;
    lastMailboxCursor = "";
  });

  // ── Intercept bash tool calls to inject family env vars ─────────────

  pi.on("tool_call", async (event) => {
    if (!isConnected() || !isToolCallEventType("bash", event)) return;

    const command: string = event.input.command ?? "";

    // Detect if the command is launching a new pi session
    if (!isPiLaunchCommand(command)) return;

    // Generate child session ID and inject env vars
    childCounter++;
    const childSessionId = randomUUID();
    const envVars = buildChildEnv(
      sessionId!,
      pi.getSessionName() || undefined,
      familyId!,
      childCounter,
      childSessionId,
    );

    event.input.command = prependEnv(command, envVars);
  });

  // ── Custom message renderer ─────────────────────────────────────────

  pi.registerMessageRenderer("family_message", (message, _options, theme) => {
    const details = message.details as { message: FamilyMessage } | undefined;
    if (!details) return undefined;

    const msg = details.message;
    const sender = msg.fromName || shortId(msg.from);
    const roleColor = msg.from === parentInfo?.sessionId ? "accent" : "success";

    let text = theme.fg(roleColor, `📨 ${sender}`);
    text += theme.fg("dim", ` (${shortId(msg.id)})`);
    if (msg.expectsReply) {
      text += " " + theme.fg("warning", "⏳ expects reply");
    }
    text += "\n" + theme.fg("text", msg.text);

    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        text += "\n" + theme.fg("dim", `📎 ${att.name}`);
      }
    }

    return new Text(text, 0, 0);
  });

  // ── Tool: talk_to_parent ────────────────────────────────────────────

  pi.registerTool({
    name: "talk_to_parent",
    label: "Talk to Parent",
    description: "Send a message to the parent pi session. Only available in child sessions.",
    promptSnippet: "Send a message to the parent pi session (child-only)",
    promptGuidelines: [
      "Use talk_to_parent in child sessions to send findings, ask questions, or report progress to the parent session.",
    ],
    parameters: Type.Object({
      message: Type.String({ description: "Message to send to the parent session" }),
      expectsReply: Type.Optional(Type.Boolean({
        description: "Whether to wait for a reply from the parent (default: false)",
      })),
      attachments: Type.Optional(Type.Array(Type.Object({
        type: Type.Union([Type.Literal("file"), Type.Literal("snippet"), Type.Literal("context")]),
        name: Type.String(),
        content: Type.String(),
        language: Type.Optional(Type.String()),
      }))),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!isConnected() || !parentInfo) {
        return textResult("Not a child session or parent not detected.", false);
      }

      const messageId = sendMessage(getMailboxOpts(), {
        from: sessionId!,
        fromName: pi.getSessionName() || undefined,
        to: parentInfo.sessionId,
        text: params.message,
        expectsReply: params.expectsReply,
        attachments: params.attachments,
      });

      // If expecting a reply, wait for it
      if (params.expectsReply) {
        if (askWaiter) {
          return textResult("Already waiting for a reply.", false);
        }

        const reply = await new Promise<FamilyMessage>((resolve, reject) => {
          const timeout = setTimeout(() => {
            askWaiter = null;
            reject(new Error(`No reply from parent within ${config.askTimeoutMs / 1000}s`));
          }, config.askTimeoutMs);

          const onAbort = () => {
            askWaiter = null;
            clearTimeout(timeout);
            reject(new Error("Cancelled"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });

          askWaiter = {
            fromSessionId: parentInfo!.sessionId,
            replyTo: messageId,
            resolve: (msg) => {
              clearTimeout(timeout);
              signal?.removeEventListener("abort", onAbort);
              askWaiter = null;
              resolve(msg);
            },
            reject: (err) => {
              clearTimeout(timeout);
              signal?.removeEventListener("abort", onAbort);
              askWaiter = null;
              reject(err);
            },
          };
        });

        const attachmentText = formatAttachment(reply.attachments);
        return textResult(`**Reply from parent:**\n${reply.text}${attachmentText}`);
      }

      return textResult(`Message sent to parent (${shortId(parentInfo.sessionId)})`);
    },
    renderCall(args, theme) {
      const preview = args.message?.toString().slice(0, 80) || "";
      let text = theme.fg("toolTitle", theme.bold("talk_to_parent "));
      if (preview) text += "\n  " + theme.fg("dim", preview);
      return new Text(text, 0, 0);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Waiting for parent reply..."), 0, 0);
      const failed = isFailedResult(result, context);
      const content = getResultText(result);
      return new Text(
        (failed ? theme.fg("error", "✗ ") : theme.fg("success", "✓ ")) +
        theme.fg(failed ? "error" : "text", content),
        0, 0,
      );
    },
  });

  // ── Tool: talk_to_child ─────────────────────────────────────────────

  pi.registerTool({
    name: "talk_to_child",
    label: "Talk to Child",
    description: "Send a message to a child pi session. Only available in parent sessions.",
    promptSnippet: "Send a message to a child pi session (parent-only)",
    promptGuidelines: [
      "Use talk_to_child in parent sessions to delegate tasks, answer questions, or send instructions to child sessions.",
    ],
    parameters: Type.Object({
      child: Type.Optional(Type.String({
        description: "Child session ID or name. Omit to send to the most recently launched child.",
      })),
      message: Type.String({ description: "Message to send to the child session" }),
      expectsReply: Type.Optional(Type.Boolean({
        description: "Whether to wait for a reply from the child (default: false)",
      })),
      attachments: Type.Optional(Type.Array(Type.Object({
        type: Type.Union([Type.Literal("file"), Type.Literal("snippet"), Type.Literal("context")]),
        name: Type.String(),
        content: Type.String(),
        language: Type.Optional(Type.String()),
      }))),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!isConnected()) {
        return textResult("Family not initialized.", false);
      }

      // Find the target child
      const members = listFamilyMembers(familyId!);
      const children = members.filter((m) => m.role === "child");

      if (children.length === 0) {
        return textResult("No child sessions registered in this family.", false);
      }

      let target: FamilyMember | undefined;
      if (params.child) {
        const childQuery = params.child;
        const lowerChild = childQuery.toLowerCase();
        target = children.find(
          (c) => c.sessionId === childQuery ||
            c.sessionId.startsWith(childQuery) ||
            c.name?.toLowerCase() === lowerChild,
        );
        if (!target) {
          return textResult(`Child "${params.child}" not found. Available: ${children.map((c) => c.name || shortId(c.sessionId)).join(", ")}`, false);
        }
      } else {
        // Default to most recently started child
        target = children[children.length - 1]!;
      }

      const messageId = sendMessage(getMailboxOpts(), {
        from: sessionId!,
        fromName: pi.getSessionName() || undefined,
        to: target.sessionId,
        text: params.message,
        expectsReply: params.expectsReply,
        attachments: params.attachments,
      });

      // If expecting a reply, wait for it
      if (params.expectsReply) {
        if (askWaiter) {
          return textResult("Already waiting for a reply.", false);
        }

        const reply = await new Promise<FamilyMessage>((resolve, reject) => {
          const timeout = setTimeout(() => {
            askWaiter = null;
            reject(new Error(`No reply from child within ${config.askTimeoutMs / 1000}s`));
          }, config.askTimeoutMs);

          const onAbort = () => {
            askWaiter = null;
            clearTimeout(timeout);
            reject(new Error("Cancelled"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });

          askWaiter = {
            fromSessionId: target!.sessionId,
            replyTo: messageId,
            resolve: (msg) => {
              clearTimeout(timeout);
              signal?.removeEventListener("abort", onAbort);
              askWaiter = null;
              resolve(msg);
            },
            reject: (err) => {
              clearTimeout(timeout);
              signal?.removeEventListener("abort", onAbort);
              askWaiter = null;
              reject(err);
            },
          };
        });

        const attachmentText = formatAttachment(reply.attachments);
        return textResult(`**Reply from child ${target.name || shortId(target.sessionId)}:**\n${reply.text}${attachmentText}`);
      }

      return textResult(`Message sent to child ${target.name || shortId(target.sessionId)}`);
    },
    renderCall(args, theme) {
      const child = args.child?.toString() || "latest";
      const preview = args.message?.toString().slice(0, 80) || "";
      let text = theme.fg("toolTitle", theme.bold("talk_to_child "));
      text += theme.fg("accent", child);
      if (preview) text += "\n  " + theme.fg("dim", preview);
      return new Text(text, 0, 0);
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Waiting for child reply..."), 0, 0);
      const failed = isFailedResult(result, context);
      const content = getResultText(result);
      return new Text(
        (failed ? theme.fg("error", "✗ ") : theme.fg("success", "✓ ")) +
        theme.fg(failed ? "error" : "text", content),
        0, 0,
      );
    },
  });

  // ── Tool: list_family ───────────────────────────────────────────────

  pi.registerTool({
    name: "list_family",
    label: "List Family",
    description: "List all sessions in the current family (parent + children).",
    promptSnippet: "List parent and child sessions in the current family",
    parameters: Type.Object({}),
    async execute() {
      if (!isConnected()) {
        return textResult("Family not initialized.", false);
      }

      cleanupStaleMembers(familyId!);
      const members = listFamilyMembers(familyId!);
      const selfId = sessionId!;

      if (members.length === 0) {
        return textResult("No family members registered.");
      }

      const lines = members.map((m) => {
        const isSelf = m.sessionId === selfId;
        const tag = isSelf ? " (self)" : "";
        const roleLabel = m.role === "parent" ? "👤 Parent" : "👶 Child";
        const name = m.name || shortId(m.sessionId);
        const status = isSelf ? "active" : isProcessAlive(m.pid) ? "alive" : "offline";
        return `${roleLabel}${tag}: ${name} (pid: ${m.pid}, cwd: ${m.cwd}, status: ${status})`;
      });

      return textResult(`**Family ${shortId(familyId!)}:**\n${lines.join("\n")}`);
    },
  });

  // ── Tool: reply_to_family ───────────────────────────────────────────

  pi.registerTool({
    name: "reply_to_family",
    label: "Reply to Family",
    description: "Reply to the most recent incoming family message.",
    promptSnippet: "Reply to the latest family message (parent or child)",
    parameters: Type.Object({
      message: Type.String({ description: "Reply message" }),
      attachments: Type.Optional(Type.Array(Type.Object({
        type: Type.Union([Type.Literal("file"), Type.Literal("snippet"), Type.Literal("context")]),
        name: Type.String(),
        content: Type.String(),
        language: Type.Optional(Type.String()),
      }))),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isConnected()) {
        return textResult("Family not initialized.", false);
      }

      // Find the latest incoming message
      const messages = readMessages(getMailboxOpts(), sessionId!);
      const lastIncoming = messages.filter((m) => m.to === sessionId).pop();

      if (!lastIncoming) {
        return textResult("No incoming message to reply to.", false);
      }

      sendMessage(getMailboxOpts(), {
        from: sessionId!,
        fromName: pi.getSessionName() || undefined,
        to: lastIncoming.from,
        text: params.message,
        replyTo: lastIncoming.id,
        attachments: params.attachments,
      });

      const recipientName = lastIncoming.fromName || shortId(lastIncoming.from);
      return textResult(`Reply sent to ${recipientName}`);
    },
    renderCall(args, theme) {
      const preview = args.message?.toString().slice(0, 80) || "";
      let text = theme.fg("toolTitle", theme.bold("reply_to_family "));
      if (preview) text += "\n  " + theme.fg("dim", preview);
      return new Text(text, 0, 0);
    },
    renderResult(result, _options, theme, context) {
      const failed = isFailedResult(result, context);
      const content = getResultText(result);
      return new Text(
        (failed ? theme.fg("error", "✗ ") : theme.fg("success", "✓ ")) +
        theme.fg(failed ? "error" : "text", content),
        0, 0,
      );
    },
  });

  // ── Command: /family ────────────────────────────────────────────────

  pi.registerCommand("family", {
    description: "Show family session information",
    handler: async (_args, ctx) => {
      if (!isConnected()) {
        ctx.ui.notify("Family not initialized", "warning");
        return;
      }

      cleanupStaleMembers(familyId!);
      const members = listFamilyMembers(familyId!);

      const lines: string[] = [
        `Family: ${shortId(familyId!)}`,
        `Role: ${role}`,
        `Session: ${shortId(sessionId!)}`,
        `Members: ${members.length}`,
      ];

      if (parentInfo) {
        lines.push(`Parent: ${parentInfo.name || shortId(parentInfo.sessionId)}`);
      }

      const mailboxMessages = readMessages(getMailboxOpts(), sessionId!);
      lines.push(`Mailbox: ${mailboxMessages.length} messages`);

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── Command: /family-inbox ──────────────────────────────────────────

  pi.registerCommand("family-inbox", {
    description: "Read all messages in the family mailbox",
    handler: async (_args, ctx) => {
      if (!isConnected()) {
        ctx.ui.notify("Family not initialized", "warning");
        return;
      }

      const messages = readMessages(getMailboxOpts(), sessionId!);
      if (messages.length === 0) {
        ctx.ui.notify("Mailbox is empty", "info");
        return;
      }

      const lines = messages.map((m) => {
        const sender = m.fromName || shortId(m.from);
        const replyTag = m.expectsReply ? " ⏳" : "";
        const threadTag = m.replyTo ? ` (reply to ${shortId(m.replyTo)})` : "";
        return `[${new Date(m.timestamp).toLocaleTimeString()}] ${sender}${threadTag}${replyTag}: ${m.text.slice(0, 100)}`;
      });

      ctx.ui.notify(`**Inbox (${messages.length}):**\n${lines.join("\n")}`, "info");
    },
  });
}

// ── Utility ────────────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
