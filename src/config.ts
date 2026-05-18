import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

import type { FamilyConfig } from "./types.js";

export const SETTINGS_PATH = join(homedir(), ".pi/agent/settings.json");

export const DEFAULT_CONFIG: FamilyConfig = {
  enabled: true,
  maxMailboxSize: 1_000_000, // 1MB
  pollIntervalMs: 1000,
  askTimeoutMs: 10 * 60 * 1000, // 10 minutes
};

export function loadConfig(settingsPath = SETTINGS_PATH): FamilyConfig {
  if (!existsSync(settingsPath)) return { ...DEFAULT_CONFIG };

  try {
    const raw = readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const relayConfig = settings["pi-relay"];

    if (!relayConfig || typeof relayConfig !== "object" || Array.isArray(relayConfig)) {
      return { ...DEFAULT_CONFIG };
    }

    return { ...DEFAULT_CONFIG, ...(relayConfig as Partial<FamilyConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
