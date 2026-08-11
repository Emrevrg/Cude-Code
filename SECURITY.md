# Security Policy

## Reporting a vulnerability

Please report security issues privately to **zgremre@gmail.com** rather than
opening a public issue. Include what you found, how to reproduce it, and what
an attacker could do with it. You'll get an acknowledgement within a few days.

Please don't open a public issue for a vulnerability until it has been fixed.

## How Cude Code handles your data

- **API keys** are stored in `~/.cude/config.json` on your own machine, and are
  read from `CUDE_*` environment variables as a fallback. They are never
  logged, and never sent anywhere except to the provider they belong to.
- **Conversations** are stored under `~/.cude/sessions/`, and spending records
  under `~/.cude/budget.json`. Nothing is uploaded.
- **Prompts and code** go only to the AI provider you selected for that
  request.

## Things worth knowing before you run it

- The agent can **run shell commands** through `run_command`. Destructive
  patterns (`rm -rf`, `mkfs.`, `shutdown`) prompt for confirmation first, but
  that list is not exhaustive — treat the agent as something running with your
  own shell privileges, and don't point it at a machine where an unexpected
  command would be costly.
- The agent can **read and write files** anywhere your user account can.
- **Browser tools** fetch whatever URL they are given. Page content becomes
  model input, so a hostile page is untrusted input reaching the agent.
- **RAG indexing** reads the directory you point it at and holds the contents
  in memory for the session. Don't index a directory containing secrets.

## Supported versions

Cude Code is pre-1.0 and moves fast. Fixes land on the latest release.
