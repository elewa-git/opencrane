\set ON_ERROR_STOP on

-- The deployment owner supplies the protected origin digest and this file's manifest-bound digest:
--   psql -v source_baseline_sha256=<digest> -v migration_sql_sha256=<digest> -f migration.sql
SELECT pg_advisory_lock(hashtextextended('opencrane:database-schema-migration', 0));

SELECT to_regclass('opencrane_migrations.schema_history') IS NOT NULL AS migration_history_exists \gset
\if :migration_history_exists
SELECT (
    to_regclass('public.organization_invitations') IS NOT NULL
    AND to_regclass('public.organization_invitation_requests') IS NOT NULL
    AND EXISTS (
        SELECT 1 FROM "opencrane_migrations"."schema_history"
        WHERE "schema_version" = '0.9.0'
          AND "source_schema_version" = '0.8.0'
          AND "source_baseline_sha256" = :'source_baseline_sha256'
          AND "target_baseline_sha256" = '5e16b35aedce54bf6ff7bd79bca04f92f6b6aee6315dec5c4b4797604342ab5f'
          AND "sql_sha256" = :'migration_sql_sha256'
          AND "migration_id" = '0.8.0-to-0.9.0'
    )
) AS migration_already_applied \gset
\else
SELECT FALSE AS migration_already_applied \gset
\endif

\if :migration_already_applied
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
\else

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('opencrane:database-schema-migration:0.8.0-to-0.9.0', 0));
SELECT set_config('opencrane.expected_source_baseline_sha256', :'source_baseline_sha256', true);
SELECT set_config('opencrane.expected_migration_sql_sha256', :'migration_sql_sha256', true);

DO $$
DECLARE
    protected_digest TEXT;
    history_count INTEGER;
    expected_source_digest TEXT := current_setting('opencrane.expected_source_baseline_sha256');
BEGIN
    IF to_regclass('opencrane_bootstrap.target_baseline') IS NULL THEN
        RAISE EXCEPTION 'protected target baseline marker is missing' USING ERRCODE = 'OC900';
    END IF;
    SELECT "baseline_sha256" INTO protected_digest
      FROM "opencrane_bootstrap"."target_baseline" WHERE "singleton" = TRUE;
    IF protected_digest <> expected_source_digest THEN
        RAISE EXCEPTION 'protected baseline origin does not match the supplied source digest' USING ERRCODE = 'OC900';
    END IF;
    IF protected_digest NOT IN (
        '7ed3f49ec3b96276cfce1c1d41e97588b0970fb28352c7d933269ce201ce32fc',
        '25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d'
    ) THEN
        RAISE EXCEPTION 'database origin is not an admitted 0.8.0 baseline lineage' USING ERRCODE = 'OC900';
    END IF;
    IF to_regclass('public.org_memberships') IS NULL
       OR to_regclass('public.conversations') IS NULL
       OR to_regclass('public.organization_invitations') IS NOT NULL
       OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_memberships' AND column_name = 'email') THEN
        RAISE EXCEPTION 'database does not match the expected 0.8.0 source shape' USING ERRCODE = 'OC900';
    END IF;
    IF to_regclass('opencrane_migrations.schema_history') IS NOT NULL THEN
        SELECT count(*) INTO history_count FROM "opencrane_migrations"."schema_history"
         WHERE "schema_version" = '0.8.0'
           AND "target_baseline_sha256" = '7ed3f49ec3b96276cfce1c1d41e97588b0970fb28352c7d933269ce201ce32fc';
        IF history_count <> 1 THEN
            RAISE EXCEPTION 'schema history does not name exact 0.8.0 authority' USING ERRCODE = 'OC900';
        END IF;
    END IF;
END;
$$;

CREATE TYPE "OrganizationInvitationStatus" AS ENUM ('pending', 'accepted', 'failed');

ALTER TABLE "org_memberships" ADD COLUMN "email" TEXT;
ALTER TABLE "org_memberships" ADD COLUMN "display_name" TEXT;
CREATE UNIQUE INDEX "org_memberships_cluster_tenant_email_key" ON "org_memberships"("cluster_tenant", "email");

CREATE TABLE "organization_invitations" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active_email" TEXT,
    "role" "OrgRole" NOT NULL,
    "status" "OrganizationInvitationStatus" NOT NULL DEFAULT 'pending',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "token_nonce" TEXT NOT NULL,
    "invited_by_subject" TEXT NOT NULL,
    "invited_by_display_name" TEXT NOT NULL,
    "last_resend_idempotency_key" TEXT,
    "invited_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_subject" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_invitations_silo_id_active_email_key" ON "organization_invitations"("silo_id", "active_email");
CREATE UNIQUE INDEX "organization_invitations_silo_id_last_resend_idempotency_key_key" ON "organization_invitations"("silo_id", "last_resend_idempotency_key");
CREATE INDEX "organization_invitations_silo_id_status_expires_at_idx" ON "organization_invitations"("silo_id", "status", "expires_at");

CREATE TABLE "organization_invitation_requests" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "actor_subject" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_digest" TEXT NOT NULL,
    "result_invitation_ids" JSONB NOT NULL,
    "created_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_invitation_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_invitation_requests_silo_id_actor_subject_idempotency_key_key" ON "organization_invitation_requests"("silo_id", "actor_subject", "idempotency_key");

CREATE FUNCTION "protect_org_membership_last_owner"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD."role" = 'owner' AND OLD."status" = 'active' AND (
        TG_OP = 'DELETE'
        OR NEW."role" <> 'owner'
        OR NEW."status" <> 'active'
        OR NEW."cluster_tenant" <> OLD."cluster_tenant"
    ) THEN
        RAISE EXCEPTION 'the active organization owner cannot be removed, suspended, demoted, or moved'
            USING ERRCODE = 'OC901';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER "org_memberships_last_owner_guard"
    BEFORE UPDATE OF "role", "status", "cluster_tenant" OR DELETE ON "org_memberships"
    FOR EACH ROW EXECUTE FUNCTION "protect_org_membership_last_owner"();

CREATE SCHEMA IF NOT EXISTS "opencrane_migrations";
CREATE TABLE IF NOT EXISTS "opencrane_migrations"."schema_history" (
    "schema_version" TEXT PRIMARY KEY,
    "source_schema_version" TEXT NOT NULL,
    "source_baseline_sha256" TEXT NOT NULL CHECK ("source_baseline_sha256" ~ '^[0-9a-f]{64}$'),
    "target_baseline_sha256" TEXT NOT NULL CHECK ("target_baseline_sha256" ~ '^[0-9a-f]{64}$'),
    "sql_sha256" TEXT NOT NULL CHECK ("sql_sha256" ~ '^[0-9a-f]{64}$'),
    "migration_id" TEXT NOT NULL UNIQUE,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE "opencrane_migrations"."schema_history" FROM PUBLIC;
INSERT INTO "opencrane_migrations"."schema_history" (
    "schema_version", "source_schema_version", "source_baseline_sha256",
    "target_baseline_sha256", "sql_sha256", "migration_id"
) VALUES (
    '0.9.0', '0.8.0', :'source_baseline_sha256',
    '5e16b35aedce54bf6ff7bd79bca04f92f6b6aee6315dec5c4b4797604342ab5f',
    :'migration_sql_sha256', '0.8.0-to-0.9.0'
);

COMMIT;
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
\endif
