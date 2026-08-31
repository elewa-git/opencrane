-- Repair only the exact untagged development candidate without rewriting its preserved ledgers.
-- The migrator passes the current silo and the digest of this reviewed repair.
\set ON_ERROR_STOP on

\if :{?repair_sql_sha256}
\else
\echo 'repair_sql_sha256 is required'
\quit
\endif
\if :{?migration_silo_id}
\else
\echo 'migration_silo_id is required'
\quit
\endif

SELECT pg_advisory_lock(hashtextextended('opencrane:database-schema-migration', 0));
SELECT to_regclass('opencrane_migrations.schema_history') IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM "opencrane_migrations"."schema_history"
       WHERE "migration_id" = '0.9.0-to-0.9.3'
   ) AS untagged_candidate_present \gset

\if :untagged_candidate_present
SELECT to_regclass('opencrane_migrations.forward_repairs') IS NOT NULL AS repair_table_present \gset
\if :repair_table_present
SELECT EXISTS (
    SELECT 1 FROM "opencrane_migrations"."forward_repairs"
    WHERE "repair_id" = 'untagged-0.9.3-candidate-to-0.10.0'
      AND "repair_sql_sha256" = :'repair_sql_sha256'
      AND "silo_id" = :'migration_silo_id'
) AS repair_already_applied \gset
\else
SELECT FALSE AS repair_already_applied \gset
\endif

\if :repair_already_applied
\echo 'The exact untagged-candidate forward repair is already applied.'
\else
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('opencrane:database-schema-migration:untagged-0.9.3-candidate-forward-repair', 0));
SELECT set_config('opencrane.migration_silo_id', :'migration_silo_id', true);

DO $repair_validation$
BEGIN
    IF btrim(current_setting('opencrane.migration_silo_id')) = '' THEN
        RAISE EXCEPTION 'migration_silo_id must be non-empty' USING ERRCODE = 'OC900';
    END IF;
    IF (SELECT count(*) FROM "opencrane_migrations"."schema_history"
        WHERE "migration_id" = '0.9.0-to-0.9.3'
          AND "schema_version" = '0.9.3'
          AND "source_schema_version" = '0.9.0'
          AND "source_baseline_sha256" = '12505f3c15114bd2a407d0d4d2ef2befc3c8ec87acaa9787503cfbe4eba0032c'
          AND "target_baseline_sha256" = 'abacee3698553f110f70a630da5115e3ad6d54ddc98a7416f75d12a1560b7420'
          AND "sql_sha256" = 'eb429e29c15495608c5e3d50c6d7904ea6e015ea5fc6eff631a310bc6f2ae5fa') <> 1 THEN
        RAISE EXCEPTION 'untagged candidate schema history does not match the reviewed repair source' USING ERRCODE = 'OC714';
    END IF;
    IF (SELECT count(*) FROM "_prisma_migrations"
        WHERE "migration_name" = '20260826000000_0_9_3_baseline'
          AND "checksum" = 'd7229f9995c5c881dd1b4da3dae6d972cb6827e00fca4b7d21fb1c8a48b13f84'
          AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) <> 1 THEN
        RAISE EXCEPTION 'untagged candidate Prisma baseline does not match the reviewed repair source' USING ERRCODE = 'OC714';
    END IF;
    IF (SELECT count(*) FROM "_prisma_migrations"
        WHERE "migration_name" = '20260827000000_0_10_0_workflow_cutover'
          AND "checksum" = '6a4256041ba5a78c6e849531c4d9fffea2cad5afef509344c088e566bcfa0004'
          AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL) <> 1
       OR (SELECT count(*) FROM "_prisma_migrations"
           WHERE "migration_name" = '20260827000000_0_10_0_workflow_cutover'
             AND "checksum" IN ('b6e4a08f5a90e400b92720854c8409ec8f30c22599a545beb78148d008cbbb68', '074c405e962f868c807ebf99bda2aa8800910bbe957f89c963c1768d357f96bc')
             AND "finished_at" IS NULL AND "rolled_back_at" IS NOT NULL) <> 2
       OR (SELECT count(*) FROM "_prisma_migrations"
           WHERE "migration_name" = '20260827000000_0_10_0_workflow_cutover') <> 3 THEN
        RAISE EXCEPTION 'untagged candidate workflow ledger does not match the reviewed repair source' USING ERRCODE = 'OC714';
    END IF;
    IF to_regclass('mcp_runtime_clock') IS NOT NULL
       OR to_regprocedure('select_mcp_runtime_claim_candidate()') IS NOT NULL
       OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mcp_runtime_executions_authority' AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'untagged candidate already contains an unrecorded MCP database-authority repair' USING ERRCODE = 'OC714';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "audit_log" entry
        WHERE NOT (
            (entry."action" = 'organization.invitations.created'
             AND entry."resource" = current_setting('opencrane.migration_silo_id'))
            OR
            (entry."action" IN ('organization.invitation.resent', 'organization.invitation.accepted')
             AND EXISTS (
                 SELECT 1 FROM "organization_invitations" invitation
                 WHERE invitation."id" = entry."resource"
                   AND invitation."silo_id" = current_setting('opencrane.migration_silo_id')
             ))
        )
    ) THEN
        RAISE EXCEPTION 'legacy audit rows cannot all be attributed to the admitted migration silo' USING ERRCODE = 'OC713';
    END IF;
