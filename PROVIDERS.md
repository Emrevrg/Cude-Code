# 🔌 CUDE Code Provider Guide

Complete guide to configuring and using different AI providers with CUDE Code.

## Provider Overview

| Provider | Type | Free | Local | Speed | Quality | Setup Difficulty |
|----------|------|------|-------|-------|---------|-----------------|
| OpenAI | Cloud | ❌ | ❌ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Easy |
| Anthropic | Cloud | ❌ | ❌ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Easy |
| Google Gemini | Cloud | ✅* | ❌ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Easy |
| DeepSeek | Cloud | ❌ | ❌ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Easy |
| Groq | Cloud | ✅ | ❌ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Easy |
| Ollama | Local | ✅ | ✅ | ⭐⭐⭐ | ⭐⭐⭐ | Medium |
| vLLM | Local | ✅ | ✅ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Hard |
| Azure OpenAI | Cloud | ❌ | ❌ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Hard |
| OpenRouter | Cloud | ❌ | ❌ | ⭐⭐⭐ | Varies | Easy |
| Together AI | Cloud | ❌ | ❌ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Easy |

## Recommended Setup

### For Beginners (Free)
1. **Groq** (Fastest free option)
2. **Gemini Flash** (Best quality for free)
3. **Ollama** (For local, no API key needed)

### For Development
1. **OpenAI GPT-4 Turbo** (Best all-around)
2. **Anthropic Claude 3 Opus** (Best for complex coding)
3. **Groq** (As fallback for cost savings)

### For Production
1. **Azure OpenAI** (Enterprise features)
2. **AWS Bedrock** (Integrated with AWS)
3. **OpenRouter** (Multiple models, unified API)

## Cloud Providers

### OpenAI (GPT-4 Family)

**Models:**
- `gpt-4-turbo`: Latest GPT-4, 128K context, $10/$30 per 1M tokens
- `gpt-4`: Base GPT-4, 8K context, $30/$60 per 1M tokens
- `gpt-3.5-turbo`: Fast, cheap, $0.50/$1.50 per 1M tokens

**Setup:**
```bash
# Get API key from https://platform.openai.com/api-keys
cude config set-key openai sk-proj-xxxxx
cude chat -p openai -m gpt-4-turbo
```

**Best For:** Production use, complex reasoning, code generation

**Pricing Tier:** Medium to High

---

### Anthropic (Claude Family)

**Models:**
- `claude-3-opus`: Most capable, 200K context, $15/$75 per 1M tokens
- `claude-3-sonnet`: Balanced, 200K context, $3/$15 per 1M tokens
- `claude-3-haiku`: Fast & cheap, 200K context, $0.25/$1.25 per 1M tokens

**Setup:**
```bash
# Get API key from https://console.anthropic.com/
cude config set-key anthropic sk-ant-xxxxx
cude chat -p anthropic -m claude-3-opus
```

**Best For:** Long context documents, careful reasoning

**Pricing Tier:** Low to High

---

### Google Gemini

**Models:**
- `gemini-2.0-flash`: Latest, very fast, 1M context
- `gemini-1.5-pro`: Powerful, 1M context
- `gemini-1.5-flash`: Free tier available!

**Setup:**
```bash
# Get free API key from https://makersuite.google.com/app/apikey
cude config set-key gemini YOUR_API_KEY
cude chat -p gemini
```

**Best For:** Free usage, large context windows

**Pricing Tier:** Free tier available

---

### Groq (Fastest)

**Models:**
- `mixtral-8x7b-32768`: Fast, 32K context, FREE!
- `llama2-70b-4096`: Larger, 4K context, FREE!
- `gemma-7b-it`: Small, fast, FREE!

**Setup:**
```bash
# Get free API key from https://console.groq.com/
cude config set-key groq gsk_xxxxx
cude chat -p groq --free
```

**Best For:** Fast responses, testing, free tier

**Pricing Tier:** Free (within limits)

---

### DeepSeek

**Models:**
- `deepseek-chat`: Advanced reasoning, affordable
- `deepseek-coder`: Specialized for code

**Setup:**
```bash
# Get API key from https://platform.deepseek.com/
cude config set-key deepseek sk-xxxxx
cude chat -p deepseek
```

**Best For:** Code generation, cost-effective

**Pricing Tier:** Very Low

---

### Mistral

**Models:**
- `mistral-large`: Most capable
- `mistral-medium`: Balanced
- `mistral-small`: Fast & cheap

**Setup:**
```bash
# Get API key from https://console.mistral.ai/
cude config set-key mistral xxxxx
cude chat -p mistral -m mistral-large
```

**Best For:** European region, open-source alternatives

**Pricing Tier:** Low

---

### OpenRouter (Universal)

**Access to:** GPT-4, Claude, Gemini, Mistral, Llama, and more via one API

**Setup:**
```bash
cude config set-key openrouter sk-or-xxxxx
cude chat -p openrouter -m openai/gpt-4-turbo
cude providers models openrouter  # See all available models
```

