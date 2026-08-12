# Cude Code - Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

Ten defects found by an end-to-end audit that installed the tool and ran the
agent against a local OpenAI-compatible endpoint. F1, F2 and F5 change
behaviour.

### Bug Fixes

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
- New suites: `agent`, `wire`, `config`, `budget`, `providers`, `spinner`.
  80 tests total, up from 24.
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
