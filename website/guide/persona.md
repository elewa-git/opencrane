# Set up your personal assistant

Your **personal assistant** is the one agent in OpenCrane that belongs to you alone — it only
ever sees the context, tools and files you've been granted, and only ever acts as you. Before it
can have its first conversation with you, it needs to know who it's working for. OpenCrane builds
that through a short interview, and nothing it produces goes live until you've reviewed and
approved it.

::: tip Personal vs managed, in one line
A **personal assistant** is your assistant — it learns your persona and only acts within your own
access. A **managed agent** is a shared worker your organisation configures to do bounded work on
a schedule or trigger, under its own narrow identity. Managed agents never go through this
interview — see [Create a managed agent](/guide/first-agent).
:::

## What onboarding gives you

- **A short, guided interview** instead of a blank prompt box. A reviewed set of questions asks
  about how you work and how you'd like your assistant to behave.
- **A draft persona you can inspect before it does anything.** OpenCrane turns your answers into
  three to five explicit insights and picks a base personality template — never a black box.
- **A hard approval gate.** Your assistant cannot start its first real conversation until you've
  looked at the draft and approved it. There's no "it started acting weird, who approved that?" —
  you did, explicitly, or it didn't happen.
- **A record of why, not just what.** Every insight in your persona traces back to the exact
  interview answer that produced it, so the persona is never just a guess about you.

## Walk through the interview

1. **Start the interview.** Sign in and start (or resume) your onboarding interview. If you've
   started one already, OpenCrane resumes it — your answers are kept from your first attempt, so
   retrying a submission never discards what you've already told it.
2. **Answer each question once.** Every answer is tied to the exact question you answered, so
   there's a clear trail from "you said X" to "the persona does Y."
3. **Complete it.** OpenCrane accepts completion only once every question in the interview has an
   answer.
4. **Review the draft.** From your completed interview, OpenCrane derives a small set of insights
   (three to five) and selects a base personality template — the same underlying idea as a
   `SOUL.md` file, but reviewed and versioned rather than a file you edit by hand. Nothing here is
   invented outside your answers.
5. **Approve it.** Approving activates that exact draft as your one active persona. Until you do,
   your personal assistant has no persona to run with and cannot take its first run.
6. **Start chatting.** OpenCrane creates the personal assistant's first runnable revision from the
   approved persona. That revision includes the default per-run limits for model turns, total tokens
   and elapsed time. These are technical safety brakes for one agent run, not a monthly spending
   allowance — see [Manage run limits and cost](/guide/budgets#default-limits-for-a-personal-assistant).

::: info What "approve" actually locks in
Approval checks that the interview is genuinely complete, that there are between three and five
insights, and that the selected template still matches what your answers produced. If anything
has drifted — a stale draft, a mismatched template — OpenCrane refuses the approval rather than
activating something that no longer matches what you reviewed.
:::

## Updating your persona later

Life and working habits change, so a persona isn't locked in forever. Requesting a refresh starts
a **new** interview rather than editing the old one in place — your previous interview stays on
record as evidence of what you approved and when. Approving the new draft atomically swaps it in
as your one active persona; if that swap fails partway through, your previous persona keeps
running rather than being left half-updated.

::: warning No editable persona file
OpenCrane deliberately has no mutable "edit your SOUL file and restart" path. A persona becomes
active only by going through interview → draft → your explicit approval. This is what keeps
"why does my assistant think that about me" always answerable.
:::

## Why managed agents skip this

A managed agent's published revision — its prompt, model, skills and integrations — is its
complete instruction set from the moment it's published. There is no personal context to onboard,
because a managed agent isn't supposed to have one: it does bounded, named work for a team or
project, not a relationship with one person. See
[Create a managed agent](/guide/first-agent) and
[Organize your company](/guide/organize) for how that scope is decided instead.

> See also: [How OpenCrane works](/guide/how-it-works) (the run lifecycle your assistant uses once
> approved) · [Organizational knowledge](/guide/knowledge) (what your assistant can recall) ·
> [Agent delegation (child runs)](/guide/child-runs) (when your assistant hands work to a
> specialist or a managed agent)
