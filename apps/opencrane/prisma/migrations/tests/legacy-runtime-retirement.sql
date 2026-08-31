-- Recreate the obsolete runtime schema left by an untagged development candidate. The test harness
-- applies the extracted retirement block twice to prove that a repaired database converges without
-- detaching the surviving AgentRun trigger.
BEGIN;

CREATE SCHEMA legacy_runtime_retirement_fixture;
SET LOCAL search_path = legacy_runtime_retirement_fixture, pg_catalog;

CREATE TYPE "AgentRunState" AS ENUM (
    'accepted', 'queued', 'assigned', 'running', 'waiting_for_input',
    'recovery_required', 'cancelling', 'completed', 'failed', 'cancelled'
);
CREATE TYPE "WorkloadAssignmentState" AS ENUM ('pending_pod', 'registered', 'released', 'closed');
CREATE TYPE "WarmRuntimeReservationState" AS ENUM ('reserved', 'deleted');
CREATE TYPE "SkillWorkloadKind" AS ENUM ('authoring');
CREATE TYPE "SkillWorkloadState" AS ENUM ('pending');
CREATE TYPE "RunOutboxEventKind" AS ENUM ('run.attempt_requested');

CREATE TABLE "agent_runs" (
    "id" TEXT PRIMARY KEY,
    "silo_id" TEXT NOT NULL,
    "agent_service_id" TEXT NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "trigger" TEXT NOT NULL,
    "delegated_user_id" TEXT,
    "request_idempotency_key" TEXT NOT NULL,
    "root_run_id" TEXT NOT NULL,
    "parent_run_id" TEXT,
    "effective_contract_digest" TEXT NOT NULL,
    "input_snapshot_digest" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "state" "AgentRunState" NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "terminal_reason" TEXT,
    "cost_amount" DECIMAL(65, 30),
    "cost_currency" TEXT
);
CREATE TABLE "skill_revisions" ("id" TEXT PRIMARY KEY);
CREATE TABLE "tool_invocations" ("id" TEXT PRIMARY KEY);
CREATE TABLE "workload_assignments" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "state" "WorkloadAssignmentState" NOT NULL
);
CREATE TABLE "run_proof_keys" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "revoked_at" TIMESTAMP(3)
);
CREATE TABLE "agent_run_workflow_tasks" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL
);
CREATE TABLE "warm_runtime_reservations" (
    "run_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "state" "WarmRuntimeReservationState" NOT NULL,
    "deleted_at" TIMESTAMP(3)
);

CREATE TABLE "skill_workloads" (
    "id" TEXT PRIMARY KEY,
    "skill_revision_id" TEXT NOT NULL REFERENCES "skill_revisions"("id"),
    "tool_invocation_id" TEXT NOT NULL UNIQUE REFERENCES "tool_invocations"("id"),
    "kind" "SkillWorkloadKind" NOT NULL,
    "state" "SkillWorkloadState" NOT NULL
);
CREATE TABLE "skill_workload_bootstraps" (
    "id" TEXT PRIMARY KEY,
    "skill_workload_id" TEXT NOT NULL UNIQUE REFERENCES "skill_workloads"("id")
);
CREATE TABLE "run_outbox_events" (
    "id" TEXT PRIMARY KEY,
    "run_id" TEXT NOT NULL REFERENCES "agent_runs"("id"),
    "kind" "RunOutboxEventKind" NOT NULL
);

CREATE FUNCTION "select_skill_workload_claim_candidate"() RETURNS SETOF "skill_workloads" LANGUAGE sql AS $$
    SELECT * FROM "skill_workloads";
$$;
CREATE FUNCTION "select_skill_workload_release_claim_candidate"() RETURNS SETOF "skill_workloads" LANGUAGE sql AS $$
    SELECT * FROM "skill_workloads";
$$;
CREATE VIEW "skill_workload_claim_candidates" AS
    SELECT * FROM "select_skill_workload_claim_candidate"();
CREATE VIEW "skill_workload_release_claim_candidates" AS
    SELECT * FROM "select_skill_workload_release_claim_candidate"();

CREATE FUNCTION "enforce_skill_workload_bootstrap"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_skill_workload_authority"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RETURN NEW;
END;
$$;
CREATE FUNCTION "cancel_ineligible_skill_workloads"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_accepted_outbox_attempt"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_run_outbox_event_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RETURN NEW;
END;
$$;
CREATE FUNCTION "enforce_agent_run_authority_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM "run_outbox_events" WHERE "run_id" = NEW."id";
    RETURN NEW;
END;
$$;

CREATE TRIGGER "skill_workload_bootstraps_authority"
    BEFORE INSERT OR UPDATE OR DELETE ON "skill_workload_bootstraps"
    FOR EACH ROW EXECUTE FUNCTION "enforce_skill_workload_bootstrap"();
CREATE TRIGGER "skill_workloads_authority"
    BEFORE INSERT OR UPDATE OR DELETE ON "skill_workloads"
    FOR EACH ROW EXECUTE FUNCTION "enforce_skill_workload_authority"();
CREATE TRIGGER "cancel_ineligible_skill_workloads_on_revision"
    AFTER UPDATE ON "skill_revisions"
    FOR EACH ROW EXECUTE FUNCTION "cancel_ineligible_skill_workloads"();
