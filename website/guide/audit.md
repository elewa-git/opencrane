# Review activity

OpenCrane records **who requested work, which access decision allowed it and what outcome was
saved**. The goal is to let an authorised reviewer understand an action without reconstructing
it from a temporary computer's logs.

## What is available

The backend exposes an authenticated `/api/v1/audit` surface. Use the
[API reference](/reference/api) for filters and pagination. The current UI does not provide a
complete audit view.

Conversation history and computer lifecycle evidence are also stored. The presence of these
records does not mean every planned tool, approval or shared-agent journey is complete.

## What a useful review should answer

- Who asked for the work?
- Which assistant and company resources were involved?
- Was a person's decision required?
- Did the action complete, fail or remain waiting?
- Where is the resulting conversation or file?

The full product experience for reviewing these answers remains part of
[development status](/guide/status). Technical event identifiers and permission evidence belong
in the [authorisation reference](/integrators/authorization-authority).

> See also: [Access controls](/guide/permissions) · [Tools](/guide/tools) ·
> [Architecture](/advanced/architecture)
