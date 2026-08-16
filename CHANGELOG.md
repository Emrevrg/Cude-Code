# Cude Code - Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Benchmarking

Cude has no verified score on any independent leaderboard, and this release
does not invent one. It adds the harness that can produce one — `cude bench` —
together with the agent-loop work that a long benchmark run needs in order to
finish at all.

- **`cude bench local|swebench|terminal-bench|list`.** Each task runs in its own
  temp sandbox with the workspace root pointed at it, and is graded by a shell
  command run *after* the agent stops — the model's "TASK COMPLETE:" has no
  bearing on the result. Reports (`run.json`, `report.md`) carry a provenance
  label: `local`, `unofficial` or `official`, with the caveat printed above the
  number.
- **The local suite** — eight tasks graded by `node --test`: implement against
  a test, fix real bugs, rename across files, make a precise single-function
  edit, document a module. No Docker, no dataset, no network. A test asserts
  every task fails before the agent touches it, and tasks graded by a test file
  restore that file first, so deleting the test cannot pass a task.
- **SWE-bench Verified** — checks out each instance at its base commit, runs the
  agent, and writes `predictions.jsonl` for the *official* Docker evaluator.
  Cude does not grade itself on it. See [BENCHMARKS.md](BENCHMARKS.md).

### Agent

Six changes to the loop, each of which the benchmark harness measures (O1–O6):

- **Context compaction.** The loop re-sends the whole conversation every turn,
  so a run that read a few large files did not degrade — it died on a
  context-window error. Old tool results are digested, then whole steps are
  dropped, oldest first, with a note left where they were. The turn-sequence
  invariant is preserved at every budget, which is tested.
- **Tool-call repair.** `writeFile` → `write_file`, `file_path` → `path`, `bash`
  → `run_command`, a JSON object inside a markdown fence → arguments. Only
  unambiguous corrections are applied, and every one is reported. A misnamed
  call used to cost a full iteration.
- **Parallel reads.** A turn whose calls are all read-only runs concurrently;
  anything that mutates forces sequential execution.
- **`apply_patch` is atomic.** It located hunks by line number and skipped a
  `-` line that did not match *while still inserting the `+` lines around it* —
  a corrupted file, reported as success. Hunks are now found by content, all of
  them apply or none do, and the error names the hunk that failed.
- **Verification before completion.** `verifyCommand` runs the project's own
  tests when the model says it is finished; a failure is handed back with its
  output and the loop continues. A run that never satisfies it stops with
  `verification_failed` instead of `completed`.
- **Retry with backoff.** 429 and 5xx responses are retried with exponential
  backoff and jitter, honouring `Retry-After`. One rate limit used to end a
  run.

Also fixed: child processes inherited `NODE_TEST_CONTEXT`, so any nested
`node --test` reported success regardless of its tests — a verification command
that always passes is worse than none.

### Security

A security core (`src/core/security.ts`) that every tool call now passes
through, plus `cude security scan|audit|log|check`. The controls are enforced
in code, not asked for in the system prompt, because the model is a confused
deputy and not an adversary: it reads web pages, dependency READMEs and MCP
results that anyone can write. Nine classes of exposure closed (S1–S9):

- **S1 — Credential files are refused.** `.env`, `~/.ssh`, `~/.aws`, `~/.gnupg`,
  `*.pem`, `*.key`, `.npmrc`, `.netrc`, service-account JSON and the rest are
  unreadable through `read_file`, `grep_search`, `diff_files`, `copy_file`,
  `get_file_info`, RAG indexing, Claw's `@path` mentions and `file://` URLs.
  `.env.example` and other templates stay readable. RAG's file walk had gone
  out of its way to include `.env` — the one dotfile it skipped the dotfile
  rule for was the one holding the keys.
- **S2 — Secrets are redacted before they leave.** All tool output passes one
  choke point; anything matching a live credential shape becomes
  `[CUDE:REDACTED:<rule>]` before it reaches the model, the terminal or a
  session file. Placeholders and low-entropy values are left alone.