CREATE TRIGGER "cancel_ineligible_skill_workloads_on_invocation"
    AFTER UPDATE ON "tool_invocations"
    FOR EACH ROW EXECUTE FUNCTION "cancel_ineligible_skill_workloads"();
CREATE TRIGGER "run_outbox_events_accepted_attempt"
    BEFORE INSERT ON "run_outbox_events"
    FOR EACH ROW EXECUTE FUNCTION "enforce_accepted_outbox_attempt"();
CREATE TRIGGER "run_outbox_events_monotonic"
    BEFORE UPDATE ON "run_outbox_events"
    FOR EACH ROW EXECUTE FUNCTION "enforce_run_outbox_event_update"();
CREATE TRIGGER "agent_runs_authority_update"
    BEFORE UPDATE ON "agent_runs"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_run_authority_update"();

INSERT INTO "agent_runs" (
    "id", "silo_id", "agent_service_id", "agent_revision_id", "trigger",
    "request_idempotency_key", "root_run_id", "effective_contract_digest",
    "input_snapshot_digest", "attempt", "state", "accepted_at"
) VALUES (
    'legacy-run', 'legacy-silo', 'legacy-service', 'legacy-revision', 'user',
    'legacy-request', 'legacy-run', 'sha256:legacy-contract',
    'sha256:legacy-input', 1, 'cancelling', CURRENT_TIMESTAMP
);
INSERT INTO "skill_revisions" ("id") VALUES ('legacy-skill-revision');
INSERT INTO "tool_invocations" ("id") VALUES ('legacy-tool-invocation');
INSERT INTO "skill_workloads" (
    "id", "skill_revision_id", "tool_invocation_id", "kind", "state"
) VALUES (
    'legacy-workload', 'legacy-skill-revision', 'legacy-tool-invocation', 'authoring', 'pending'
);
INSERT INTO "skill_workload_bootstraps" ("id", "skill_workload_id")
VALUES ('legacy-bootstrap', 'legacy-workload');
INSERT INTO "run_outbox_events" ("id", "run_id", "kind")
VALUES ('legacy-outbox', 'legacy-run', 'run.attempt_requested');

-- APPLY THE EXACT LEGACY RUNTIME RETIREMENT HERE

-- VERIFY THE LEGACY RUNTIME RETIREMENT HERE

UPDATE "agent_runs" SET "state" = 'cancelled' WHERE "id" = 'legacy-run';

DO $verification$
BEGIN
    IF to_regclass('skill_workload_bootstraps') IS NOT NULL
        OR to_regclass('skill_workloads') IS NOT NULL
        OR to_regclass('run_outbox_events') IS NOT NULL
        OR to_regclass('skill_workload_claim_candidates') IS NOT NULL
        OR to_regclass('skill_workload_release_claim_candidates') IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL: legacy SQL runtime relations survived the central migration';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_proc function_row
        JOIN pg_namespace namespace_row ON namespace_row.oid = function_row.pronamespace
        WHERE namespace_row.nspname = current_schema()
          AND function_row.proname IN (
              'select_skill_workload_claim_candidate',
              'select_skill_workload_release_claim_candidate',
              'enforce_skill_workload_bootstrap',
              'enforce_skill_workload_authority',
              'cancel_ineligible_skill_workloads',
              'enforce_accepted_outbox_attempt',
              'enforce_run_outbox_event_update'
          )
    ) THEN
        RAISE EXCEPTION 'FAIL: legacy SQL runtime functions survived the central migration';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_type type_row
        JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
        WHERE namespace_row.nspname = current_schema()
          AND type_row.typname IN ('SkillWorkloadKind', 'SkillWorkloadState', 'RunOutboxEventKind')
    ) THEN
        RAISE EXCEPTION 'FAIL: legacy SQL runtime enums survived the central migration';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_trigger trigger_row
        WHERE NOT trigger_row.tgisinternal
          AND trigger_row.tgname IN (
              'skill_workload_bootstraps_authority',
              'skill_workloads_authority',
              'cancel_ineligible_skill_workloads_on_revision',
              'cancel_ineligible_skill_workloads_on_invocation',
              'run_outbox_events_accepted_attempt',
              'run_outbox_events_monotonic'
          )
    ) THEN
        RAISE EXCEPTION 'FAIL: legacy SQL runtime triggers survived the central migration';
    END IF;

    IF position('warm_runtime_reservations' IN pg_get_functiondef('enforce_agent_run_authority_update()'::regprocedure)) = 0
        OR position('run_outbox_events' IN pg_get_functiondef('enforce_agent_run_authority_update()'::regprocedure)) > 0 THEN
        RAISE EXCEPTION 'FAIL: AgentRun cancellation still uses the retired run outbox';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'agent_runs'::regclass
          AND tgname = 'agent_runs_authority_update' AND tgenabled = 'O'
    ) THEN
        RAISE EXCEPTION 'FAIL: replacing AgentRun authority detached its surviving trigger';
    END IF;
END;
$verification$;

DO $$
BEGIN
    RAISE NOTICE 'PASS: central migration retires candidate SQL runtime residue and preserves AgentRun authority';
END;
$$;

ROLLBACK;