END;
$repair_validation$;

ALTER TABLE "audit_log" ADD COLUMN "silo_id" TEXT;
UPDATE "audit_log" SET "silo_id" = current_setting('opencrane.migration_silo_id');
ALTER TABLE "audit_log" ALTER COLUMN "silo_id" SET NOT NULL;

-- Install the database clock and locked selectors consumed through Prisma views by the MCP controller.
CREATE VIEW "mcp_runtime_clock" AS
    SELECT 1::INTEGER AS "singleton", date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3) AS "now";

CREATE FUNCTION "select_mcp_runtime_claim_candidate"() RETURNS TABLE (
    "id" TEXT,
    "silo_id" TEXT,
    "profile_name" TEXT
) LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    RETURN QUERY
    SELECT execution."id", execution."silo_id", execution."profile_name"
      FROM "mcp_runtime_executions" execution
     WHERE execution."workload_state" = 'pending'
       AND (execution."claim_expires_at" IS NULL OR execution."claim_expires_at" <= clock_timestamp())
     ORDER BY execution."created_at", execution."id"
     FOR UPDATE OF execution SKIP LOCKED
     LIMIT 1;
END;
$$;
CREATE VIEW "mcp_runtime_claim_candidates" AS SELECT * FROM "select_mcp_runtime_claim_candidate"();

CREATE FUNCTION "select_mcp_runtime_release_claim_candidate"() RETURNS TABLE (
    "id" TEXT,
    "silo_id" TEXT,
    "profile_name" TEXT
) LANGUAGE plpgsql VOLATILE AS $$
BEGIN
    RETURN QUERY
    SELECT execution."id", execution."silo_id", execution."profile_name"
      FROM "mcp_runtime_executions" execution
     WHERE execution."workload_state" IN ('assigned', 'released')
       AND execution."workload_uid" IS NOT NULL
       AND execution."pod_uid" IS NULL
       AND (execution."release_expires_at" IS NULL OR execution."release_expires_at" <= clock_timestamp())
     ORDER BY execution."created_at", execution."id"
     FOR UPDATE OF execution SKIP LOCKED
     LIMIT 1;
END;
$$;
CREATE VIEW "mcp_runtime_release_claim_candidates" AS SELECT * FROM "select_mcp_runtime_release_claim_candidate"();