- **S3 — Redaction markers cannot be written back.** `write_file`,
  `replace_in_file` and `apply_patch` refuse content containing a marker, so a
  placeholder can never overwrite the real value. Writing a *new* live
  credential into a file asks first.
- **S4 — Command analysis replaces the blocklist.** Three verdicts instead of
  one boolean. Blocked outright: encoded PowerShell, base64-into-a-shell, and
  commands that read credential material and send it over the network.
  Confirmed: destructive commands, uploads, inline interpreter one-liners,
  persistence, broad permission grants, reverse shells. A command's working
  directory is now confined to the workspace root, and output is capped.
- **S5 — Child processes no longer inherit credentials.** `run_command`,
  `git_command`, `npm_command` and stdio MCP servers get an environment with
  every credential-shaped variable removed. A malicious `postinstall` script
  used to receive every API key the user had exported.
- **S6 — Egress control.** Cloud metadata endpoints are always refused; only
  `http`, `https` and `file` schemes are allowed; `file://` obeys the read
  deny-list. `browser_screenshot` was the one write path in the tool set that
  never checked the workspace boundary — it does now.
- **S7 — Untrusted content is labelled.** Browser and MCP output is wrapped in
  `<untrusted source="…">` and scanned for injection markers.
- **S8 — Owner-only storage and an audit log.** `~/.cude` and everything in it
  is written `0600`/`0700` on POSIX; session transcripts are redacted before
  they are saved; every tool call is appended to `~/.cude/audit.log` with
  redacted arguments and its outcome. Sessions also stopped ignoring
  `CUDE_HOME`, which they had been writing around.
- **S9 — `cude security scan`.** The same detection, pointed at a project: it
  finds hardcoded credentials in source, reports credential files that git is
  tracking, and exits non-zero under `--strict` for CI.

Every control has a documented escape hatch — `CUDE_ALLOW_SECRET_FILES`,
`CUDE_NO_REDACT`, `CUDE_ALLOW_UNSAFE_COMMANDS`, `CUDE_INHERIT_SECRETS`,
`CUDE_AUDIT=0` — and `cude security audit` reports any that are set. See
[SECURITY.md](SECURITY.md).

### New Features

- **Cude Claw** (`cude claw`) — an interactive agent session that keeps context
  between turns. Every file edit is previewed as a diff and approved
  individually (yes / no / always / stop); a declined edit tells the model not
  to retry it, and stopping mid-turn still answers every tool call the model
  made. `@path` in a message attaches that file's contents. Slash commands:
  `/mode` `/model` `/tools` `/mcp` `/rules` `/cost` `/undo` `/checkpoints`
  `/auto` `/clear` `/exit`.
- **Agent modes** — `code`, `architect`, `ask`, `debug`, `orchestrator`. A mode
  is a system prompt plus a tool budget, and the budget is enforced twice: when
  the tool list is built for the model, and again before each call, so a model
  asking for a tool it was never offered is refused rather than obeyed.
  Architect's "writes only Markdown" is a path rule, not a description.
  `cude run --mode <name>`, `cude modes list|show`.
- **Project rules** — `AGENTS.md`, `CUDE.md`, `.cuderules` and
  `.cude/rules/*.md` are discovered from the filesystem root down to the
  workspace root, so a monorepo rule applies to packages inside it and the
  closest file wins. `cude rules`.
- **Checkpoints** — the state of every file is captured before the agent
  changes it, so any edit can be undone. Works without git and never touches
  git if present. `cude checkpoint list|show|restore|restore-run|clear`.
- **MCP server support** — connect Model Context Protocol servers over stdio or
  HTTP and their tools become agent tools, namespaced `mcp__<server>__<tool>`
  so none can shadow a built-in. Implemented against the protocol directly, so
  no new runtime dependency. `~/.cude/mcp.json` uses the same `mcpServers`
  shape as other MCP clients. `cude mcp list|test|add|remove|enable|disable`.

