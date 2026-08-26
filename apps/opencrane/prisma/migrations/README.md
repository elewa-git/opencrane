# Prisma Migrate ledger

Prisma Migrate is the forward-only list of database changes for the 0.10.0 cutover. A migration is
a saved database change that Prisma records after it succeeds. The dedicated migration Job runs this
list; the OpenCrane server never changes the database when it starts.

`20260821000000_initial` is the reviewed 0.9.3 starting shape for Prisma Migrate. The first 0.10.0
change, `20260825103000_agent_run_workflow_tasks`, adds one saved workflow task and receipt for each
AgentRun attempt. Further 0.10.0 changes add their own timestamped directories. A migration may
contain PostgreSQL-specific SQL for rules Prisma cannot describe.

The older version-to-version SQL directories remain released 0.9.3 history. They are not changed by
this forward cutover and will be removed only after the dedicated Prisma Migrate Job has replaced
their execution path.
