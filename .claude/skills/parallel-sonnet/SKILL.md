---
name: parallel-sonnet
description: >-
  Offload implementation to one or more cheaper Claude models (Sonnet) running in
  visible host console windows while the orchestrator (the expensive model) plans,
  reviews, tests, and commits. Use this whenever the user wants to save tokens by
  delegating coding to Sonnet or Haiku, run work across multiple agents in parallel /
  "fan out" a batch of independent tasks, or watch agents build in real CLI windows
  with code appearing in their editor. Trigger on "offload to sonnet", "run this on
  sonnet", "use a cheaper model", "use haiku", "even cheaper model", "parallel
  agents", "fan out", "split this up", "spawn N agents", even when the user does not
  name the skill or a model explicitly.
  Windows + the claude CLI on the host. In Noah's Ark the stack is Node/TypeScript
  (apps, backend, infra) and Python (ml, edge, simulation).
---

# parallel-sonnet

Drive the cheap model for implementation; keep planning and review on the expensive
model. The division is what saves tokens: the orchestrator writes a tight brief and
reviews the diff, while Sonnet does the token-heavy file-writing in its own process,
so that work never enters the orchestrator's context. Running several agents at once
turns an afternoon of sequential slices into one parallel batch.

## The model
- **Orchestrator (you):** decompose the work, write one brief per task, launch the
  agents, then review every diff, run the project's formatter + tests, and commit.
- **Agent (Sonnet or Haiku):** reads its brief and writes files. It is fenced to file
  read/write only — no shell, git, or tests — so it cannot commit or run anything
  risky. Verification and commits are always the orchestrator's job.

### Choosing the agent model (`-Model`)
`launch.ps1` takes `-Model` (default `sonnet`); pass `-Model haiku` for the cheapest
runs. In practice:
- **Haiku** handles well-specified, mechanical work on the first pass — Inertia/Vue
  screens, CRUD forms, list/grid views, a controller that mirrors a sibling. If the
  brief names the exact files to copy for conventions, Haiku matches them closely.
  This is the default choice when the orchestrator has already built the backend.
- **Sonnet** earns its cost when the task carries more judgement — non-trivial logic,
  data shaping, or a pattern with no sibling to copy. When unsure, start on Haiku and
  only escalate a brief to Sonnet if the first diff needs real rework.
Either way the quality bar is the brief plus your review, not the model.

## Why the mechanics are the way they are
- The app **Terminal panel auto-cancels any command that doesn't return within ~2s**
  (it sends Ctrl-C). So every long run is launched **detached** in its own window via
  `Start-Process`; the launch call returns instantly and the agent is immune.
- The **repo working directory is shared** between the orchestrator's sandbox and the
  host, so files an agent writes on the host are visible to your review tools. (Only
  the repo — `%APPDATA%` and auth are not shared, which is why the CLI is installed
  and logged in on the host, separately.)
- Keeping agents file-only keeps verification (lint, tests, builds) in one place —
  you.

## Prerequisites (check once)
Run `scripts/check-cli.ps1` (detached or via a short `powershell -File` call). It
confirms the host has `claude` at `%APPDATA%\npm\claude.cmd` and prints the version.
If missing: `npm install -g '@anthropic-ai/claude-code'`. If a run later prints
"Not logged in", open `claude` interactively once and `/login`.

## Workflow

### 1. Decompose into file-disjoint tasks
Split the work so that **no two parallel agents create or edit the same file**
(separate modules, separate endpoints+models, docs vs code). If tasks share a file
(a provider/registration file, the same migration), merge them into one brief or run
them sequentially — a shared registration file is best edited by you after the agents
finish. Give each task a short `name` (`topics`, `questions`, `import`).

### 2. Write one brief per task
Write each to `.agents/briefs/<name>.md` (gitignored). Follow
`references/brief-template.md`: concrete field lists, the sibling files to mirror for
conventions, the tests to write, and the "only read/write files" rules. The brief IS
the prompt — the user can open it to see exactly what each agent was told.

