# pi-relay

Pi extension for parent-child shell session communication.

When a parent pi session launches a child pi via bash, this extension automatically:
1. Injects `PI_RELAY_*` environment variables into the child process
2. Detects the parent-child relationship in the child session
3. Provides dedicated tools for parent ↔ child messaging

## Architecture

Unlike `pi-intercom` (which uses a socket-based broker), pi-relay uses **file-based mailbox IPC**:
- No broker process to manage
- Works across any process boundary (shell, ssh, etc.)
- Survives temporary disconnections
- Lower complexity for the parent-child use case

```
~/.pi/agent/family/
├── config.json                         # Extension config
├── <familyId>/
│   ├── <sessionId>.json                # Member registration
│   └── mailboxes/
│       ├── <parentSessionId>.jsonl     # Parent's mailbox
│       └── <childSessionId>.jsonl      # Child's mailbox
```

## Tools

### `talk_to_parent` (child-only)
Send a message to the parent pi session.
```typescript
// Fire-and-forget
talk_to_parent({ message: "Task complete!" })

// Wait for a reply
talk_to_parent({ message: "Should I proceed?", expectsReply: true })
```

### `talk_to_child` (parent-only)
Send a message to a child pi session.
```typescript
// Send to latest child
talk_to_child({ message: "Start task A" })

// Send to specific child
talk_to_child({ child: "child-name", message: "Focus on auth module" })

// Wait for a reply
talk_to_child({ message: "Status report?", expectsReply: true })
```

### `reply_to_family`
Reply to the most recent incoming family message.
```typescript
reply_to_family({ message: "Understood, proceeding with option B." })
```

### `list_family`
List all sessions in the current family.
```typescript
list_family({})
```

## Commands

- `/family` — Show family session information
- `/family-inbox` — Read all messages in the family mailbox

## Configuration

Create `~/.pi/agent/family/config.json`:

```json
{
  "enabled": true,
  "maxMailboxSize": 1000000,
  "pollIntervalMs": 1000,
  "askTimeoutMs": 600000
}
```

## Installation

### As a pi package
```bash
pi install git:github.com/geometriccross/pi-relay
```

### Manual
Copy or symlink into `~/.pi/agent/extensions/`:
```bash
ln -s /path/to/pi-relay ~/.pi/agent/extensions/pi-relay
cd ~/.pi/agent/extensions/pi-relay
npm install
```

## How It Works

### Parent Session
1. On `session_start`, registers as "parent" in a new family
2. Intercepts `bash` tool calls via `tool_call` event
3. When a `pi` command is detected, injects `PI_RELAY_*` env vars
4. Starts polling mailbox for incoming messages from children

### Child Session
1. On `session_start`, reads `PI_RELAY_*` env vars
2. Detects parent session and registers as "child"
3. Starts polling mailbox for incoming messages from parent
4. `talk_to_parent` tool becomes available

### Message Flow
```
Parent pi ──[bash: PI_RELAY_* pi]──> Child pi
   │                                       │
   ├── talk_to_child ──> mailbox ──> poll ──┤
   │<── poll <── mailbox <── talk_to_parent ─┤
```

## Environment Variables

| Variable | Set By | Purpose |
|----------|--------|---------|
| `PI_RELAY_SESSION_ID` | Extension | This session's relay ID |
| `PI_RELAY_ID` | Extension | Family group identifier |
| `PI_RELAY_ROLE` | Extension | "parent" or "child" |
| `PI_RELAY_PARENT_SESSION` | Extension (child only) | Parent's session ID |
| `PI_RELAY_PARENT_NAME` | Extension (child only) | Parent's display name |
| `PI_RELAY_CHILD_INDEX` | Extension (child only) | This child's index number |
| `PI_RELAY_DIR` | Extension | Override family directory path |
