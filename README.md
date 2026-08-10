# 🚀 CUDE Code - Professional AI Development CLI

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/cude-code)](https://www.npmjs.com/package/cude-code)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-green)](./PROJECT_STATUS.md)

**The best open-source alternative to Claude Code & Cursor**

CUDE Code is a production-ready, feature-rich CLI tool for AI-assisted development. It supports 19+ AI providers and brings professional capabilities to your terminal.

```bash
npm install -g cude-code
cude chat
```

## ⭐ Why CUDE Code?

- **🆓 Free & Open Source**: MIT licensed, no hidden costs
- **🤖 19+ AI Providers**: OpenAI, Anthropic, Gemini, DeepSeek, Groq, Ollama, and more
- **🔌 Plug & Play**: Works out of the box with just an API key
- **⚡ Autonomous Agent**: Solve complex tasks with tool-use
- **💰 Cost Tracking**: Monitor spending, set budgets, get alerts
- **📁 Session Management**: Save and restore conversations
- **🔐 Privacy First**: Everything stays on your machine
- **🛠️ Powerful Tools**: File operations, git integration, shell commands
- **📱 Pure CLI**: No Electron, lightweight and fast

## 🚀 Quick Start

### 1. Install
```bash
npm install -g cude-code
```

### 2. Setup
```bash
cude setup
```

### 3. Start Coding
```bash
# Free chat with no API costs
cude chat --free

# Chat with GPT-4
cude chat -p openai -m gpt-4

# Run an autonomous task
cude run "Create a REST API in TypeScript"
```

## 📚 Usage Examples

### Interactive Chat
```bash
# Start a conversation
cude chat

# Use specific provider and model
cude chat -p anthropic -m claude-3-opus

# Continue a previous session
cude chat -s my-project

# Use only free providers
cude chat --free
```

### Autonomous Tasks
```bash
# Code generation
cude run "Write a React component for data table"

# Code review
cude run "Review src/api and suggest improvements"

# Bug fixing
cude run "Fix the error in main.ts"

# Documentation
cude run "Generate API docs for src/"
```

### Configuration
```bash
# Interactive setup
cude setup

# Set API keys
cude config set-key openai sk-...
cude config set-key anthropic sk-ant-...

# List configured keys
cude config list-keys

# Set defaults
cude config set default-provider openai
cude config set default-model gpt-4
```

### Provider Management
```bash
# List all providers
cude providers list

# Test connectivity
cude providers test

# View available models
cude providers models openai
```

### Budget Management
```bash
# Set spending limit
cude budget set 10          # $10 total
cude budget set 5 --monthly # $5/month

# Check spending
cude budget status

# Set alert
cude budget alert 5
```

### Session Management
```bash
# List sessions
cude sessions list

# Export session to markdown
cude sessions export <id> conversation.md

# Delete session
cude sessions delete <id>
```

## 🔌 Supported Providers

### Free & Fast ⚡
- **Groq**: Free tier, fastest responses
- **Gemini Flash**: Free tier, best quality for free
- **Ollama**: Local only, completely free

### Production Quality 🏆
- **OpenAI**: GPT-4 family, most capable
- **Anthropic**: Claude 3 family, best reasoning
- **Google Gemini**: Latest models, large context
- **DeepSeek**: Affordable, excellent for code

### Self-Hosted 🖥️
- **Ollama**: Local models, no setup needed
- **vLLM**: High-performance serving
- **llama.cpp**: Minimal requirements

### Complete List
OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Mistral, xAI, Cohere, Together AI, Perplexity, NVIDIA, OpenRouter, Azure OpenAI, LiteLLM, HuggingFace, vLLM, Replicate, Local GGUF, Ollama

[→ Full Provider Guide](./PROVIDERS.md)

## 🛠️ Available Tools

CUDE Code comes with powerful built-in tools:

- **File Operations**: read, write, replace, delete, copy files
- **Directory Management**: create, list, search directories  
- **Search**: file search, grep content search
- **Shell Commands**: execute any command safely
- **Git Integration**: run git commands
- **NPM Integration**: manage packages

[→ Full Tool Reference](./docs/tools.md)

## 💰 Cost Tracking

Built-in budget management:

```bash
# Set $10 spending limit
cude budget set 10

# Get real-time spending report
cude budget status

# Set $5 per-month limit
cude budget set 5 --monthly

# Get alerts at $8
cude budget alert 8
```

Supported cost tracking for:
- OpenAI, Anthropic, Google, Groq, and all cloud providers
- Per-token pricing for accuracy
- Historical tracking and reports

## 📖 Documentation

- **[Project Status](./PROJECT_STATUS.md)** - Current status, metrics, and verification checklist
- **[Providers Guide](./PROVIDERS.md)** - Setup each provider with detailed instructions
- **[Implementation Details](./IMPLEMENTATION_SUMMARY.md)** - Technical architecture and features
- **[Changelog](./CHANGELOG.md)** - Release notes and roadmap

## 🎯 Common Use Cases

### 1️⃣ Code Generation
```bash
cude run "Generate a GraphQL API with authentication in Node.js"
```

### 2️⃣ Code Review
```bash
cude run "Review the code in src/components/ and suggest improvements"
```

### 3️⃣ Bug Fixing
```bash
cude run "Debug and fix the TypeScript error in main.ts"
```

### 4️⃣ Refactoring
```bash
cude run "Refactor services/ to use dependency injection"
```

### 5️⃣ Documentation
```bash
cude run "Generate comprehensive docs for the API"
```

### 6️⃣ Testing
```bash
cude run "Write unit tests for the authentication module"
```

## ⚙️ Configuration

### Environment Variables
```bash
export CUDE_OPENAI_KEY="sk-..."
export CUDE_ANTHROPIC_KEY="sk-ant-..."
export CUDE_DEFAULT_PROVIDER="openai"
export CUDE_DEFAULT_MODEL="gpt-4"
```

### Config Files
- **Linux/macOS**: `~/.config/cude/config.json`
- **Windows**: `%APPDATA%\cude\config.json`

## 🔒 Security

- ✅ All data stored locally
- ✅ No cloud sync (unless enabled)
- ✅ API keys never logged
- ✅ Destructive commands require confirmation
- ✅ Safe command execution
- ✅ Open source for transparency

## 📊 Benchmarks

| Metric | Value |
|--------|-------|
| Startup Time | < 100ms |
| Token Estimation | Instant |
| Max File Size | 100MB |
| Memory Base | < 50MB |
| Max Contexts | Unlimited |

## 🤝 Contributing

We welcome contributions! Areas we need help with:

- [ ] Additional providers
- [ ] WebUI frontend
- [ ] VS Code extension
- [ ] Documentation improvements
- [ ] Bug fixes and optimizations

[Contributing Guide](./CONTRIBUTING.md)

## 📄 License

MIT © 2025 CUDE Code Contributors

Free for personal and commercial use.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/cude-code/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/cude-code/discussions)
- **Email**: support@cude-code.dev
- **Docs**: [Full Documentation](./docs/)

## 🎓 Learning Resources

- [Provider Configuration Guide](./PROVIDERS.md)
- [Advanced Usage Patterns](./docs/advanced.md)
- [API Reference](./docs/api.md)
- [Examples & Recipes](./docs/examples.md)

## 🚀 Roadmap

### Current (v1.0)
- ✅ Multi-provider support
- ✅ Chat & agent modes
- ✅ Session management
- ✅ Cost tracking

### Planned (v1.1)
- 🔄 MCP server support
- 🔄 RAG system
- 🔄 Browser automation
- 🔄 WebUI

### Future (v2.0)
- 🔄 VS Code extension
- 🔄 Team collaboration
- 🔄 Advanced analytics
- 🔄 Cloud sync

## 📜 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for detailed version history.

---

**Made with ❤️ by developers, for developers**

*CUDE Code - Where AI meets your terminal*

[![Star on GitHub](https://img.shields.io/github/stars/yourusername/cude-code?style=social)](https://github.com/yourusername/cude-code)
