import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { sendMessage } from "../../src/mailbox.js";

const RUN_E2E = process.env.PI_RELAY_RUN_E2E === "1";
const PI_BIN = process.env.PI_E2E_BIN ?? "pi";
const PI_E2E_MODEL = "github-copilot/claude-haiku-4.5";
const REPO_ROOT = resolve(import.meta.dirname, "../..");
const EXTENSION_PATH = join(REPO_ROOT, "src/index.ts");

interface RpcResponse {
  id?: string;
  type: string;
  command?: string;
  success?: boolean;
  data?: unknown;
  error?: string;
}

class RpcPiProcess {
  readonly proc: ChildProcessWithoutNullStreams;
  readonly stderrChunks: string[] = [];
  private readonly pending = new Map<string, (response: RpcResponse) => void>();
  private buffer = "";

  constructor(name: string, env: NodeJS.ProcessEnv) {
    this.proc = spawn(
      PI_BIN,
      [
        "--mode", "rpc",
        "--no-session",
        "--no-context-files",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-extensions",
        "--extension", EXTENSION_PATH,
        "--model", PI_E2E_MODEL,
        "--offline",
      ],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    this.proc.stdout.setEncoding("utf-8");
    this.proc.stderr.setEncoding("utf-8");

    this.proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.proc.stderr.on("data", (chunk: string) => this.stderrChunks.push(`[${name}] ${chunk}`));
  }

  async request(command: Record<string, unknown>, timeoutMs = 10_000): Promise<RpcResponse> {
    const id = randomUUID();
    const payload = { id, ...command };

    const response = await new Promise<RpcResponse>((resolveResponse, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for RPC response ${id}: ${JSON.stringify(command)}`));
      }, timeoutMs);

      this.pending.set(id, (res) => {
        clearTimeout(timeout);
        resolveResponse(res);
      });

      this.proc.stdin.write(JSON.stringify(payload) + "\n");
    });

    assert.equal(response.success, true, `RPC command failed: ${JSON.stringify(response)}\nstderr:\n${this.stderrChunks.join("")}`);
    return response;
  }

  async getMessages(): Promise<unknown[]> {
    const response = await this.request({ type: "get_messages" });
    const data = response.data as { messages?: unknown[] } | undefined;
    return data?.messages ?? [];
  }

  async stop(): Promise<void> {
    if (this.proc.killed) return;
    this.proc.kill("SIGTERM");
    await new Promise<void>((resolveStop) => {
      const timer = setTimeout(() => {
        this.proc.kill("SIGKILL");
        resolveStop();
      }, 2_000);
      this.proc.once("exit", () => {
        clearTimeout(timer);
        resolveStop();
      });
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let message: RpcResponse;
      try {
        message = JSON.parse(line) as RpcResponse;
      } catch {
        continue;
      }

      if (message.type === "response" && message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)!(message);
        this.pending.delete(message.id);
      }
    }
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, description: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function containsText(messages: unknown[], text: string): boolean {
  return JSON.stringify(messages).includes(text);
}

test(
  "e2e: two real pi RPC sessions exchange family mailbox messages",
  { skip: RUN_E2E ? false : "Set PI_RELAY_RUN_E2E=1 or run npm run test:e2e", timeout: 90_000 },
  async () => {
    const tmp = mkdtempSync(join(tmpdir(), "pi-relay-e2e-"));
    const familyDir = join(tmp, "family");
    const familyId = `family-e2e-${randomUUID()}`;
    const parentSessionId = `parent-e2e-${randomUUID()}`;
    const childSessionId = `child-e2e-${randomUUID()}`;

    const commonEnv = {
      PI_RELAY_DIR: familyDir,
      PI_RELAY_ID: familyId,
    };

    const parent = new RpcPiProcess("parent", {
      ...commonEnv,
      PI_RELAY_SESSION_ID: parentSessionId,
      PI_RELAY_ROLE: "parent",
    });

    const child = new RpcPiProcess("child", {
      ...commonEnv,
      PI_RELAY_SESSION_ID: childSessionId,
      PI_RELAY_ROLE: "child",
      PI_RELAY_PARENT_SESSION: parentSessionId,
      PI_RELAY_PARENT_NAME: "e2e-parent",
      PI_RELAY_CHILD_INDEX: "1",
    });

    try {
      await waitFor(
        () => parent.request({ type: "get_state" }).then(() => true).catch(() => false),
        "parent RPC startup",
      );
      await waitFor(
        () => child.request({ type: "get_state" }).then(() => true).catch(() => false),
        "child RPC startup",
      );

      sendMessage({ familyDir, familyId }, {
        from: parentSessionId,
        fromName: "e2e-parent",
        to: childSessionId,
        text: "ping-from-parent-e2e",
      });

      await waitFor(
        async () => containsText(await child.getMessages(), "ping-from-parent-e2e"),
        "child to receive parent message",
      );

      sendMessage({ familyDir, familyId }, {
        from: childSessionId,
        fromName: "e2e-child",
        to: parentSessionId,
        text: "pong-from-child-e2e",
      });

      await waitFor(
        async () => containsText(await parent.getMessages(), "pong-from-child-e2e"),
        "parent to receive child message",
      );
    } finally {
      await Promise.allSettled([parent.stop(), child.stop()]);
      rmSync(tmp, { recursive: true, force: true });
    }
  },
);
