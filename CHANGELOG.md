# Cude Code - Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Fixed truthful agent completion and non-zero failure exits.
- Restored native tool-call protocol and explicit output truncation markers.
- Added workspace boundaries, Windows destructive-command detection, and
  confirmation for file, git, and npm mutations.
- Added self-hosted endpoint configuration, local budget exemptions,
  `cude budget unset`, zero-limit protection, metadata-based provider labels,
  stdout spinners, and the Cude Claw guide.

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
