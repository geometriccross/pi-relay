/** Pure shell command helpers for PI_RELAY_* env injection. */

/** Detect if a shell command launches a pi session. */
export function isPiLaunchCommand(command: string): boolean {
  const trimmed = command.trim();
  return /^(pi\b|npx\s+pi\b|pnpm\s+pi\b|bunx\s+pi\b)/.test(trimmed) ||
    /\bpi\s*$/.test(trimmed) ||
    /\bpi\s+--/.test(trimmed) ||
    /\bpi\s+-[a-z]/.test(trimmed);
}

/** Escape a string for use as a shell env var value. */
export function shellEscape(value: string): string {
  if (/^[a-zA-Z0-9_./:@-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Prepend environment variable assignments to a shell command. */
export function prependEnv(command: string, env: Record<string, string>): string {
  const envExports = Object.entries(env)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(" ");

  return envExports ? `${envExports} ${command}` : command;
}
