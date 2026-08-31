# Control who can access what

Every agent — personal or managed — starts with **nothing**: no skills, no tools, no knowledge,
no model. A personal assistant acts through its person's Principal, limited by the approved agent
revision and run. A managed agent acts through its own `AgentService` Principal. Permission to use
or administer that managed agent is separate from the permissions the agent needs for its work.

## Grant a capability

Choose a subject—one principal or one group—and a resource boundary. A boundary is either one
stored group or one principal's personal space. A group boundary can cover that exact group or
its descendants. The acting Principal and its approved agent/run limits must remain inside the
resulting effective access boundary.

Department, team and project names are ordinary groups. Their meaning comes from stored parent
relationships, not from fixed grant categories.

## What a run freezes

At admission OpenCrane records:

- the accepted membership revision;
- acting-Principal and inherited Group grant evidence;
- resolved tool and skill revisions;
- model and memory policy; and
- the capability-set digest.

The runtime receives compiled inputs. It cannot re-evaluate grants or add a capability. The frozen
inputs are a ceiling, so OpenCrane rechecks current membership, grants, cancellation, and resource
eligibility before the next external effect.

## Change access

Revocation affects new decisions and pending external actions. It does not erase the audit
record or mutate an immutable snapshot belonging to an accepted run.

::: warning
Do not infer access from a Kubernetes namespace, group name or network path. Membership and
grant authority must resolve successfully; uncertainty denies the request.
:::

→ [Organise groups](/guide/organize) · [Silo IAM](/integrators/silo-iam) ·
[Central authorization authority](/integrators/authorization-authority)
