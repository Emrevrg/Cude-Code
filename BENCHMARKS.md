# Benchmarks

## Where Cude Code actually stands

**Cude Code has no verified score on Terminal-Bench, SWE-bench Verified, or any
other independent leaderboard.** Nothing in this repository claims otherwise,
and no number appears in the README that has not been produced by a run anyone
can repeat.

That gap is real, and this file is about closing it properly rather than
papering over it. A benchmark figure is worth exactly as much as the harness
behind it: who graded it, on what dataset, at what version, and can someone
else get the same number. Until Cude has been through an official evaluator,
the honest statement is the one above.

What exists now is the machinery that produces such a number — a harness that
runs the real agent against real tasks and grades it by something other than
the model's own claim of success.

```bash
cude bench list                 # what can be run, and what each one needs
cude bench local                # Cude's own suite: no Docker, no dataset, no network
cude bench swebench --dataset swe-bench-verified.jsonl --limit 25
cude bench terminal-bench --tasks path/to/terminal-bench/tasks
```

## How grading works

Three rules the harness enforces, because they are the ones that make a number
mean anything:

1. **The grader is not the agent.** Every task is graded by a command run after
   the agent has stopped, in the task's own directory, through the shell — not
   through the agent's tools. `TASK COMPLETE:` in a model's final message has
   no effect on the result. A run where the model declares victory and the
   tests still fail is a failure.
2. **Every task starts out failing.** There is a test asserting this for the
   whole local suite: a task whose verifier passes before the agent touches
   anything measures nothing.
3. **Every run states its provenance.** A run is labelled `local`,
   `unofficial`, or `official`, and the report repeats the caveat above the
   number. Only a grade produced by a dataset's own evaluator is written
   without one.

Each task runs in its own temporary directory with the workspace root pointed
at it, so a task cannot reach the machine or another task — there is a test
that tries to write outside the sandbox and asserts it fails. Tasks run one at
a time, deliberately: the workspace root and the process working directory are
global, so overlapping tasks would mean one task's shell commands executing in
another's tree.

## The local suite

Eight tasks, graded by `node --test`, which is present wherever Cude runs.
No Docker, no dataset download, no network — the suite you can run on every
change.

| Task | What it exercises |
| --- | --- |
| `implement-fizzbuzz` | Write a module so an existing test passes |
| `fix-slugify` | Three real bugs, found by reading a failing test |
| `fix-divide-by-zero` | An edge case the implementation never handled |
| `implement-arg-parser` | Implement against a spec that exists only as tests |
| `implement-retry` | Async control flow, including the give-up path |
| `multi-file-rename` | A rename across three files without breaking imports |
| `patch-precise-edit` | Change one function and leave its neighbours alone |
| `document-module` | Read code and write accurate prose about it |

Tasks whose grade depends on a test file restore that file before grading, so
deleting or editing the test cannot pass a task.

## SWE-bench Verified

This harness does **not** grade SWE-bench. Grading requires the official Docker
evaluation images, and a score produced any other way is not the score people
mean when they quote one.

What `cude bench swebench` does is the half that is Cude's job: check out each
instance at its base commit, run the agent on the issue text, and write the
working-tree diff into a `predictions.jsonl` in the format the official
evaluator consumes.

```bash
# 1. Get the dataset
#    https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified

# 2. Produce predictions
cude bench swebench --dataset swe-bench-verified.jsonl \
  --provider anthropic --model claude-sonnet-5 --limit 25

# 3. Grade them with the official harness
python -m swebench.harness.run_evaluation \
  --predictions_path .cude-bench/predictions.jsonl \
  --dataset_name princeton-nlp/SWE-bench_Verified \
  --run_id cude
```

The number that comes back from step 3 is a number worth publishing. When one
exists, it goes here with the model, the date, the Cude version and the run id
next to it.

## Terminal-Bench

Terminal-Bench grades inside containers it builds itself, driven by its own
`tb` runner. `cude bench terminal-bench` reads a task directory, hands the
instruction to the agent in a sandbox, and runs whatever test script the task
ships. That is useful during development and it is **not** a Terminal-Bench
score; runs are labelled `unofficial` and the report says so.

For a quotable number, run the official harness with Cude as the agent under
test.

## What the harness measures besides pass rate

Every run records what the loop had to do to get there, because a pass rate on
its own does not tell you what to fix:

- **tool calls** and **tool errors** — how much work each task took, and how
  much of it was wasted
- **repaired calls** — calls whose name or arguments had to be corrected
- **compactions** — turns where the conversation had to be compacted to stay
  inside the context window
- **stop reason** — `completed`, `max_iterations`, `verification_failed`,
  `budget_exceeded`, `timeout`
- cost, tokens and wall-clock time per task

Reports are written to `.cude-bench/<suite>-<timestamp>/` as `run.json` and
`report.md`.

## Reproducing a run

```bash
git clone https://github.com/Emrevrg/Cude-Code.git
cd Cude-Code && npm install && npm run build
cude config set-key anthropic <key>
cude bench local --provider anthropic --model claude-sonnet-5
```

The harness itself is covered by the test suite (`test/bench.test.mjs`), which
drives the real agent loop against a scripted local server — sandboxing,
grading, the report, and the refusal to accept an unverified completion are all
exercised without an API key.
