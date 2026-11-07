# How to run Remote AI Browser Copilot

## Hotkeys (do not use Cmd+Option — that fights Chrome)

Configured in `config/default.json`:

| Action | Shortcut | What it does |
|--------|----------|--------------|
| **PREPARE** | **Control+Option+P** | Read focused field / selection as your prompt, generate draft, **do not type** |
| **GO** | **Control+Option+G** | Replace focused field with the draft and type it at the cursor |
| **HALT** | **Control+Option+H** | Stop typing immediately; keep remaining text |
| **RESUME** | **Control+Option+R** | Continue typing from where HALT stopped |

If hotkeys do nothing: grant **Accessibility** to Terminal (or iTerm / Cursor) in  
System Settings → Privacy & Security → Accessibility.  
CLI always works as a fallback.

---

## Exact commands

Open a terminal:

```bash
cd "/Users/ajitesh/Desktop/Agentic frameworks/remote-ai-copilot"
npm run build
```

### 1) Start agent in the foreground (see live logs)

```bash
npm run copilot -- start --foreground
```

Leave this terminal open. You should see:

```text
Hotkeys:   hotkey-bridge
  PREPARE  Control+Option+P
  GO       Control+Option+G
  HALT     Control+Option+H
  RESUME   Control+Option+R
```

Stop the agent: press `Ctrl+C` in that terminal, or from another terminal:

```bash
npm run copilot -- stop
```

### 2) Attach a browser (pick ONE)

**Option A — Playwright window (easiest)**

In a second terminal:

```bash
cd "/Users/ajitesh/Desktop/Agentic frameworks/remote-ai-copilot"
npm run copilot -- browser connect --mode playwright
npm run copilot -- browser open tests/fixtures/typing-test.html
```

A Chromium window opens with the test page.

**Option B — Dedicated Chrome profile (CDP)**

```bash
bash scripts/start-chrome-cdp.sh
# then, if Playwright was connected:
npm run copilot -- browser disconnect
npm run copilot -- browser connect --mode cdp
npm run copilot -- browser tabs
```

This uses `~/ChromeAgentProfile` (not your everyday Chrome).  
Log into sites you need in that window once.

> Everyday default Chrome attachment needs the Phase 4 extension (not shipped yet).

### 3) Manual “read screen” tools

```bash
npm run copilot -- browser text
npm run copilot -- browser read
npm run copilot -- browser focus
npm run copilot -- browser tabs
npm run copilot -- logs --last 50
# live logs:
npm run copilot -- logs --live
```

---

## The workflow you asked for

1. Focus a text box in the attached browser.
2. Type your prompt, e.g.  
   `write me python code for printing hello world`
3. Press **Control+Option+P** (PREPARE)  
   - Agent reads that text as the instruction  
   - Builds a draft (stub for now; DeepSeek later)  
   - **Nothing is typed yet**
4. Keep the same field focused, press **Control+Option+G** (GO)  
   - Agent replaces the prompt with the draft and types it
5. Mid-typing, press **Control+Option+H** (HALT)  
   - Typing stops; remaining draft is kept
6. Press **Control+Option+R** (RESUME)  
   - Continues from the pause point
7. Or press **Control+Option+P** again  
   - Cancels previous/remaining work and starts a new draft

### CLI equivalents (if hotkeys unavailable)

```bash
npm run copilot -- browser focus-selector "#reply"   # Playwright test page
npm run copilot -- browser type --replace "write me python code for printing hello world"
npm run copilot -- prepare
npm run copilot -- go
npm run copilot -- halt
npm run copilot -- resume
npm run copilot -- status
```

---

## Change hotkeys

Edit `config/default.json`:

```json
"shortcuts": {
  "prepare": "Control+Option+P",
  "go": "Control+Option+G",
  "halt": "Control+Option+H",
  "resume": "Control+Option+R"
}
```

Restart the agent after editing.
