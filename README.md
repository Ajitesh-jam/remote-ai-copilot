# Remote AI Browser Copilot

Mac-local browser copilot with a strict **PREPARE → GO → HALT** control plane. The AI prepares drafts; the local agent decides whether to type. Nothing is typed unless you press GO.

## Status (Phases 1–2)

| Capability | Status |
| ---------- | ------ |
| Dedicated Playwright browser | Implemented |
| Context extraction (DOM / focus / visible text) | Implemented |
| CLI (`copilot`) browser tools | Implemented |
| Agent state machine | Implemented |
| PREPARE / GO / HALT pipelines | Implemented |
| Stub draft provider | Implemented |
| Global shortcuts (⌘⌥P / ⌘⌥G / ⌘⌥H) | Implemented via optional `global-shortcuts` |
| DeepSeek / remote server | Phase 3 / 6 |
| Chrome extension + CDP profile | Phase 4 |
| Dashboard | Phase 7 |

## Prerequisites

- macOS
- Node.js 20+
- Playwright Chromium (installed via `npx playwright install chromium`)

Global hotkeys: if `global-shortcuts` installs cleanly, ⌘⌥P / ⌘⌥G / ⌘⌥H work system-wide. Otherwise use the CLI (`copilot prepare`, `copilot go`, `copilot halt`). Accessibility permissions may be required depending on the hotkey backend.

## Quick start

```bash
cd remote-ai-copilot
npm install
npx playwright install chromium
npm run build

# Start agent (background)
npm run copilot -- start

# Or foreground
npm run copilot -- start --foreground
```

In another terminal:

```bash
npm run copilot -- browser connect
npm run copilot -- browser open tests/fixtures/typing-test.html
# Click the textarea in the browser window, then:
npm run copilot -- prepare
npm run copilot -- status
npm run copilot -- go
# Interrupt with:
npm run copilot -- halt
```

## Shortcuts

| Shortcut | Action |
| -------- | ------ |
| ⌘⌥P | PREPARE — capture context, generate draft, **do not type** |
| ⌘⌥G | GO — validate focus/tab, insert draft |
| ⌘⌥H | HALT — abort typing immediately, keep draft |

Configurable in `config/default.json` → `shortcuts`.

## CLI

```text
copilot start | stop | status | logs [--live] [--last 100]
copilot prepare [-i "instruction"]
copilot go
copilot halt
copilot browser connect | disconnect | tabs | select <id> | open <url>
copilot browser read | text | focus | a11y | elements | url | screenshot | type "…"
```

## Architecture invariants

1. PREPARE never types.
2. GO never runs without a stored draft and successful target validation.
3. HALT is local (`AbortController`) and does not wait on any remote server.
4. No automatic form/email submit.
5. Passwords, cookies, and tokens are not collected.

## Configuration

See [`config/default.json`](config/default.json). Secrets go in `.env` (see `.env.example`), never in source.

For tests / CI, `config/development.json` sets `browser.headless: true`.

## Tests

```bash
npm test
```

### Phase 1–2 acceptance checklist

- [x] Monorepo scaffold with shared types + logger
- [x] Playwright adapter connects and lists tabs
- [x] Fixture page visible text readable via CLI / adapter
- [x] Manual `browser type` inserts into focused textarea
- [x] PREPARE stores draft without typing
- [x] GO inserts draft after focus validation
- [x] HALT aborts mid-chunk typing
- [x] Structured logging events for browser / keyboard / execution
- [x] Unit tests for state machine, validator, halt controller
- [x] Integration test for read + type + abort

## Project layout

```text
remote-ai-copilot/
  apps/mac-agent/     Local agent, CLI, Playwright adapter, shortcuts
  packages/           shared-types, logger, protocol
  config/             default + development JSON
  tests/              Vitest unit + Playwright adapter tests
  logs/               Runtime logs + pid file
```

## Next phases

3. DeepSeek LLM provider + Fastify prepare API  
4. Chrome extension + Native Messaging; CDP for dedicated profile  
5. Full health probes + live log categories  
6. Authenticated remote WebSocket server  
7. Next.js dashboard  
8. launchd + Keychain hardening  
