# Cude Code - Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-08-10

### ✨ Features
- **16 agent tools** (up from 13): added `move_file` (rename), `diff_files` (file comparison), and `apply_patch` (multi-hunk unified diff)
- **Multi-occurrence edits**: `replace_in_file` now supports `replace_all` to replace every occurrence in a single call
- **Environment variable fallback for API keys**: `CUDE_<PROVIDER>_KEY` and provider-conventional names (e.g. `OPENAI_API_KEY`) are now read at runtime when no stored key exists
- **New task types**: `general` and `writing` are now first-class selector branches (previously fell through to the generic fallback)
- **Full provider parity in config**: `cude config set-key`, the setup wizard, and `config list-keys` now accept all 19 providers (azure, litellm, huggingface, vllm, replicate, gguf were previously rejected)
- **Automatic data migration**: on first launch, Cude Code moves any legacy `~/.codiente` directory to `~/.cude` (idempotent, best-effort)
- **Branded banner**: version, tool/task counts, and support contact are shown on startup

### 🐛 Fixes
- Resolved the split-brain between the public brand (`cude`) and the on-disk storage folder (`~/.codiente`); everything now lives under `~/.cude`
- Removed 28 stale `codiente` references across user-facing provider error messages and command hints
- Corrected `README` config-path documentation to match the real storage locations
- Removed the dead `desktop` command (Electron app was already removed) and cleaned up the `Codiente Agent` header

### 🧹 Chores
- Added `.npmignore` so `npm publish` ships `dist/` while excluding source and docs
- Added `repository`, `homepage`, and `bugs` metadata pointing at the GitHub repo
- Updated support contact to `zgremre@gmail.com`
- Added `assets/logo.svg`

## [1.0.0] - 2025-01-01

### 🚀 Initial release
- Multi-provider support (19 AI providers: OpenAI, Anthropic, Google Gemini, DeepSeek, Groq, Ollama, vLLM, LiteLLM, and more)
- Interactive chat mode with streaming and markdown rendering
- Autonomous agent with tool use (read/write/replace/delete/copy files, list/create directories, search, grep, run commands, git, npm)
- Local model support via Ollama, vLLM, or llama.cpp
- Session management: save, restore, and export conversations
- Cost tracking with budget limits and alerts
- Provider smart selector with task-type-aware routing
