# Contributing to Cude Code

Thanks for taking the time to contribute.

## Getting set up

```bash
git clone https://github.com/Emrevrg/Cude-Code.git
cd Cude-Code
npm install
npm run build
```

Run the CLI you just built with `node dist/index.js`, or `npm run dev` to run
from source without building.

The three browser tools need Chromium, which is a separate download:

```bash
npx playwright install chromium
```

Everything else works without it.

## Before opening a pull request

```bash
npm run type-check   # tsc --noEmit
npm run lint         # eslint, must report 0 errors
npm run build        # tsc
```

`.github/workflows/ci.yml` runs these on Node 18, 20 and 22 for every push
and pull request.

> **GitHub Actions is not currently running for this repository** — jobs are
> rejected before any step executes, which is an account-level setting rather
> than anything in the workflow. Enable it under
> *Settings → Actions → General → Allow all actions*, and check
> *Settings → Billing → Spending limits* if jobs still fail instantly. Until
> then, run the three commands above locally before opening a pull request.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/commands/` | One file per CLI command (`chat`, `run`, `config`, …) |
| `src/core/` | Agent loop, the 22 tools, browser automation, RAG |
| `src/providers/` | One file per AI provider, all implementing `Provider` |
| `src/config/` | Model catalog, pricing, stored settings |
| `src/ui/` | Terminal rendering — banner, tables, spinners |
| `tools/` | Repo tooling (regenerates the CLI logo and preview image) |

## Adding a provider

Implement the `Provider` interface in `src/providers/types.ts`, add the file to
`src/providers/index.ts`, and add the models to `src/config/models.ts` with
their real pricing — the budget tracker reads those numbers, so a wrong price
silently produces wrong spend reports.

## Adding a tool

Add the definition to the relevant `*_TOOL_DEFINITIONS` array and handle it in
`executeTool`. Two things are easy to get wrong:

- List every mandatory parameter in `required` — `executeTool` validates
  against it and returns a clear error instead of a low-level crash.
- Return `{ success: false, error }` rather than throwing, so the agent can
  read the failure and retry.

## Changing the brand mark

Don't hand-edit the block art in `src/ui/display.ts`. It is generated from
`assets/cude-mark.svg`:

```bash
node tools/generate-logo.mjs --write   # regenerate the terminal art
npm run build
node tools/generate-cli-preview.mjs    # regenerate assets/cude-cli.png
```

## Commit messages

Describe what changed and why. Keep the subject under ~72 characters.

## Reporting bugs

Include the output of `cude --version`, your Node version, the command you ran,
and what happened. Never paste an API key into an issue.