**Best For:** Trying multiple models, comparing responses

**Pricing Tier:** Provider-dependent

---

### xAI (Grok)

**Models:**
- `grok-beta`: Latest Grok model

**Setup:**
```bash
cude config set-key xai YOUR_API_KEY
cude chat -p xai
```

**Best For:** Testing alternative models

**Pricing Tier:** Variable

---

## Local Providers

### Ollama (Recommended for Local)

**Popular Models:**
- `mistral` (7B, recommended start point)
- `neural-chat`
- `dolphin-mixtral`
- `llama2`

**Setup:**

1. Install Ollama: https://ollama.ai
2. Start Ollama and pull a model:
   ```bash
   ollama pull mistral
   ollama serve  # Keep this running in background
   ```
3. Use with CUDE:
   ```bash
   cude chat -p ollama
   cude run "task" --free  # Uses Ollama if running
   ```

**Best For:** Privacy, offline usage, no API costs

**Specs:** Requires 4GB RAM minimum for 7B models

---

### vLLM (Advanced Self-Hosted)

For running multiple open-source models efficiently with better performance.

**Setup:**

1. Install vLLM:
   ```bash
   pip install vllm
   python -m vllm.entrypoints.openai.api_server \
     --model mistralai/Mistral-7B-Instruct-v0.1 \
     --port 8000
   ```

2. Configure CUDE:
   ```bash
   cude config set-key vllm-endpoint http://localhost:8000
   cude chat -p vllm
   ```

**Best For:** Production self-hosted, high throughput

**Performance:** 10-100x faster than Ollama

---

### Local GGUF Models (llama.cpp)

Run GGUF format models directly.

**Setup:**

1. Install llama.cpp:
   ```bash
   git clone https://github.com/ggerganov/llama.cpp
   cd llama.cpp
   make
   ./server -m model.gguf
   ```

2. Configure CUDE:
   ```bash
   cude config set-key gguf-endpoint http://localhost:8080
   cude chat -p gguf
   ```

**Best For:** Minimal resource usage, edge deployment

---

## Enterprise Providers

### Azure OpenAI

**Setup:**
```bash
# Get from Azure Portal
cude config set-key azure YOUR_API_KEY
cude config set azure-endpoint https://YOUR-RESOURCE.openai.azure.com/
cude chat -p azure -m deployment-name
```

**Best For:** Enterprise, compliance requirements, integrated deployments

---

## Provider Comparison Matrix

### Quality Rankings (Subjective)
1. Claude 3 Opus (Best reasoning)
2. GPT-4 Turbo (Best overall)
3. Gemini 2.0 Flash (Best value)
4. DeepSeek (Best for code)
5. Mistral Large (Balanced)

### Speed Rankings
1. Groq (Fastest online)
2. vLLM (Fastest local)
3. Gemini 2.0 (Fast online)
4. llama.cpp (Fast local)
5. GPT-4 Turbo (Slowest, but most capable)

### Cost Rankings (Lowest First)
1. Groq (Free!)
2. Ollama (Free!)
3. DeepSeek ($0.14/$0.28 per M tokens)
4. Gemini Flash ($0.075/$0.3 per M tokens)
5. GPT-3.5 Turbo ($0.50/$1.50 per M tokens)
6. OpenRouter (Variable)
7. Mistral ($0.25/$0.75 per M tokens)
8. Claude 3 Opus ($15/$75 per M tokens)
9. GPT-4 Turbo ($10/$30 per M tokens)
10. Azure OpenAI (Premium pricing)

## Troubleshooting

### Provider Not Working

```bash
# Test provider connectivity
cude providers test

# Check if API key is set
cude config list-keys

# View detailed error
cude chat -p problem-provider -v
```

### Rate Limiting

Solution: Use fallback providers or OpenRouter's unified API.

```bash
cude config set fallback-provider groq
```

### High Costs

Switch to free providers:
```bash
cude chat --free  # Uses Groq + Gemini Flash
```

### Slow Responses

Use faster providers:
```bash
cude chat -p groq     # Fastest
cude chat -p ollama   # Fast local
```

## Migration Guide

### From Claude.ai
Equivalent models:
- Claude 3 Opus → Use `claude-3-opus` via Anthropic provider

### From ChatGPT
Equivalent models:
- GPT-4 → Use `gpt-4-turbo` via OpenAI provider

### From Gemini
Same provider name, just set API key:
```bash
cude config set-key gemini YOUR_KEY
```

## Tips & Tricks

1. **Cost Optimization**: Start with `--free`, add paid models as needed
2. **Fast Testing**: Use Groq for quick iterations
3. **Quality Work**: Use Claude 3 Opus or GPT-4 Turbo
4. **Privacy**: Use Ollama for sensitive projects
5. **Scale**: Use vLLM in production for throughput

---

*Last updated: 2025*
