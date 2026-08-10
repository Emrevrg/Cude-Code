# Cude Code - Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-08-10

### New Features
- **Browser automation tools**: `browser_navigate`, `browser_screenshot`, `browser_extract` powered by Playwright for headless web interaction
- **Native RAG**: `rag_index`, `rag_search`, `rag_summary` for in-memory keyword-based search across local codebases
- **22 agent tools** (up from 16): added 3 browser tools and 3 RAG tools
- **Brand identity**: custom ASCII logo in terminal, SVG banner and logo for GitHub

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