### Bug Fixes

Ten defects found by an end-to-end audit that installed the tool and ran the
agent against a local OpenAI-compatible endpoint. F1, F2 and F5 change
behaviour.

- **[F1] The agent reported success even when it failed.** `runToolsAgent` and
  `runReActAgent` returned `success: true` unconditionally, so a run that
  exhausted `--max-iterations` or tripped the budget gate printed
  `✔ Task completed!` and exited 0. `AgentResult` now carries
  `stopReason: 'completed' | 'max_iterations' | 'budget_exceeded' |
  'empty_output'`, `success` is true only when the model itself finished and
  left non-empty output, and `cude run` prints the reason and exits 1 on
  failure. **Behaviour change:** failing runs now have a non-zero exit code.
- **[F2] Tool results were sent outside the tool-call protocol.** Tool output
  was appended as plain text into the assistant's own message, hiding from the
  model the arguments it had called each tool with, and producing consecutive
  assistant messages that always ended on one — which Anthropic (the default
  for `code` tasks) reads as prefill continuation. Assistant messages now carry
  their `tool_calls` and each result comes back as a `role: 'tool'` message
  keyed by `tool_call_id`; Anthropic gets `tool_use` / `tool_result` content
  blocks. **Behaviour change:** the wire format of every agent request.
- **[F3] Tool output was truncated silently** at 500 chars (1000 in the ReAct
  loop). The limits are now named constants (8000 / 4000) and a clipped result
  ends with `... [truncated, showed N of M chars]`.
- **[F4] Four endpoint settings were unreachable.** `vllm-endpoint`,
  `litellm-endpoint`, `gguf-endpoint` and `azure-endpoint` all failed with
  "Unknown provider", which left Azure permanently unconfigurable. `config
  set-key` accepts them, `cude config set-endpoint <provider> <url>` was added,
  and `cude config list` shows configured endpoints.
- **[F5] No filesystem boundary, and the destructive-command filter missed
  Windows.** Mutating file tools are confined to a workspace root (default
  `process.cwd()`, overridable via `CUDE_WORKSPACE_ROOT` or `cude config set
  workspace-root`); `delete_file` requires confirmation; the pattern list
  covers `del /f`, `rd /s`, `rmdir /s`, `Remove-Item -Recurse`, `diskpart`,
  `rm -r`, `Invoke-Expression`/`iex` and pipe-to-shell; and `git_command` and
  `npm_command` go through the filter. **Behaviour change:** writes outside the
  workspace root are rejected and deletes prompt.
- **[F6] The budget gate blocked free and local providers.** A $0 limit stopped
  vLLM, Ollama and GGUF runs that cost nothing. The gate is now skipped when
  the selected provider/model is free or local.
- **[F7] A budget limit could not be removed** without editing
  `~/.cude/budget.json`. Adds `cude budget unset [--total] [--monthly]
  [--alert] [--all]`.
- **[F8] Budget status printed `NaN%`** when a limit was 0.
- **[F9] vLLM had no catalog entries and was mislabelled `Paid`.** The
  Free/Local column reads each provider's declared cost class, and
  `cude providers models <p>` lists what a self-hosted server actually serves.
- **[F10] Every stderr line became a PowerShell error.** ora's spinner output
  moves to stdout; stderr is reserved for genuine errors.

### Testing

- `test/helpers/openai-stub.mjs`: a scripted local OpenAI-compatible server
  that makes the agent loop testable end-to-end with no API key.
- New suites: `agent`, `wire`, `config`, `budget`, `providers`, `spinner`,
  `modes`, `checkpoints`, `mcp`, `claw`. 130 tests total, up from 24.
- `test/helpers/mcp-stub-server.mjs`: a real stdio MCP server, so the client is
  tested against the protocol rather than a mock of it — which is how two
  Windows spawn bugs and a tool-namespacing bug were caught.
