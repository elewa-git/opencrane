\if :{?source_baseline_sha256}
\else
\echo 'source_baseline_sha256 is required'
\quit
\endif
\if :{?migration_sql_sha256}
\else
\echo 'migration_sql_sha256 is required'
\quit
\endif

SELECT pg_advisory_lock(hashtextextended('opencrane:database-schema-migration', 0));
SELECT to_regclass('opencrane_migrations.repair_history') IS NOT NULL AS repair_history_exists \gset
\if :repair_history_exists
SELECT EXISTS (
    SELECT 1
      FROM "opencrane_migrations"."repair_history"
     WHERE "repair_id" = '0.9.3-to-0.9.3'
       AND "source_baseline_sha256" = :'source_baseline_sha256'
       AND "target_baseline_sha256" = '5cf59dcd7bb3cb1812f79711bfd00310714729353db97dd1af8a422305e94438'
       AND "sql_sha256" = :'migration_sql_sha256'
) AS repair_already_applied \gset
\else
SELECT (
    to_regclass('public.mcp_task_claims') IS NOT NULL
    AND to_regclass('public.mcp_tasks') IS NOT NULL
    AND EXISTS (
        SELECT 1
          FROM pg_type AS type_row
          JOIN pg_namespace AS namespace_row ON namespace_row.oid = type_row.typnamespace
         WHERE namespace_row.nspname = 'public' AND type_row.typname = 'McpTaskState'
    )
) AS repair_already_applied \gset
\endif

\if :repair_already_applied
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
\else
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('opencrane:database-schema-migration:0.9.3-to-0.9.3', 0));
SELECT set_config('opencrane.expected_source_baseline_sha256', :'source_baseline_sha256', true);
SELECT set_config('opencrane.expected_migration_sql_sha256', :'migration_sql_sha256', true);

DO $$
BEGIN
    IF current_setting('opencrane.expected_source_baseline_sha256') !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'source_baseline_sha256 must be the exact predecessor digest recorded by the prior migration' USING ERRCODE = 'OC900';
    END IF;
    IF current_setting('opencrane.expected_migration_sql_sha256') !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'migration_sql_sha256 must be the exact digest bound by the repair manifest' USING ERRCODE = 'OC900';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM "opencrane_migrations"."schema_history"
         WHERE "schema_version" = '0.9.3'
           AND "migration_id" = '0.9.0-to-0.9.3'
           AND "target_baseline_sha256" = current_setting('opencrane.expected_source_baseline_sha256')
    ) THEN
        RAISE EXCEPTION 'MCP task repair requires the exact recorded 0.9.0-to-0.9.3 predecessor' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "opencrane_migrations"."repair_history" (
    "repair_id" TEXT PRIMARY KEY,
    "source_baseline_sha256" TEXT NOT NULL CHECK ("source_baseline_sha256" ~ '^[0-9a-f]{64}$'),
    "target_baseline_sha256" TEXT NOT NULL CHECK ("target_baseline_sha256" ~ '^[0-9a-f]{64}$'),
    "sql_sha256" TEXT NOT NULL CHECK ("sql_sha256" ~ '^[0-9a-f]{64}$'),
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE "opencrane_migrations"."repair_history" FROM PUBLIC;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_type AS type_row
          JOIN pg_namespace AS namespace_row ON namespace_row.oid = type_row.typnamespace
         WHERE namespace_row.nspname = 'public' AND type_row.typname = 'McpTaskState'
    ) THEN
        CREATE TYPE "McpTaskState" AS ENUM ('working', 'input_required', 'completed', 'cancelled', 'failed');
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS "mcp_task_claims" (
    "silo_id" TEXT NOT NULL,
    "identity_digest" TEXT NOT NULL,
    "touched_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mcp_task_claims_pkey" PRIMARY KEY ("silo_id", "identity_digest")
);
ALTER TABLE "mcp_task_claims" DROP CONSTRAINT IF EXISTS "mcp_task_claims_identity_check";
ALTER TABLE "mcp_task_claims" ADD CONSTRAINT "mcp_task_claims_identity_check" CHECK (
    btrim("silo_id") <> '' AND "identity_digest" ~ '^sha256:[0-9a-f]{64}$'
);

CREATE TABLE IF NOT EXISTS "mcp_tasks" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "request_key_digest" TEXT NOT NULL,
    "call_digest" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "task_id" TEXT,
    "task_name" TEXT,
    "task_key" TEXT,
    "state" "McpTaskState" NOT NULL DEFAULT 'working',
    "input_request" JSONB,
    "input_response" JSONB,
    "result" TEXT,
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mcp_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tasks_task_id_key" ON "mcp_tasks"("task_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tasks_silo_id_request_key_digest_key" ON "mcp_tasks"("silo_id", "request_key_digest");
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_tasks_silo_id_task_key_key" ON "mcp_tasks"("silo_id", "task_key");
CREATE INDEX IF NOT EXISTS "mcp_tasks_silo_id_principal_id_state_created_at_idx" ON "mcp_tasks"("silo_id", "principal_id", "state", "created_at");
ALTER TABLE "mcp_tasks" DROP CONSTRAINT IF EXISTS "mcp_tasks_identity_check";
ALTER TABLE "mcp_tasks" ADD CONSTRAINT "mcp_tasks_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("principal_id") <> '' AND btrim("tool_name") <> '' AND
    "request_key_digest" ~ '^sha256:[0-9a-f]{64}$' AND "call_digest" ~ '^sha256:[0-9a-f]{64}$' AND
    "input_request" IS NOT NULL
);
ALTER TABLE "mcp_tasks" DROP CONSTRAINT IF EXISTS "mcp_tasks_state_check";
ALTER TABLE "mcp_tasks" ADD CONSTRAINT "mcp_tasks_state_check" CHECK (
    ("state" = 'working' AND "result" IS NULL AND "failure_code" IS NULL)
    OR ("state" = 'input_required' AND "result" IS NULL AND "failure_code" IS NULL)
    OR ("state" = 'completed' AND "input_response" IS NOT NULL AND btrim("result") <> '' AND "failure_code" IS NULL)
    OR ("state" = 'cancelled' AND "result" IS NULL)
    OR ("state" = 'failed' AND "result" IS NULL AND btrim("failure_code") <> '')
);

INSERT INTO "opencrane_migrations"."repair_history" (
    "repair_id", "source_baseline_sha256", "target_baseline_sha256", "sql_sha256"
) VALUES (
    '0.9.3-to-0.9.3', current_setting('opencrane.expected_source_baseline_sha256'),
    '5cf59dcd7bb3cb1812f79711bfd00310714729353db97dd1af8a422305e94438',
    current_setting('opencrane.expected_migration_sql_sha256')
);

COMMIT;
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
\endif