ALTER TABLE "mcp_runtime_executions" ADD CONSTRAINT "mcp_runtime_executions_identity_check" CHECK (
    btrim("id") <> '' AND btrim("silo_id") <> '' AND btrim("server_revision_id") <> ''
    AND btrim("idempotency_key") <> '' AND btrim("execution_reference") <> '' AND btrim("profile_name") <> ''
    AND "delivery_count" >= 0 AND "release_delivery_count" >= 0 AND "cleanup_delivery_count" >= 0
    AND (("claimed_at" IS NULL) = ("claim_expires_at" IS NULL))
    AND (("release_claimed_at" IS NULL) = ("release_expires_at" IS NULL))
    AND (("companion_claim_fence" IS NULL) = ("companion_claim_expires_at" IS NULL))
    AND (("tool_invocation_claim_fence" IS NULL) = ("tool_invocation_claim_revision" IS NULL))
    AND (("kind" = 'discovery' AND "tool_invocation_id" IS NULL AND "tool_invocation_claim_fence" IS NULL)
         OR ("kind" = 'invocation' AND "tool_invocation_id" IS NOT NULL))
    AND ("terminal_outcome" IS NULL OR btrim("terminal_outcome") <> '')
    AND ("terminal_payload_digest" IS NULL OR "terminal_payload_digest" ~ '^sha256:[0-9a-f]{64}$')
);