- `CUDE_HOME` redirects persisted state so budget- and config-backed behaviour
  can be tested without touching the real `~/.cude`.

## [0.1.0] - 2026-08-10

### Bug Fixes
- **Model pricing was wrong, and the budget tracker uses it.** Claude Opus 4.8
  was recorded at $15/$75 per million tokens when it is $5/$25, and Haiku 4.5
  at $0.25/$1.25 when it is $1/$5 — so `cude budget status` over-reported Opus
  spend 3x and under-reported Haiku 4x. Context windows were recorded as 200K
  for models that carry 1M.
- **`search_files` crashed on globs.** The schema advertised "glob pattern or
  regex" but the pattern went straight to `RegExp`, so `*.ts` threw
  `Nothing to repeat`. Globs are now translated, regex still works, and an
  unparseable pattern falls back to a literal match. A `statSync` failure on
  one entry (broken symlink) also no longer aborts the whole search.
- **Unreachable local providers reported `fetch failed`.** Ollama, vLLM,
  llama.cpp and LiteLLM now name the service and the endpoint, and say how to
  start it.
- **Missing tool arguments produced low-level errors** such as
  `paths[0] must be of type string`. `executeTool` now validates against each
  tool's declared `required` list and names the missing and accepted
  parameters.
- **Browser tools dumped a raw Playwright stack trace** when Chromium was not
  installed; they now point at `npx playwright install chromium`.
- **Task-type selector referenced a model that no longer exists** in the
  catalog (`claude-sonnet-4-6`) on three routes.

### New Features
- **Claude 5 models**: Opus 5, Sonnet 5 and Fable 5 added to the catalog
- **Browser automation tools**: `browser_navigate`, `browser_screenshot`, `browser_extract` powered by Playwright for headless web interaction
- **Native RAG**: `rag_index`, `rag_search`, `rag_summary` for in-memory keyword-based search across local codebases
- **22 agent tools** (up from 16): added 3 browser tools and 3 RAG tools
- **Brand identity**: hexagonal C> mark rendered as quadrant block art in the
  terminal, generated from `assets/cude-mark.svg` by `tools/generate-logo.mjs`
  rather than hand-drawn, plus the SVG banner for GitHub

### Housekeeping
- Removed 6 dependencies with no reference anywhere in `src/` —
  `@xenova/transformers` (45MB), `figlet` (21MB), `simple-git`, `cli-table3`,
  `dotenv`, `execa` — shrinking an install by roughly 67MB
- Added `.eslintrc.json`; `npm run lint` previously failed outright with no
  config, and now reports 0 errors
- Added CI workflow, `CONTRIBUTING.md`, `SECURITY.md`, issue forms and a PR
  template

### Breaking Changes
- Version reset from 1.1.0 to 0.1.0 to reflect proper semver for pre-1.0 development

### Inherited from 1.1.0
- **16 core agent tools**: `move_file` (rename), `diff_files` (file comparison), `apply_patch` (multi-hunk unified diff)
- **Multi-occurrence edits**: `replace_in_file` supports `replace_all`
- **Environment variable fallback for API keys**: `CUDE_<PROVIDER>_KEY` and provider-conventional names
- **9 task types**: `code`, `quick`, `complex`, `general`, `analysis`, `writing`, `research`, `reasoning`, `cheap`
- **Full provider parity in config**: all 19 providers supported
- **Automatic data migration**: legacy `~/.codiente` to `~/.cude`

## [1.0.0] - 2025-01-01

### Initial release
- Multi-provider support (19 AI providers: OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, Ollama, vLLM, LiteLLM, and more)
- Interactive chat mode with streaming and markdown rendering
- Autonomous agent with tool use (read/write/replace/delete/copy files, list/create directories, search, grep, run commands, git, npm)
- Local model support via Ollama, vLLM, or llama.cpp
- Session management: save, restore, and export conversations
- Cost tracking with budget limits and alerts
- Provider smart selector with task-type-aware routing
