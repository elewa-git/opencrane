-- Every queued/runtime attempt needs one immutable non-null authorization subject.
-- This is a clean target-state schema: no legacy data is migrated or inferred.
ALTER TABLE "agent_runs" ADD COLUMN "execution_subject_id" TEXT NOT NULL;

ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_execution_subject_check"
  CHECK (btrim("execution_subject_id") <> '');
