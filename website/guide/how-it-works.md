# How OpenCrane works

Every time an agent does something in OpenCrane — answers you, drafts a document, calls a tool —
that work happens as a **run**: a tracked, disposable unit of execution that OpenCrane admits,
watches and records from start to finish. This page is a short tour of what that means in
practice, for both kinds of agent.

## Personal and managed runs, side by side

| | Your personal assistant | A managed agent |
|---|---|---|
| Who it acts as | You | Its own service identity |
| What it can see | Only what's been granted to *you* | Only what its published revision was configured with |
| How it starts | You talking to it | A schedule, a trigger, or another authorised caller |
| Persona | Built through your [interview](/guide/persona) | None — its published configuration *is* its complete instruction set |
| Typical use | Drafting, research, day-to-day work for one person | Triaging tickets, nightly reports, org-wide or team-wide jobs |

Both kinds go through the same admission and execution machinery below — that's what makes every
run auditable the same way, no matter who or what started it.

## What happens when work starts

```text
you, or a schedule/trigger
       │
       ▼
OpenCrane checks who's asking and what they're allowed to do
       │
       ▼
OpenCrane freezes exactly what this run may use — before anything executes
       │
       ▼
a fresh, disposable Kubernetes Job carries out the work
       │
       ▼
you see the ordered events, any actions taken, and the final outcome
```

1. OpenCrane authenticates the caller and resolves the organisation.
2. It checks membership, grants, model access and budget.
3. It **freezes** the accepted inputs — which tools, skills, knowledge and model this exact run may
   use — before any container starts. Nothing can widen its own access mid-run.
4. A fresh, bounded Job carries out the work and streams results back.
5. Every tool call OpenCrane executes on the agent's behalf is recorded, and any that needs a human
   decision pauses for [approval](/guide/audit).
6. The run reaches a final outcome. The Job that executed it can disappear — the durable record of
   what ran, what it used and what happened does not.

::: tip Why "disposable execution, durable record" matters
The container is a detail; it can crash, get rescheduled, or simply finish and vanish. What you
audit, retry or investigate later is the run record — never a Pod name.
:::

## The words you'll see

### Agent (personal or managed)

The thing that does the work. A personal assistant is yours alone; a managed agent is a shared,
narrowly scoped worker your organisation configures. See
[the distinction](/guide/introduction#two-kinds-of-agent-and-why-the-difference-matters).

### Run

One tracked execution of an agent — a single conversation turn, a scheduled job, a triggered task.
A run keeps its state, how many attempts it's had, exactly what it was allowed to use, and how it
ended. Retrying creates another attempt on the same run rather than a disconnected new one.

### Skill

A reusable ability you give an agent — drafting a follow-up, reviewing a document, summarising a
ticket — published as a versioned, reviewed artifact rather than a loose snippet.
→ [Manage skills](/guide/skills)

### Tool

An action an agent can ask OpenCrane to take in another system. The agent proposes it; OpenCrane
authorises, executes and records it. → [Manage tools](/guide/tools)

### Organisational knowledge

Facts and documents an agent can recall — personal notes for your assistant, shared knowledge for
a managed agent — always filtered through who's allowed to see what.
→ [Connect knowledge](/guide/knowledge)

### Organisation (silo)

Your company's isolated slice of OpenCrane. Every agent, run, grant and piece of knowledge lives
inside your organisation's boundary and never crosses into another customer's.
→ [Organisation boundary](/operators/organisation-boundary)

Ready? → [Install OpenCrane](/guide/getting-started)