CREATE FUNCTION "enforce_mcp_runtime_execution_authority"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    transition_time TIMESTAMP(3) := date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3);
    requested_lease INTERVAL;
    terminal_workload "McpExecutorWorkloadState";
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'McpRuntimeExecution rows cannot be deleted';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."workload_state" <> 'pending' OR NEW."command_state" <> 'pending'
            OR NEW."claimed_at" IS NOT NULL OR NEW."claim_expires_at" IS NOT NULL OR NEW."delivery_count" <> 0
            OR NEW."workload_uid" IS NOT NULL OR NEW."assigned_at" IS NOT NULL
            OR NEW."release_claimed_at" IS NOT NULL OR NEW."release_expires_at" IS NOT NULL OR NEW."release_delivery_count" <> 0 OR NEW."released_at" IS NOT NULL
            OR NEW."pod_uid" IS NOT NULL OR NEW."companion_claim_fence" IS NOT NULL OR NEW."companion_claim_expires_at" IS NOT NULL
            OR NEW."tool_invocation_claim_fence" IS NOT NULL OR NEW."tool_invocation_claim_revision" IS NOT NULL
            OR NEW."terminal_outcome" IS NOT NULL OR NEW."terminal_payload_digest" IS NOT NULL OR NEW."completed_at" IS NOT NULL
            OR NEW."cleanup_claimed_at" IS NOT NULL OR NEW."cleanup_expires_at" IS NOT NULL OR NEW."cleanup_delivery_count" <> 0 OR NEW."cleanup_completed_at" IS NOT NULL THEN
            RAISE EXCEPTION 'McpRuntimeExecution must begin pending without delivery, assignment, command, terminal, or cleanup evidence';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."server_revision_id" IS DISTINCT FROM OLD."server_revision_id" OR NEW."tool_invocation_id" IS DISTINCT FROM OLD."tool_invocation_id"
        OR NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
        OR NEW."execution_reference" IS DISTINCT FROM OLD."execution_reference" OR NEW."profile_name" IS DISTINCT FROM OLD."profile_name"
        OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'McpRuntimeExecution source identity is immutable';
    END IF;

    IF OLD."workload_uid" IS NOT NULL AND NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid" THEN
        RAISE EXCEPTION 'McpRuntimeExecution workload identity is immutable';
    END IF;
    IF OLD."assigned_at" IS NOT NULL AND NEW."assigned_at" IS DISTINCT FROM OLD."assigned_at" THEN
        RAISE EXCEPTION 'McpRuntimeExecution assignment time is immutable';
    END IF;
    IF OLD."pod_uid" IS NOT NULL AND NEW."pod_uid" IS DISTINCT FROM OLD."pod_uid" THEN
        RAISE EXCEPTION 'McpRuntimeExecution Pod identity is immutable';
    END IF;

    IF NEW."delivery_count" IS DISTINCT FROM OLD."delivery_count" OR NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" OR NEW."claim_expires_at" IS DISTINCT FROM OLD."claim_expires_at" THEN
        requested_lease := NEW."claim_expires_at" - NEW."claimed_at";
        IF OLD."workload_state" <> 'pending' OR NEW."workload_state" <> 'pending'
            OR NEW."delivery_count" <> OLD."delivery_count" + 1
            OR NEW."claimed_at" IS DISTINCT FROM TIMESTAMP '1970-01-01 00:00:00'
            OR requested_lease < interval '1 second' OR requested_lease > interval '5 minutes'
            OR (OLD."claim_expires_at" IS NOT NULL AND OLD."claim_expires_at" > transition_time) THEN
            RAISE EXCEPTION 'McpRuntimeExecution controller claim requires an expired prior fence and a bounded lease proposal';
        END IF;
        NEW."claimed_at" := CASE WHEN OLD."claimed_at" IS NULL THEN transition_time ELSE GREATEST(transition_time, OLD."claimed_at" + interval '1 millisecond') END;
        NEW."claim_expires_at" := NEW."claimed_at" + requested_lease;
    END IF;

    IF NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid" OR NEW."assigned_at" IS DISTINCT FROM OLD."assigned_at" THEN
        terminal_workload := CASE WHEN OLD."command_state" IN ('succeeded', 'failed', 'recovery_required') THEN 'closed' ELSE 'assigned' END;
        IF OLD."workload_state" <> 'pending' OR NEW."workload_state" IS DISTINCT FROM terminal_workload
            OR OLD."workload_uid" IS NOT NULL OR NEW."workload_uid" IS NULL OR btrim(NEW."workload_uid") = '' OR NEW."assigned_at" IS NULL
            OR OLD."claimed_at" IS NULL OR OLD."claim_expires_at" IS NULL OR transition_time >= OLD."claim_expires_at"
            OR NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" OR NEW."claim_expires_at" IS DISTINCT FROM OLD."claim_expires_at" OR NEW."delivery_count" IS DISTINCT FROM OLD."delivery_count" THEN
            RAISE EXCEPTION 'McpRuntimeExecution assignment requires the exact current controller claim';
        END IF;
        NEW."assigned_at" := transition_time;
    END IF;

    IF NEW."release_delivery_count" IS DISTINCT FROM OLD."release_delivery_count" OR NEW."release_claimed_at" IS DISTINCT FROM OLD."release_claimed_at" OR NEW."release_expires_at" IS DISTINCT FROM OLD."release_expires_at" THEN
        requested_lease := NEW."release_expires_at" - NEW."release_claimed_at";
        IF OLD."workload_state" NOT IN ('assigned', 'released') OR NEW."workload_state" IS DISTINCT FROM OLD."workload_state"
            OR OLD."workload_uid" IS NULL OR NEW."workload_uid" IS DISTINCT FROM OLD."workload_uid" OR OLD."pod_uid" IS NOT NULL OR NEW."pod_uid" IS NOT NULL
            OR NEW."release_delivery_count" <> OLD."release_delivery_count" + 1
            OR NEW."release_claimed_at" IS DISTINCT FROM TIMESTAMP '1970-01-01 00:00:00'
            OR requested_lease < interval '1 second' OR requested_lease > interval '5 minutes'
            OR (OLD."release_expires_at" IS NOT NULL AND OLD."release_expires_at" > transition_time) THEN
            RAISE EXCEPTION 'McpRuntimeExecution release claim requires an expired prior fence and a bounded lease proposal';
        END IF;
        NEW."release_claimed_at" := CASE WHEN OLD."release_claimed_at" IS NULL THEN transition_time ELSE GREATEST(transition_time, OLD."release_claimed_at" + interval '1 millisecond') END;
        NEW."release_expires_at" := NEW."release_claimed_at" + requested_lease;
    END IF;

    IF NEW."released_at" IS DISTINCT FROM OLD."released_at" THEN
        IF OLD."workload_state" <> 'assigned' OR NEW."workload_state" <> 'released' OR OLD."released_at" IS NOT NULL OR NEW."released_at" IS NULL
            OR OLD."release_claimed_at" IS NULL OR OLD."release_expires_at" IS NULL OR transition_time >= OLD."release_expires_at"
            OR NEW."release_claimed_at" IS DISTINCT FROM OLD."release_claimed_at" OR NEW."release_expires_at" IS DISTINCT FROM OLD."release_expires_at" OR NEW."release_delivery_count" IS DISTINCT FROM OLD."release_delivery_count" THEN
            RAISE EXCEPTION 'McpRuntimeExecution release requires the exact current release claim';
        END IF;
        NEW."released_at" := transition_time;
    END IF;

    IF NEW."pod_uid" IS DISTINCT FROM OLD."pod_uid" THEN
        IF OLD."workload_state" <> 'released' OR NEW."workload_state" <> 'registered' OR OLD."pod_uid" IS NOT NULL OR NEW."pod_uid" IS NULL OR btrim(NEW."pod_uid") = ''
            OR OLD."released_at" IS NULL OR OLD."release_expires_at" IS NULL OR transition_time >= OLD."release_expires_at"
            OR NEW."release_claimed_at" IS DISTINCT FROM OLD."release_claimed_at" OR NEW."release_expires_at" IS DISTINCT FROM OLD."release_expires_at" OR NEW."release_delivery_count" IS DISTINCT FROM OLD."release_delivery_count" THEN
            RAISE EXCEPTION 'McpRuntimeExecution Pod registration requires the exact current release fence';
        END IF;
    END IF;

    IF NEW."companion_claim_fence" IS DISTINCT FROM OLD."companion_claim_fence"
        OR NEW."companion_claim_expires_at" IS DISTINCT FROM OLD."companion_claim_expires_at"
        OR NEW."tool_invocation_claim_fence" IS DISTINCT FROM OLD."tool_invocation_claim_fence"
        OR NEW."tool_invocation_claim_revision" IS DISTINCT FROM OLD."tool_invocation_claim_revision" THEN
        IF OLD."command_state" = 'pending' AND NEW."command_state" = 'claimed' THEN
            requested_lease := NEW."companion_claim_expires_at" - TIMESTAMP '1970-01-01 00:00:00';
            IF OLD."workload_state" <> 'registered' OR NEW."workload_state" <> 'registered' OR OLD."pod_uid" IS NULL OR NEW."pod_uid" IS DISTINCT FROM OLD."pod_uid"
                OR OLD."companion_claim_fence" IS NOT NULL OR NEW."companion_claim_fence" IS NULL OR btrim(NEW."companion_claim_fence") = ''
                OR requested_lease < interval '1 second' OR requested_lease > interval '5 minutes'
                OR (NEW."kind" = 'discovery' AND (NEW."tool_invocation_claim_fence" IS NOT NULL OR NEW."tool_invocation_claim_revision" IS NOT NULL))
                OR (NEW."kind" = 'invocation' AND (NEW."tool_invocation_claim_fence" IS NULL OR NEW."tool_invocation_claim_fence" < 1 OR NEW."tool_invocation_claim_revision" IS NULL OR NEW."tool_invocation_claim_revision" < 1)) THEN
                RAISE EXCEPTION 'McpRuntimeExecution companion claim requires its registered Pod and bounded lease proposal';
            END IF;
            NEW."companion_claim_expires_at" := transition_time + requested_lease;
        ELSIF OLD."kind" = 'discovery' AND OLD."command_state" = 'claimed' AND NEW."command_state" = 'pending'
            AND OLD."workload_state" = 'registered' AND NEW."workload_state" = 'registered'
            AND OLD."companion_claim_expires_at" IS NOT NULL AND OLD."companion_claim_expires_at" <= transition_time
            AND NEW."companion_claim_fence" IS NULL AND NEW."companion_claim_expires_at" IS NULL
            AND OLD."tool_invocation_claim_fence" IS NULL AND NEW."tool_invocation_claim_fence" IS NULL
            AND OLD."tool_invocation_claim_revision" IS NULL AND NEW."tool_invocation_claim_revision" IS NULL THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'McpRuntimeExecution companion fence is immutable outside claim or expired discovery reset';
        END IF;
    END IF;

    IF NEW."terminal_outcome" IS DISTINCT FROM OLD."terminal_outcome" OR NEW."terminal_payload_digest" IS DISTINCT FROM OLD."terminal_payload_digest" OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at" THEN
        IF OLD."command_state" NOT IN ('pending', 'claimed') OR NEW."command_state" NOT IN ('succeeded', 'failed', 'recovery_required')
            OR NEW."terminal_outcome" IS NULL OR btrim(NEW."terminal_outcome") = '' OR NEW."completed_at" IS NULL THEN
            RAISE EXCEPTION 'McpRuntimeExecution terminal evidence requires one pending or claimed command transition';
        END IF;
        terminal_workload := CASE
            WHEN OLD."workload_state" = 'pending' AND OLD."delivery_count" > 0 THEN 'pending'
            WHEN OLD."workload_state" IN ('pending', 'assigned', 'released', 'registered') THEN 'closed'
            ELSE NULL
        END;
        IF NEW."workload_state" IS DISTINCT FROM terminal_workload THEN
            RAISE EXCEPTION 'McpRuntimeExecution terminal command must preserve or close its exact workload';
        END IF;
        NEW."completed_at" := transition_time;
    END IF;

    IF NEW."cleanup_delivery_count" IS DISTINCT FROM OLD."cleanup_delivery_count" OR NEW."cleanup_claimed_at" IS DISTINCT FROM OLD."cleanup_claimed_at" OR NEW."cleanup_expires_at" IS DISTINCT FROM OLD."cleanup_expires_at" OR NEW."cleanup_completed_at" IS DISTINCT FROM OLD."cleanup_completed_at" THEN
        IF OLD."workload_state" <> 'closed' OR NEW."workload_state" <> 'closed' OR OLD."command_state" NOT IN ('succeeded', 'failed', 'recovery_required') OR NEW."command_state" IS DISTINCT FROM OLD."command_state" OR OLD."workload_uid" IS NULL THEN
            RAISE EXCEPTION 'McpRuntimeExecution cleanup requires a terminal workload with an exact Job identity';
        END IF;
        IF NEW."cleanup_delivery_count" = OLD."cleanup_delivery_count" + 1 AND NEW."cleanup_completed_at" IS NOT DISTINCT FROM OLD."cleanup_completed_at" THEN
            requested_lease := NEW."cleanup_expires_at" - NEW."cleanup_claimed_at";
            IF OLD."cleanup_completed_at" IS NOT NULL OR NEW."cleanup_claimed_at" IS NULL OR NEW."cleanup_expires_at" IS NULL
                OR requested_lease < interval '1 second' OR requested_lease > interval '5 minutes'
                OR (OLD."cleanup_expires_at" IS NOT NULL AND OLD."cleanup_expires_at" > transition_time) THEN
                RAISE EXCEPTION 'McpRuntimeExecution cleanup claim requires an expired prior fence and bounded lease';
            END IF;
            NEW."cleanup_claimed_at" := CASE WHEN OLD."cleanup_claimed_at" IS NULL THEN transition_time ELSE GREATEST(transition_time, OLD."cleanup_claimed_at" + interval '1 millisecond') END;
            NEW."cleanup_expires_at" := NEW."cleanup_claimed_at" + requested_lease;
        ELSIF NEW."cleanup_delivery_count" = OLD."cleanup_delivery_count" AND OLD."cleanup_completed_at" IS NULL AND NEW."cleanup_completed_at" IS NOT NULL
            AND NEW."cleanup_claimed_at" IS NOT DISTINCT FROM OLD."cleanup_claimed_at" AND NEW."cleanup_expires_at" IS NOT DISTINCT FROM OLD."cleanup_expires_at"
            AND OLD."cleanup_expires_at" IS NOT NULL AND transition_time < OLD."cleanup_expires_at" THEN
            NEW."cleanup_completed_at" := transition_time;
        ELSE
            RAISE EXCEPTION 'McpRuntimeExecution cleanup fence may only advance or complete once';
        END IF;
    END IF;

    IF NEW."workload_state" IS DISTINCT FROM OLD."workload_state" THEN
        IF NOT ((OLD."workload_state" = 'pending' AND NEW."workload_state" IN ('assigned', 'closed') AND NEW."workload_uid" IS NOT NULL)
            OR (OLD."workload_state" = 'pending' AND NEW."workload_state" = 'closed' AND NEW."command_state" IN ('succeeded', 'failed', 'recovery_required'))
            OR (OLD."workload_state" = 'assigned' AND NEW."workload_state" = 'released')
            OR (OLD."workload_state" = 'released' AND NEW."workload_state" = 'registered')
            OR (OLD."workload_state" IN ('assigned', 'released', 'registered') AND NEW."workload_state" = 'closed' AND NEW."command_state" IN ('succeeded', 'failed', 'recovery_required'))) THEN
            RAISE EXCEPTION 'invalid McpRuntimeExecution workload transition';
        END IF;
    END IF;

    IF NEW."command_state" IS DISTINCT FROM OLD."command_state" THEN
        IF NOT ((OLD."command_state" = 'pending' AND NEW."command_state" = 'claimed')
            OR (OLD."command_state" = 'claimed' AND NEW."command_state" = 'pending' AND OLD."kind" = 'discovery')
            OR (OLD."command_state" IN ('pending', 'claimed') AND NEW."command_state" IN ('succeeded', 'failed', 'recovery_required'))) THEN
            RAISE EXCEPTION 'invalid McpRuntimeExecution command transition';
        END IF;
    END IF;

    IF OLD."command_state" IN ('succeeded', 'failed', 'recovery_required')
        AND (NEW."command_state" IS DISTINCT FROM OLD."command_state"
            OR ((NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" OR NEW."claim_expires_at" IS DISTINCT FROM OLD."claim_expires_at" OR NEW."delivery_count" IS DISTINCT FROM OLD."delivery_count")
                AND NOT (OLD."workload_state" = 'pending' AND NEW."workload_state" = 'pending' AND NEW."delivery_count" = OLD."delivery_count" + 1))
            OR NEW."release_claimed_at" IS DISTINCT FROM OLD."release_claimed_at" OR NEW."release_expires_at" IS DISTINCT FROM OLD."release_expires_at" OR NEW."release_delivery_count" IS DISTINCT FROM OLD."release_delivery_count" OR NEW."released_at" IS DISTINCT FROM OLD."released_at"
            OR NEW."companion_claim_fence" IS DISTINCT FROM OLD."companion_claim_fence" OR NEW."companion_claim_expires_at" IS DISTINCT FROM OLD."companion_claim_expires_at"
            OR NEW."tool_invocation_claim_fence" IS DISTINCT FROM OLD."tool_invocation_claim_fence" OR NEW."tool_invocation_claim_revision" IS DISTINCT FROM OLD."tool_invocation_claim_revision"
            OR NEW."terminal_outcome" IS DISTINCT FROM OLD."terminal_outcome" OR NEW."terminal_payload_digest" IS DISTINCT FROM OLD."terminal_payload_digest" OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at") THEN
        RAISE EXCEPTION 'terminal McpRuntimeExecution authority is immutable outside cleanup';
    END IF;

    IF (NEW."command_state" IN ('succeeded', 'failed', 'recovery_required')) <> (NEW."completed_at" IS NOT NULL AND NEW."terminal_outcome" IS NOT NULL)
        OR (NEW."workload_state" = 'closed' AND NEW."command_state" NOT IN ('succeeded', 'failed', 'recovery_required'))
        OR (NEW."workload_state" IN ('assigned', 'released', 'registered', 'closed') AND NEW."workload_uid" IS NOT NULL AND NEW."assigned_at" IS NULL)
        OR (NEW."workload_state" IN ('released', 'registered') AND (NEW."released_at" IS NULL OR NEW."release_claimed_at" IS NULL OR NEW."release_expires_at" IS NULL))
        OR (NEW."workload_state" = 'registered' AND NEW."pod_uid" IS NULL)
        OR (NEW."command_state" = 'claimed' AND (NEW."companion_claim_fence" IS NULL OR NEW."companion_claim_expires_at" IS NULL)) THEN
        RAISE EXCEPTION 'McpRuntimeExecution state lacks matching delivery, workload, command, or terminal evidence';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "mcp_runtime_executions_authority" BEFORE INSERT OR UPDATE OR DELETE ON "mcp_runtime_executions" FOR EACH ROW EXECUTE FUNCTION "enforce_mcp_runtime_execution_authority"();

CREATE FUNCTION "enforce_mcp_server_revision_runtime_completion"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'McpServerRevision rows cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'discovering' OR NEW."protocol_version" IS NOT NULL OR NEW."completed_at" IS NOT NULL THEN
            RAISE EXCEPTION 'McpServerRevision must begin discovering without completion evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."mcp_server_id" IS DISTINCT FROM OLD."mcp_server_id"
        OR NEW."oci_image_validation_id" IS DISTINCT FROM OLD."oci_image_validation_id" OR NEW."revision" IS DISTINCT FROM OLD."revision"
        OR NEW."registry_reference" IS DISTINCT FROM OLD."registry_reference" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'McpServerRevision image identity is immutable';
    END IF;
    IF OLD."state" <> 'discovering' OR NEW."state" NOT IN ('ready', 'rejected') OR NEW."completed_at" IS NULL
        OR (NEW."state" = 'ready' AND NEW."protocol_version" IS DISTINCT FROM '2026-07-28')
        OR (NEW."state" = 'rejected' AND NEW."protocol_version" IS NOT NULL) THEN
        RAISE EXCEPTION 'McpServerRevision may complete discovery exactly once with checked protocol evidence';
    END IF;
    NEW."completed_at" := date_trunc('milliseconds', clock_timestamp())::TIMESTAMP(3);
    RETURN NEW;
END;
$$;
CREATE TRIGGER "mcp_server_revisions_runtime_completion" BEFORE INSERT OR UPDATE OR DELETE ON "mcp_server_revisions" FOR EACH ROW EXECUTE FUNCTION "enforce_mcp_server_revision_runtime_completion"();


CREATE TABLE "opencrane_migrations"."forward_repairs" (
    "repair_id" TEXT PRIMARY KEY,
    "source_migration_id" TEXT NOT NULL,
    "source_schema_sql_sha256" TEXT NOT NULL CHECK ("source_schema_sql_sha256" ~ '^[0-9a-f]{64}$'),
    "source_prisma_baseline_checksum" TEXT NOT NULL CHECK ("source_prisma_baseline_checksum" ~ '^[0-9a-f]{64}$'),
    "source_prisma_cutover_checksum" TEXT NOT NULL CHECK ("source_prisma_cutover_checksum" ~ '^[0-9a-f]{64}$'),
    "repair_sql_sha256" TEXT NOT NULL CHECK ("repair_sql_sha256" ~ '^[0-9a-f]{64}$'),
    "silo_id" TEXT NOT NULL,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE "opencrane_migrations"."forward_repairs" FROM PUBLIC;
INSERT INTO "opencrane_migrations"."forward_repairs" (
    "repair_id", "source_migration_id", "source_schema_sql_sha256",
    "source_prisma_baseline_checksum", "source_prisma_cutover_checksum",
    "repair_sql_sha256", "silo_id"
) VALUES (
    'untagged-0.9.3-candidate-to-0.10.0', '0.9.0-to-0.9.3',
    'eb429e29c15495608c5e3d50c6d7904ea6e015ea5fc6eff631a310bc6f2ae5fa',
    'd7229f9995c5c881dd1b4da3dae6d972cb6827e00fca4b7d21fb1c8a48b13f84',
    '6a4256041ba5a78c6e849531c4d9fffea2cad5afef509344c088e566bcfa0004',
    :'repair_sql_sha256', :'migration_silo_id'
);

COMMIT;
\endif
\endif
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
