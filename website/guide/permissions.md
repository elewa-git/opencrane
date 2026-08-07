# Control who can access what

Every agent — personal or managed — starts with **nothing**: no skills, no tools, no knowledge,
no model. Before OpenCrane admits any run, it checks that the person and, separately, the agent
itself both currently have the access being used. Granting access to a person doesn't
automatically hand it to their assistant, and configuring an agent with a capability doesn't
automatically extend it to everyone who can talk to that agent — both sides have to line up.

## Grant a capability

Grant a skill, tool, model or dataset at the narrowest useful scope: personal, project,
department or organisation. Both the acting subject and the agent service must remain inside
the resulting effective access boundary.

## What a run freezes

At admission OpenCrane records:

- the accepted membership revision;
- subject and agent-service grant evidence;
- resolved tool and skill revisions;
- model and memory policy; and
- the capability-set digest.

The runtime receives compiled inputs. It cannot re-evaluate grants or add a capability.

## Change access

Revocation affects new decisions and pending external actions. It does not erase the audit
record or mutate an immutable snapshot belonging to an accepted run.

::: warning
Do not infer access from a Kubernetes namespace, group label or network path. Membership and
grant authority must resolve successfully; uncertainty denies the request.
:::

→ [Organise scopes](/guide/organize) · [Silo IAM](/integrators/silo-iam)
