# pi-relay

Pi extension for parent-child shell session communication.

## Installation

```bash
pi install git:github.com/geometriccross/pi-relay
```

## Tools

### `talk_to_parent` (child-only)

Send a message to the parent pi session.

### `talk_to_child` (parent-only)

Send a message to a child pi session.

### `reply_to_family`

Reply to the most recent incoming family message.

### `list_family`

List all sessions in the current family (parent + children).

## Configuration

Create `~/.pi/agent/family/config.json`:

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Enable/disable the extension |
| `maxMailboxSize` | `number` | `1000000` | Maximum mailbox file size in bytes before rotation |
| `pollIntervalMs` | `number` | `1000` | Polling interval for mailbox changes |
| `askTimeoutMs` | `number` | `600000` | Timeout for ask operations (ms) |
