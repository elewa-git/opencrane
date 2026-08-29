-- Remove SQL workload state that Absurd workflows replaced.
BEGIN;

DROP TRIGGER IF EXISTS "skill_workloads_authority" ON "skill_workloads";
DROP TRIGGER IF EXISTS "skill_workload_bootstraps_authority" ON "skill_workload_bootstraps";
DROP TRIGGER IF EXISTS "cancel_ineligible_skill_workloads_on_revision" ON "skill_revisions";
DROP TRIGGER IF EXISTS "cancel_ineligible_skill_workloads_on_invocation" ON "tool_invocations";
DROP VIEW IF EXISTS "skill_workload_claim_candidates";
DROP VIEW IF EXISTS "skill_workload_release_claim_candidates";
DROP FUNCTION IF EXISTS "select_skill_workload_claim_candidate"();
DROP FUNCTION IF EXISTS "select_skill_workload_release_claim_candidate"();
DROP FUNCTION IF EXISTS "enforce_skill_workload_bootstrap"();
DROP FUNCTION IF EXISTS "enforce_skill_workload_authority"();
DROP FUNCTION IF EXISTS "cancel_ineligible_skill_workloads"();
DELETE FROM "skill_workload_bootstraps";
DELETE FROM "skill_workloads";
DROP TABLE "skill_workload_bootstraps";
DROP TABLE "skill_workloads";
DROP TYPE "SkillWorkloadKind";
DROP TYPE "SkillWorkloadState";

DROP TRIGGER IF EXISTS "run_outbox_events_accepted_attempt" ON "run_outbox_events";
DROP TRIGGER IF EXISTS "run_outbox_events_monotonic" ON "run_outbox_events";
DROP FUNCTION IF EXISTS "enforce_accepted_outbox_attempt"();
DROP FUNCTION IF EXISTS "enforce_run_outbox_event_update"();
DELETE FROM "run_outbox_events";
DROP TABLE "run_outbox_events";
DROP TYPE "RunOutboxEventKind";

CREATE OR REPLACE FUNCTION "enforce_agent_run_authority_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
        OR NEW."agent_revision_id" IS DISTINCT FROM OLD."agent_revision_id"
        OR NEW."conversation_id" IS DISTINCT FROM OLD."conversation_id"
        OR NEW."trigger" IS DISTINCT FROM OLD."trigger"
        OR NEW."delegated_user_id" IS DISTINCT FROM OLD."delegated_user_id"
        OR NEW."request_idempotency_key" IS DISTINCT FROM OLD."request_idempotency_key"
        OR NEW."root_run_id" IS DISTINCT FROM OLD."root_run_id"
        OR NEW."parent_run_id" IS DISTINCT FROM OLD."parent_run_id"
        OR NEW."effective_contract_digest" IS DISTINCT FROM OLD."effective_contract_digest"
        OR NEW."input_snapshot_digest" IS DISTINCT FROM OLD."input_snapshot_digest" THEN
        RAISE EXCEPTION 'AgentRun identity and accepted inputs are immutable';
    END IF;
    IF NEW."attempt" <> OLD."attempt" THEN
        IF NEW."attempt" <> OLD."attempt" + 1 OR OLD."state" NOT IN ('failed', 'cancelled')
            OR NEW."state" <> 'accepted' OR NEW."accepted_at" <= OLD."accepted_at"
            OR NEW."started_at" IS NOT NULL OR NEW."finished_at" IS NOT NULL
            OR NEW."terminal_reason" IS NOT NULL OR NEW."cost_amount" IS NOT NULL
            OR NEW."cost_currency" IS NOT NULL THEN
            RAISE EXCEPTION 'invalid AgentRun attempt transition';
        END IF;
    ELSE
        IF NEW."accepted_at" IS DISTINCT FROM OLD."accepted_at" THEN
            RAISE EXCEPTION 'accepted_at changes only with a new accepted attempt';
        END IF;
        IF OLD."state" IN ('completed', 'failed', 'cancelled') THEN
            RAISE EXCEPTION 'terminal AgentRun attempt coordinates are immutable';
        END IF;
        IF NEW."state" IS DISTINCT FROM OLD."state" AND NOT (
            (OLD."state" = 'accepted' AND NEW."state" IN ('queued', 'failed', 'cancelling')) OR
            (OLD."state" = 'queued' AND NEW."state" IN ('assigned', 'failed', 'cancelling')) OR
            (OLD."state" = 'assigned' AND NEW."state" IN ('running', 'failed', 'cancelling')) OR
            (OLD."state" = 'running' AND NEW."state" IN ('waiting_for_input', 'completed', 'failed', 'cancelling')) OR
            (OLD."state" = 'waiting_for_input' AND NEW."state" IN ('running', 'completed', 'failed', 'cancelling')) OR
            (OLD."state" = 'cancelling' AND NEW."state" = 'cancelled')
        ) THEN
            RAISE EXCEPTION 'invalid AgentRun state transition';
        END IF;
        IF OLD."state" = 'cancelling' AND NEW."state" = 'cancelled' THEN
            PERFORM 1 FROM "workload_assignments" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
            PERFORM 1 FROM "run_proof_keys" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
            PERFORM 1 FROM "agent_run_workflow_tasks" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
            PERFORM 1 FROM "warm_runtime_reservations" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" FOR UPDATE;
            IF EXISTS (
                SELECT 1 FROM "workload_assignments"
                WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt"
                  AND "state" IN ('pending_pod'::"WorkloadAssignmentState", 'registered'::"WorkloadAssignmentState")
            ) THEN
                RAISE EXCEPTION 'a Cancelled AgentRun requires no current PendingPod or Registered WorkloadAssignment';
            END IF;
            IF EXISTS (
                SELECT 1 FROM "run_proof_keys" WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt" AND "revoked_at" IS NULL
            ) THEN
                RAISE EXCEPTION 'a Cancelled AgentRun requires every RunProofKey revoked';
            END IF;
            IF EXISTS (
                SELECT 1 FROM "warm_runtime_reservations"
                WHERE "run_id" = NEW."id" AND "attempt" = NEW."attempt"
                  AND ("state" <> 'deleted'::"WarmRuntimeReservationState" OR "deleted_at" IS NULL)
            ) THEN
                RAISE EXCEPTION 'a Cancelled AgentRun requires every warm runtime reservation deleted';
            END IF;
        END IF;
        IF OLD."started_at" IS NOT NULL AND NEW."started_at" IS DISTINCT FROM OLD."started_at" THEN
            RAISE EXCEPTION 'AgentRun started_at is immutable once recorded';
        END IF;
        IF OLD."started_at" IS NULL AND NEW."started_at" IS NOT NULL AND NEW."state" <> 'running' THEN
            RAISE EXCEPTION 'AgentRun started_at may be recorded only when entering running';
        END IF;
        IF NEW."state" = 'running' AND NEW."started_at" IS NULL THEN
            RAISE EXCEPTION 'a running AgentRun requires started_at';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;
