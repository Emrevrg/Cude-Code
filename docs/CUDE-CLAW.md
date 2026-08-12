# Cude Claw

Cude Claw is the autonomous agent layer inside Cude Code. It combines a model,
tool execution, safety boundaries, iteration limits, and a verifiable result.

## Workflow

1. Select a provider and model.
2. Send the task with the agent system prompt.
3. Execute requested tools and return results through the provider's native
   tool-call protocol.
4. Repeat until completion, iteration exhaustion, budget exhaustion, or empty
   output.
5. Return an `AgentResult` with `success`, `stopReason`, output, usage, and
   execution steps.

The possible stop reasons are `completed`, `max_iterations`,
`budget_exceeded`, and `empty_output`. Only a non-empty completed response is
successful.

## Safety model

- Mutating file tools stay inside the workspace root.
- `delete_file` and destructive `run_command`, `git_command`, and
  `npm_command` calls require confirmation.
- POSIX and Windows destructive patterns are blocked without confirmation.
- Tool output is capped at 4,000 characters with an explicit truncation marker.

## Local and self-hosted models

```bash
cude config set-key vllm-endpoint http://localhost:8000
cude providers models vllm
cude run "review this code" --provider vllm --model my-model
```

vLLM, Ollama, and GGUF are treated as local/free for budget gating. LiteLLM
can point at a local or remote OpenAI-compatible gateway. Self-hosted servers
may expose model names dynamically; pass the server's model name with
`--model`.

## Extending Cude Claw

Providers implement `Provider` in `src/providers/types.ts`. Tool definitions
and execution live in `src/core/tools.ts`; add a definition, execution branch,
and regression test. OpenAI-compatible providers use `assistant.tool_calls`
plus `role: tool`; Anthropic maps these to `tool_use` and `tool_result` blocks.

```bash
npm run build
npm run type-check
npm run lint
npm run test:only
```