### 3. Launch all agents in parallel
```
powershell -ExecutionPolicy Bypass -File <skill>/scripts/launch.ps1 -Repo <REPO_ROOT> -Names topics,questions,import -Model haiku
```
`-Model` is optional (default `sonnet`). To mix models, launch **all agents in one call** and
give a model per name: `-Names core,shell,pages:haiku,auth:haiku`. That way one dashboard
shows them all.

**One window:** the agents run as **hidden background processes**. Hidden + redirected
`Start-Process` survives the panel's Ctrl-C. The launch opens **one** console window,
"Noah Ark agents" (`scripts/dashboard.ps1`), that shows every agent as a pane in a grid: 2 side by
side, 3–4 in a 2×2 grid, 5–6 in a 3×2 grid, and stacked when the window is narrower than 100
columns. You can drag it to any display or resize it, and it re-lays out to fit.
- Each pane has a coloured header (name, model, state, files, reads, minutes, and cost at
  the end) that turns green when the agent is done and red when it fails. Under it is a
  readable feed: `+ new` / `~ edit` per file, dimmed `read` / `find` lines, the agent's notes,
  red `!` tool errors, and the final report.
- The footer shows how many have finished. `q` or closing the window closes **only the
  dashboard**; the agents keep running. Reopen it any time:
  `powershell -File <skill>/scripts/dashboard.ps1 -Repo <REPO_ROOT> -Names <same list>`.
- `-NoDashboard` starts the agents without opening the window.
- Files per agent in `.agents/runs/`: `<name>.log` (raw stream-json, what you review),
  `<name>.feed` + `<name>.feed.state` (what the dashboard reads), and `<name>.done`.

Preview the dashboard without spending tokens: add `-Replay`. Each agent replays its existing
`.agents/runs/<name>.log` into `.agents/runs/replay/`. No markers are written and the logs
are left alone.

The call returns at once — do not wait on it in the panel.

### 4. Wait for all of them to finish
Each agent writes `.agents/runs/<name>.done` when it exits. Wait with a background
shell poll (runs across turns; the harness re-invokes you when it exits — don't
busy-poll):
```
cd <REPO_ROOT>; names="topics questions import"; \
for i in $(seq 1 360); do m=0; for n in $names; do [ -f .agents/runs/$n.done ] || m=1; done; \
[ $m -eq 0 ] && { echo ALLDONE; break; }; sleep 5; done; \
for n in $names; do echo "--- $n ---"; cat .agents/runs/$n.done 2>/dev/null; done; git status --short
```

### 5. Review, test, commit
For each agent: read its new files and the diff. Run the project's formatter and the
narrowest tests that cover the change, then the full suite (this repo: per package —
see "Verify before claiming done" in the repo's CLAUDE.md: npm for React/TS, ruff + pytest
for Python, flutter analyze + test for `apps/sos-mobile`). Fix anything that fails. Then make **small, logical commits** (one
concern each), following the repo's CLAUDE.md for message tone and attribution. Ask before
pushing. Never let an agent's output
reach a commit unreviewed or untested.

## Guardrails
- Agents are file-only (`--permission-mode acceptEdits --disallowedTools Bash`): they
  auto-accept their own edits and can't run shell/git/tests. Keep it that way.
- Keep architecture, security-sensitive code, and tricky trade-offs on the
  orchestrator. Sonnet is for well-specified, mechanical implementation.
- The brief and your review are the quality bar — a vague brief produces vague code.
- Everything the workflow writes lives under `.agents/` (gitignored): briefs in
  `.agents/briefs/`, markers and transcripts in `.agents/runs/`.

## Files
- `scripts/launch.ps1` — start N hidden agents in parallel and open the dashboard (`name:model`, `-Replay`, `-NoDashboard`).
- `scripts/run-agent.ps1` — a single hidden agent: writes the raw log, the readable feed and state, and
  the `.done` marker (launched by launch.ps1; not called directly).
- `scripts/dashboard.ps1` — the single "Noah Ark agents" window; safe to close and reopen.
- `scripts/check-cli.ps1` — prerequisite check.
- `references/brief-template.md` — the brief format and how to split tasks for parallelism.
