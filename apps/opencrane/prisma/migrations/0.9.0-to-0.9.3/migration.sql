\set ON_ERROR_STOP on

-- The deployment owner binds this reviewed transition to its source image, silo, and OIDC issuer.
-- It must take a physical backup before execution; rollback is backup restore or a forward repair.
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
\if :{?migration_silo_id}
\else
\echo 'migration_silo_id is required'
\quit
\endif
\if :{?migration_oidc_issuer}
\else
\echo 'migration_oidc_issuer is required'
\quit
\endif

SELECT pg_advisory_lock(hashtextextended('opencrane:database-schema-migration', 0));

SELECT to_regclass('opencrane_migrations.schema_history') IS NOT NULL AS migration_history_exists \gset
\if :migration_history_exists
SELECT (
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'membership_authority'
    )
    AND EXISTS (
        SELECT 1 FROM "opencrane_migrations"."schema_history"
        WHERE "schema_version" = '0.9.3'
          AND "source_schema_version" = '0.9.0'
          AND "source_baseline_sha256" = :'source_baseline_sha256'
          AND "target_baseline_sha256" = '7972fe51934780a79233c9e327a1179ab6e51fd0f2824501db04f17d14f4dccd'
          AND "sql_sha256" = :'migration_sql_sha256'
          AND "migration_id" = '0.9.0-to-0.9.3'
    )
) AS migration_already_applied \gset
\else
SELECT FALSE AS migration_already_applied \gset
\endif

\if :migration_already_applied
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
\else

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('opencrane:database-schema-migration:0.9.0-to-0.9.3', 0));
SELECT set_config('opencrane.expected_source_baseline_sha256', :'source_baseline_sha256', true);
SELECT set_config('opencrane.expected_migration_sql_sha256', :'migration_sql_sha256', true);
SELECT set_config('opencrane.migration_silo_id', :'migration_silo_id', true);
SELECT set_config('opencrane.migration_oidc_issuer', :'migration_oidc_issuer', true);

DO $$
DECLARE
    protected_digest TEXT;
    history_count INTEGER;
    expected_source_digest TEXT := current_setting('opencrane.expected_source_baseline_sha256');
    exact_silo TEXT := btrim(current_setting('opencrane.migration_silo_id'));
    exact_issuer TEXT := btrim(current_setting('opencrane.migration_oidc_issuer'));
BEGIN
    IF exact_silo = '' OR exact_issuer = '' THEN
        RAISE EXCEPTION 'migration_silo_id and migration_oidc_issuer must be non-empty' USING ERRCODE = 'OC900';
    END IF;
    IF to_regclass('opencrane_bootstrap.target_baseline') IS NULL THEN
        RAISE EXCEPTION 'protected target baseline marker is missing' USING ERRCODE = 'OC900';
    END IF;
    SELECT "baseline_sha256" INTO protected_digest
      FROM "opencrane_bootstrap"."target_baseline" WHERE "singleton" = TRUE;
    IF protected_digest <> expected_source_digest THEN
        RAISE EXCEPTION 'protected baseline origin does not match the supplied source digest' USING ERRCODE = 'OC900';
    END IF;
    IF protected_digest NOT IN (
        'bd2dfd915b66514d4c7ad95328adb4629567634a47f1a1e37aee69f23d9a98ee',
        '12505f3c15114bd2a407d0d4d2ef2befc3c8ec87acaa9787503cfbe4eba0032c',
        '25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d'
    ) THEN
        RAISE EXCEPTION 'database origin is not an admitted 0.9.0 baseline lineage' USING ERRCODE = 'OC900';
    END IF;
    IF to_regclass('public.groups') IS NULL
       OR to_regclass('public.org_memberships') IS NULL
       OR to_regclass('public.authorization_grants') IS NULL
       OR to_regclass('public.agent_revision_scope_attachments') IS NULL
       OR to_regclass('public.mcp_server_access_policies') IS NULL
       OR EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'silo_id'
       ) THEN
        RAISE EXCEPTION 'database does not match the exact 0.9.0 source shape' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (SELECT 1 FROM "org_memberships" WHERE btrim("cluster_tenant") <> exact_silo)
       OR EXISTS (SELECT 1 FROM "authorization_grants" WHERE btrim("silo_id") <> exact_silo)
       OR EXISTS (SELECT 1 FROM "memory_datasets" WHERE btrim("silo_id") <> exact_silo)
       OR EXISTS (SELECT 1 FROM "agent_services" WHERE btrim("silo_id") <> exact_silo)
       OR EXISTS (SELECT 1 FROM "verified_fleet_membership_revisions" WHERE btrim("silo_id") <> exact_silo) THEN
        RAISE EXCEPTION 'source rows span a silo other than migration_silo_id' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (SELECT 1 FROM "verified_fleet_membership_revisions")
       OR EXISTS (SELECT 1 FROM "verified_fleet_membership_assertions")
       OR EXISTS (SELECT 1 FROM "highest_accepted_fleet_memberships") THEN
        RAISE EXCEPTION 'v1 signed fleet membership cannot be re-signed by a database migration; publish a v2 revision first' USING ERRCODE = 'OC900';
    END IF;
    IF to_regclass('opencrane_migrations.schema_history') IS NOT NULL THEN
        SELECT count(*) INTO history_count FROM "opencrane_migrations"."schema_history"
         WHERE "schema_version" = '0.9.0'
           AND "target_baseline_sha256" = '5e16b35aedce54bf6ff7bd79bca04f92f6b6aee6315dec5c4b4797604342ab5f';
        IF history_count <> 1 THEN
            RAISE EXCEPTION 'schema history does not name exact 0.9.0 authority' USING ERRCODE = 'OC900';
        END IF;
    END IF;
END;
$$;

CREATE TYPE "AuthorizationSubjectKind" AS ENUM ('group', 'principal');
CREATE TYPE "AuthorizationBoundaryKind" AS ENUM ('group', 'personal');
CREATE TYPE "AuthorizationBoundaryCoverage" AS ENUM ('exact', 'descendants');
CREATE TYPE "GroupMembershipAuthority" AS ENUM ('external', 'local');
CREATE TYPE "PrincipalProvenance" AS ENUM ('external', 'internal');

CREATE TABLE "principals" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "provenance" "PrincipalProvenance" NOT NULL DEFAULT 'external',
    "email" TEXT,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "principals_pkey" PRIMARY KEY ("id")
);

INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "email", "display_name", "created_at", "updated_at")
SELECT membership."id", current_setting('opencrane.migration_silo_id'), current_setting('opencrane.migration_oidc_issuer'),
       membership."subject", 'external', membership."email", membership."display_name", membership."created_at", membership."updated_at"
FROM "org_memberships" membership;

INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "email", "display_name", "created_at", "updated_at")
SELECT 'agent-service:' || service."id", service."silo_id", 'urn:opencrane:agent-service', service."id",
       'internal', NULL, service."name", service."created_at", service."updated_at"
FROM "agent_services" service
WHERE service."kind" = 'managed';

ALTER TABLE "principals" ADD CONSTRAINT "principals_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("issuer") <> '' AND btrim("subject") <> '' AND
    (("provenance" = 'external' AND "issuer" <> 'urn:opencrane:agent-service') OR
     ("provenance" = 'internal' AND "issuer" = 'urn:opencrane:agent-service' AND "email" IS NULL))
);
CREATE INDEX "principals_silo_id_email_idx" ON "principals"("silo_id", "email");
CREATE UNIQUE INDEX "principals_id_silo_id_key" ON "principals"("id", "silo_id");
CREATE UNIQUE INDEX "principals_silo_id_issuer_subject_key" ON "principals"("silo_id", "issuer", "subject");

ALTER TABLE "agent_services" ADD COLUMN "principal_id" TEXT;
UPDATE "agent_services" SET "principal_id" = 'agent-service:' || "id" WHERE "kind" = 'managed';
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_managed_principal_check" CHECK (
    ("kind" = 'managed' AND "principal_id" IS NOT NULL) OR ("kind" = 'personal' AND "principal_id" IS NULL)
);
CREATE UNIQUE INDEX "agent_services_principal_id_silo_id_key" ON "agent_services"("principal_id", "silo_id");
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_principal_id_silo_id_fkey"
    FOREIGN KEY ("principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "enforce_managed_agent_service_principal"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE principal_issuer TEXT; principal_subject TEXT; principal_provenance "PrincipalProvenance";
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."principal_id" IS DISTINCT FROM OLD."principal_id") THEN
        RAISE EXCEPTION 'AgentService kind, silo, and Principal are immutable';
    END IF;
    IF NEW."kind" = 'personal' THEN
        IF NEW."principal_id" IS NOT NULL THEN RAISE EXCEPTION 'personal AgentService cannot own a managed Principal'; END IF;
        RETURN NEW;
    END IF;
    SELECT "issuer", "subject", "provenance" INTO principal_issuer, principal_subject, principal_provenance
    FROM "principals" WHERE "id" = NEW."principal_id" AND "silo_id" = NEW."silo_id" FOR UPDATE;
    IF principal_provenance IS DISTINCT FROM 'internal'::"PrincipalProvenance"
       OR principal_issuer IS DISTINCT FROM 'urn:opencrane:agent-service'
       OR principal_subject IS DISTINCT FROM NEW."id" THEN
        RAISE EXCEPTION 'managed AgentService Principal has invalid internal provenance';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "agent_services_managed_principal_guard" BEFORE INSERT OR UPDATE ON "agent_services"
    FOR EACH ROW EXECUTE FUNCTION "enforce_managed_agent_service_principal"();

ALTER TABLE "groups" ADD COLUMN "silo_id" TEXT;
ALTER TABLE "groups" ADD COLUMN "membership_authority" "GroupMembershipAuthority";
ALTER TABLE "groups" ADD COLUMN "parent_id" TEXT;
UPDATE "groups"
SET "silo_id" = current_setting('opencrane.migration_silo_id'),
    "membership_authority" = CASE WHEN "name" LIKE 'group:%' THEN 'external'::"GroupMembershipAuthority" ELSE 'local'::"GroupMembershipAuthority" END;
ALTER TABLE "groups" ALTER COLUMN "silo_id" SET NOT NULL;
ALTER TABLE "groups" ALTER COLUMN "membership_authority" SET NOT NULL;

CREATE TEMPORARY TABLE "_iam_principal_reference" (
    "reference" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    PRIMARY KEY ("reference", "principal_id")
) ON COMMIT DROP;
INSERT INTO "_iam_principal_reference" ("reference", "principal_id")
SELECT "id", "id" FROM "principals"
UNION
SELECT "subject", "id" FROM "principals"
UNION
SELECT lower("email"), "id" FROM "principals" WHERE "email" IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "artifacts" artifact
        WHERE (SELECT count(*) FROM "_iam_principal_reference" reference
               WHERE reference."reference" = artifact."owner_principal_id") <> 1
    ) THEN
        RAISE EXCEPTION 'every Artifact owner must resolve to exactly one Principal' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "mcp_server_installs" install
        WHERE (SELECT count(*) FROM "_iam_principal_reference" reference
               WHERE reference."reference" = install."user_id") <> 1
    ) THEN
        RAISE EXCEPTION 'every MCP install user must resolve to exactly one Principal' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT install."mcp_server_id", reference."principal_id"
        FROM "mcp_server_installs" install
        JOIN "_iam_principal_reference" reference ON reference."reference" = install."user_id"
        GROUP BY install."mcp_server_id", reference."principal_id"
        HAVING count(*) <> 1
    ) THEN
        RAISE EXCEPTION 'MCP installs collide after Principal projection' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

UPDATE "artifacts" artifact
SET "owner_principal_id" = reference."principal_id"
FROM "_iam_principal_reference" reference
WHERE reference."reference" = artifact."owner_principal_id";

UPDATE "mcp_server_installs" install
SET "user_id" = reference."principal_id"
FROM "_iam_principal_reference" reference
WHERE reference."reference" = install."user_id";

CREATE TEMPORARY TABLE "_iam_group_reference" (
    "reference" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "legacy_scope" TEXT NOT NULL,
    "is_resource_share" BOOLEAN NOT NULL,
    PRIMARY KEY ("reference", "group_id")
) ON COMMIT DROP;
INSERT INTO "_iam_group_reference" ("reference", "group_id", "legacy_scope", "is_resource_share")
SELECT "id", "id", "scope"::TEXT, "name" LIKE 'resource:%' FROM "groups"
UNION
SELECT "name", "id", "scope"::TEXT, "name" LIKE 'resource:%' FROM "groups";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "groups" group_row
        WHERE jsonb_typeof(group_row."members") <> 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(group_row."members") member WHERE jsonb_typeof(member) <> 'string')
           OR EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(group_row."members") member("subject")
               GROUP BY member."subject" HAVING count(*) > 1
           )
    ) THEN
        RAISE EXCEPTION 'Group.members must be an array of unique subject strings' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "groups" group_row
        CROSS JOIN LATERAL jsonb_array_elements_text(group_row."members") member("subject")
        WHERE (SELECT count(*) FROM "_iam_principal_reference" reference WHERE reference."reference" = member."subject") <> 1
    ) THEN
        RAISE EXCEPTION 'every legacy group member must resolve to exactly one Principal' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "groups"
        WHERE "name" LIKE 'resource:%'
          AND ("scope"::TEXT <> 'personal' OR "name" !~ '^resource:(file|chat|dataset):.+$' OR jsonb_array_length("members") = 0)
    ) THEN
        RAISE EXCEPTION 'legacy resource share groups require personal scope, a supported resource kind, and an owner' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

CREATE TABLE "group_memberships" (
    "silo_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("group_id", "principal_id")
);
INSERT INTO "group_memberships" ("silo_id", "group_id", "principal_id", "created_at")
SELECT group_row."silo_id", group_row."id", reference."principal_id", group_row."created_at"
FROM "groups" group_row
CROSS JOIN LATERAL jsonb_array_elements_text(group_row."members") member("subject")
JOIN "_iam_principal_reference" reference ON reference."reference" = member."subject"
WHERE group_row."name" NOT LIKE 'resource:%';

CREATE SCHEMA IF NOT EXISTS "opencrane_migrations";
CREATE TABLE "opencrane_migrations"."group_claim_cutover" (
    "silo_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "source_claim" TEXT NOT NULL,
    "target_claim" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "migration_id" TEXT NOT NULL,
    "migration_sql_sha256" TEXT NOT NULL CHECK ("migration_sql_sha256" ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY ("silo_id", "issuer", "source_claim"),
    UNIQUE ("silo_id", "issuer", "target_claim")
);
REVOKE ALL ON TABLE "opencrane_migrations"."group_claim_cutover" FROM PUBLIC;
INSERT INTO "opencrane_migrations"."group_claim_cutover" (
    "silo_id", "issuer", "source_claim", "target_claim", "group_id", "migration_id", "migration_sql_sha256"
)
SELECT group_row."silo_id", current_setting('opencrane.migration_oidc_issuer'), group_row."name", 'group:' || group_row."id",
       group_row."id", '0.9.0-to-0.9.3', current_setting('opencrane.expected_migration_sql_sha256')
FROM "groups" group_row
WHERE group_row."membership_authority" = 'external';

CREATE TABLE "agent_revision_boundary_attachments" (
    "id" TEXT NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "boundary_kind" "AuthorizationBoundaryKind" NOT NULL,
    "boundary_group_id" TEXT,
    "boundary_principal_id" TEXT,
    "boundary_coverage" "AuthorizationBoundaryCoverage" NOT NULL,
    CONSTRAINT "agent_revision_boundary_attachments_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "agent_revision_scope_attachments" attachment
        WHERE (attachment."subject_type"::TEXT = 'group' AND (
                  SELECT count(*) FROM "_iam_group_reference" reference
                  WHERE reference."reference" = attachment."subject_id" AND NOT reference."is_resource_share"
              ) <> 1)
           OR (attachment."subject_type"::TEXT = 'user' AND (
                  attachment."scope"::TEXT <> 'personal' OR
                  (SELECT count(*) FROM "_iam_principal_reference" reference WHERE reference."reference" = attachment."subject_id") <> 1
              ))
    ) THEN
        RAISE EXCEPTION 'every AgentRevision scope attachment must map to one group or personal Principal boundary' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

INSERT INTO "agent_revision_boundary_attachments" (
    "id", "agent_revision_id", "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage"
)
SELECT 'migration-boundary-' || md5(attachment."agent_revision_id" || ':' || attachment."scope"::TEXT || ':' || attachment."subject_type"::TEXT || ':' || attachment."subject_id"),
       attachment."agent_revision_id", service."silo_id",
       CASE WHEN attachment."subject_type"::TEXT = 'group' THEN 'group'::"AuthorizationBoundaryKind" ELSE 'personal'::"AuthorizationBoundaryKind" END,
       CASE WHEN attachment."subject_type"::TEXT = 'group' THEN group_reference."group_id" END,
       CASE WHEN attachment."subject_type"::TEXT = 'user' THEN principal_reference."principal_id" END,
       'exact'::"AuthorizationBoundaryCoverage"
FROM "agent_revision_scope_attachments" attachment
JOIN "agent_revisions" revision ON revision."id" = attachment."agent_revision_id"
JOIN "agent_services" service ON service."id" = revision."agent_service_id"
LEFT JOIN "_iam_group_reference" group_reference
       ON group_reference."reference" = attachment."subject_id" AND NOT group_reference."is_resource_share"
LEFT JOIN "_iam_principal_reference" principal_reference
       ON principal_reference."reference" = attachment."subject_id"
WHERE (attachment."subject_type"::TEXT = 'group' AND group_reference."group_id" IS NOT NULL)
   OR (attachment."subject_type"::TEXT = 'user' AND principal_reference."principal_id" IS NOT NULL);

DROP TRIGGER "authorization_grants_immutable" ON "authorization_grants";
ALTER TABLE "authorization_grants" DROP CONSTRAINT "authorization_grants_exact_check";
ALTER TABLE "authorization_grants" DROP CONSTRAINT "authorization_grants_scope_check";
DROP INDEX "authorization_grants_silo_id_subject_id_scope_kind_organiza_idx";
DROP INDEX "authorization_grant_exact_authority_key";
DROP INDEX "authorization_grant_null_scope_authority_key";

ALTER TABLE "authorization_grants" ADD COLUMN "subject_kind" "AuthorizationSubjectKind";
ALTER TABLE "authorization_grants" ADD COLUMN "subject_group_id" TEXT;
ALTER TABLE "authorization_grants" ADD COLUMN "subject_principal_id" TEXT;
ALTER TABLE "authorization_grants" ADD COLUMN "boundary_kind" "AuthorizationBoundaryKind";
ALTER TABLE "authorization_grants" ADD COLUMN "boundary_group_id" TEXT;
ALTER TABLE "authorization_grants" ADD COLUMN "boundary_principal_id" TEXT;
ALTER TABLE "authorization_grants" ADD COLUMN "boundary_coverage" "AuthorizationBoundaryCoverage";
ALTER TABLE "authorization_grants" ADD COLUMN "manager_id" TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "authorization_grants" grant_row
        WHERE (
            SELECT count(*) FROM (
                SELECT 'principal', reference."principal_id" FROM "_iam_principal_reference" reference
                 WHERE reference."reference" = grant_row."subject_id"
                UNION ALL
                SELECT 'group', reference."group_id" FROM "_iam_group_reference" reference
                 WHERE reference."reference" = grant_row."subject_id" AND NOT reference."is_resource_share"
            ) candidate
        ) <> 1
    ) THEN
        RAISE EXCEPTION 'every legacy AuthorizationGrant subject must resolve to exactly one Principal or Group' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "authorization_grants" grant_row
        WHERE (grant_row."scope_kind"::TEXT IN ('personal', 'direct-user') AND (
                   SELECT count(*) FROM "_iam_principal_reference" reference
                   WHERE reference."reference" = grant_row."scope_resource_id"
               ) <> 1)
           OR (grant_row."scope_kind"::TEXT NOT IN ('personal', 'direct-user') AND (
                   SELECT count(*) FROM "_iam_group_reference" reference
                   WHERE NOT reference."is_resource_share"
                     AND reference."legacy_scope" = CASE grant_row."scope_kind"::TEXT
                         WHEN 'organization' THEN 'org'
                         WHEN 'department' THEN 'department'
                         WHEN 'team' THEN 'team'
                         WHEN 'project' THEN 'project'
                     END
                     AND (
                         reference."reference" = CASE WHEN grant_row."scope_kind"::TEXT = 'organization' THEN grant_row."organization_id" ELSE grant_row."scope_resource_id" END
                         OR (grant_row."scope_kind"::TEXT = 'organization'
                             AND grant_row."organization_id" = current_setting('opencrane.migration_silo_id'))
                     )
               ) <> 1)
    ) THEN
        RAISE EXCEPTION 'every legacy AuthorizationGrant scope must resolve to exactly one stored boundary' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

UPDATE "authorization_grants" grant_row
SET "subject_kind" = CASE
        WHEN EXISTS (SELECT 1 FROM "_iam_principal_reference" reference WHERE reference."reference" = grant_row."subject_id")
        THEN 'principal'::"AuthorizationSubjectKind" ELSE 'group'::"AuthorizationSubjectKind" END,
    "subject_principal_id" = (
        SELECT reference."principal_id" FROM "_iam_principal_reference" reference WHERE reference."reference" = grant_row."subject_id"
    ),
    "subject_group_id" = (
        SELECT reference."group_id" FROM "_iam_group_reference" reference
        WHERE reference."reference" = grant_row."subject_id" AND NOT reference."is_resource_share"
    ),
    "boundary_kind" = CASE WHEN grant_row."scope_kind"::TEXT IN ('personal', 'direct-user')
        THEN 'personal'::"AuthorizationBoundaryKind" ELSE 'group'::"AuthorizationBoundaryKind" END,
    "boundary_principal_id" = CASE WHEN grant_row."scope_kind"::TEXT IN ('personal', 'direct-user') THEN (
        SELECT reference."principal_id" FROM "_iam_principal_reference" reference WHERE reference."reference" = grant_row."scope_resource_id"
    ) END,
    "boundary_group_id" = CASE WHEN grant_row."scope_kind"::TEXT NOT IN ('personal', 'direct-user') THEN (
        SELECT reference."group_id" FROM "_iam_group_reference" reference
        WHERE NOT reference."is_resource_share"
          AND reference."legacy_scope" = CASE grant_row."scope_kind"::TEXT
              WHEN 'organization' THEN 'org' WHEN 'department' THEN 'department' WHEN 'team' THEN 'team' WHEN 'project' THEN 'project' END
          AND (
              reference."reference" = CASE WHEN grant_row."scope_kind"::TEXT = 'organization' THEN grant_row."organization_id" ELSE grant_row."scope_resource_id" END
              OR (grant_row."scope_kind"::TEXT = 'organization' AND grant_row."organization_id" = current_setting('opencrane.migration_silo_id'))
          )
    ) END,
    "boundary_coverage" = 'exact'::"AuthorizationBoundaryCoverage";

ALTER TABLE "authorization_grants" ALTER COLUMN "subject_kind" SET NOT NULL;
ALTER TABLE "authorization_grants" ALTER COLUMN "boundary_kind" SET NOT NULL;
ALTER TABLE "authorization_grants" ALTER COLUMN "boundary_coverage" SET NOT NULL;
ALTER TABLE "authorization_grants" DROP COLUMN "subject_id";
ALTER TABLE "authorization_grants" DROP COLUMN "scope_kind";
ALTER TABLE "authorization_grants" DROP COLUMN "organization_id";
ALTER TABLE "authorization_grants" DROP COLUMN "scope_resource_id";

ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_exact_check" CHECK (
    btrim("silo_id") <> '' AND
    (("subject_kind" = 'group' AND "subject_group_id" IS NOT NULL AND "subject_principal_id" IS NULL) OR
     ("subject_kind" = 'principal' AND "subject_group_id" IS NULL AND "subject_principal_id" IS NOT NULL)) AND
    (("boundary_kind" = 'group' AND "boundary_group_id" IS NOT NULL AND "boundary_principal_id" IS NULL) OR
     ("boundary_kind" = 'personal' AND "boundary_group_id" IS NULL AND "boundary_principal_id" IS NOT NULL AND "boundary_coverage" = 'exact')) AND
    btrim("catalog_id") <> '' AND "catalog_revision" > 0 AND
    "catalog_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("capability_id") <> '' AND
    btrim("resource_kind") NOT IN ('', '*') AND btrim("resource_id") NOT IN ('', '*') AND
    "priority" >= 0 AND btrim("created_by") <> ''
);
CREATE UNIQUE INDEX "authorization_grant_exact_authority_key" ON "authorization_grants"(
    "silo_id", "subject_kind", COALESCE("subject_group_id", ''), COALESCE("subject_principal_id", ''),
    "boundary_kind", COALESCE("boundary_group_id", ''), COALESCE("boundary_principal_id", ''), "boundary_coverage",
    "catalog_id", "catalog_revision", "capability_id", "resource_kind", COALESCE("resource_id", ''), "effect", "priority", COALESCE("manager_id", '')
);
CREATE INDEX "authorization_grants_silo_id_subject_kind_subject_group_id__idx" ON "authorization_grants"("silo_id", "subject_kind", "subject_group_id", "subject_principal_id");
CREATE INDEX "authorization_grants_silo_id_boundary_kind_boundary_group_i_idx" ON "authorization_grants"("silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage");
CREATE INDEX "authorization_grants_silo_id_manager_id_idx" ON "authorization_grants"("silo_id", "manager_id");

CREATE OR REPLACE FUNCTION "enforce_authorization_grant_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'AuthorizationGrant rows cannot be deleted'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."subject_kind" IS DISTINCT FROM OLD."subject_kind" OR NEW."subject_group_id" IS DISTINCT FROM OLD."subject_group_id"
        OR NEW."subject_principal_id" IS DISTINCT FROM OLD."subject_principal_id" OR NEW."boundary_kind" IS DISTINCT FROM OLD."boundary_kind"
        OR NEW."boundary_group_id" IS DISTINCT FROM OLD."boundary_group_id" OR NEW."boundary_principal_id" IS DISTINCT FROM OLD."boundary_principal_id"
        OR NEW."boundary_coverage" IS DISTINCT FROM OLD."boundary_coverage" OR NEW."manager_id" IS DISTINCT FROM OLD."manager_id"
        OR NEW."catalog_id" IS DISTINCT FROM OLD."catalog_id" OR NEW."catalog_revision" IS DISTINCT FROM OLD."catalog_revision"
        OR NEW."catalog_digest" IS DISTINCT FROM OLD."catalog_digest" OR NEW."capability_id" IS DISTINCT FROM OLD."capability_id"
        OR NEW."resource_kind" IS DISTINCT FROM OLD."resource_kind" OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id"
        OR NEW."effect" IS DISTINCT FROM OLD."effect" OR NEW."priority" IS DISTINCT FROM OLD."priority"
        OR NEW."valid_from" IS DISTINCT FROM OLD."valid_from" OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
        OR NEW."created_by" IS DISTINCT FROM OLD."created_by" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'AuthorizationGrant authority fields are immutable';
    END IF;
    IF OLD."revoked_at" IS NOT NULL OR NEW."revoked_at" IS NULL THEN
        RAISE EXCEPTION 'AuthorizationGrant may be revoked exactly once';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "authorization_grants_immutable" BEFORE UPDATE OR DELETE ON "authorization_grants"
    FOR EACH ROW EXECUTE FUNCTION "enforce_authorization_grant_update"();

DROP TRIGGER "memory_datasets_closed_lifecycle" ON "memory_datasets";
ALTER TABLE "memory_datasets" DROP CONSTRAINT "memory_datasets_identity_check";
ALTER TABLE "memory_datasets" DROP CONSTRAINT "memory_datasets_scope_check";
DROP INDEX "memory_datasets_silo_id_scope_kind_organization_id_scope_re_key";
DROP INDEX "memory_datasets_exact_scope_key";
ALTER TABLE "memory_datasets" ADD COLUMN "boundary_kind" "AuthorizationBoundaryKind";
ALTER TABLE "memory_datasets" ADD COLUMN "boundary_group_id" TEXT;
ALTER TABLE "memory_datasets" ADD COLUMN "boundary_principal_id" TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "memory_datasets" dataset
        WHERE (dataset."scope_kind"::TEXT IN ('personal', 'direct-user') AND (
                  SELECT count(*) FROM "_iam_principal_reference" reference WHERE reference."reference" = dataset."scope_resource_id"
              ) <> 1)
           OR (dataset."scope_kind"::TEXT NOT IN ('personal', 'direct-user') AND (
                  SELECT count(*) FROM "_iam_group_reference" reference
                  WHERE NOT reference."is_resource_share"
                    AND reference."legacy_scope" = CASE dataset."scope_kind"::TEXT
                        WHEN 'organization' THEN 'org' WHEN 'department' THEN 'department' WHEN 'team' THEN 'team' WHEN 'project' THEN 'project' END
                    AND (reference."reference" = CASE WHEN dataset."scope_kind"::TEXT = 'organization' THEN dataset."organization_id" ELSE dataset."scope_resource_id" END
                         OR (dataset."scope_kind"::TEXT = 'organization' AND dataset."organization_id" = current_setting('opencrane.migration_silo_id')))
              ) <> 1)
    ) THEN
        RAISE EXCEPTION 'every legacy MemoryDataset scope must resolve to exactly one stored boundary' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

UPDATE "memory_datasets" dataset
SET "boundary_kind" = CASE WHEN dataset."scope_kind"::TEXT IN ('personal', 'direct-user')
        THEN 'personal'::"AuthorizationBoundaryKind" ELSE 'group'::"AuthorizationBoundaryKind" END,
    "boundary_principal_id" = CASE WHEN dataset."scope_kind"::TEXT IN ('personal', 'direct-user') THEN (
        SELECT reference."principal_id" FROM "_iam_principal_reference" reference WHERE reference."reference" = dataset."scope_resource_id"
    ) END,
    "boundary_group_id" = CASE WHEN dataset."scope_kind"::TEXT NOT IN ('personal', 'direct-user') THEN (
        SELECT reference."group_id" FROM "_iam_group_reference" reference
        WHERE NOT reference."is_resource_share"
          AND reference."legacy_scope" = CASE dataset."scope_kind"::TEXT
              WHEN 'organization' THEN 'org' WHEN 'department' THEN 'department' WHEN 'team' THEN 'team' WHEN 'project' THEN 'project' END
          AND (reference."reference" = CASE WHEN dataset."scope_kind"::TEXT = 'organization' THEN dataset."organization_id" ELSE dataset."scope_resource_id" END
               OR (dataset."scope_kind"::TEXT = 'organization' AND dataset."organization_id" = current_setting('opencrane.migration_silo_id')))
    ) END;
ALTER TABLE "memory_datasets" ALTER COLUMN "boundary_kind" SET NOT NULL;
ALTER TABLE "memory_datasets" DROP COLUMN "scope_kind";
ALTER TABLE "memory_datasets" DROP COLUMN "organization_id";
ALTER TABLE "memory_datasets" DROP COLUMN "scope_resource_id";
ALTER TABLE "memory_datasets" ADD CONSTRAINT "memory_datasets_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("cognee_dataset_id") <> '' AND btrim("created_by") <> '' AND
    (("boundary_kind" = 'group' AND "boundary_group_id" IS NOT NULL AND "boundary_principal_id" IS NULL) OR
     ("boundary_kind" = 'personal' AND "boundary_group_id" IS NULL AND "boundary_principal_id" IS NOT NULL))
);
CREATE INDEX "memory_datasets_silo_id_boundary_kind_boundary_group_id_bou_idx" ON "memory_datasets"("silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id");
CREATE OR REPLACE FUNCTION "enforce_memory_dataset_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MemoryDataset catalog rows cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."boundary_kind" IS DISTINCT FROM OLD."boundary_kind" OR NEW."boundary_group_id" IS DISTINCT FROM OLD."boundary_group_id" OR NEW."boundary_principal_id" IS DISTINCT FROM OLD."boundary_principal_id" OR NEW."cognee_dataset_id" IS DISTINCT FROM OLD."cognee_dataset_id" OR NEW."created_by" IS DISTINCT FROM OLD."created_by" OR NEW."created_at" IS DISTINCT FROM OLD."created_at") THEN RAISE EXCEPTION 'MemoryDataset authority is immutable'; END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" = 'retired' THEN RAISE EXCEPTION 'retired MemoryDataset is closed'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "memory_datasets_closed_lifecycle" BEFORE UPDATE OR DELETE ON "memory_datasets"
    FOR EACH ROW EXECUTE FUNCTION "enforce_memory_dataset_lifecycle"();

ALTER TABLE "mcp_servers" ADD COLUMN "silo_id" TEXT;
UPDATE "mcp_servers" SET "silo_id" = current_setting('opencrane.migration_silo_id');
ALTER TABLE "mcp_servers" ALTER COLUMN "silo_id" SET NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "mcp_server_access_policies" WHERE "everyone_in_org") THEN
        RAISE EXCEPTION 'everyoneInOrg MCP policy has no deterministic least-privilege grant projection' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "mcp_server_access_users" access_user
        WHERE (SELECT count(*) FROM "_iam_principal_reference" reference WHERE reference."reference" = access_user."user_id") <> 1
    ) THEN
        RAISE EXCEPTION 'every MCP access user must resolve to exactly one Principal' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "mcp_server_access_policies" policy
        CROSS JOIN LATERAL unnest(COALESCE(policy."groups", ARRAY[]::TEXT[])) group_reference("reference")
        WHERE (SELECT count(*) FROM "_iam_group_reference" reference
               WHERE reference."reference" = group_reference."reference" AND NOT reference."is_resource_share") <> 1
    ) THEN
        RAISE EXCEPTION 'every MCP access group must resolve to exactly one Group' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "mcp_server_access_policies" policy
        WHERE (EXISTS (SELECT 1 FROM "mcp_server_access_users" access_user WHERE access_user."access_policy_id" = policy."id")
               OR cardinality(COALESCE(policy."groups", ARRAY[]::TEXT[])) > 0)
          AND (SELECT count(*) FROM "_iam_group_reference" reference
               WHERE reference."legacy_scope" = 'org' AND NOT reference."is_resource_share") <> 1
    ) THEN
        RAISE EXCEPTION 'MCP policies require exactly one legacy organization Group boundary' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "capability_catalog_revisions"
        WHERE ("catalog_id" = 'opencrane-resource-sharing' AND ("revision" <> 1 OR "digest" <> 'sha256:03c84ee77c531ddc95d5c379e195e12d94aed9129783a07105066a875d24c775' OR "capabilities" <> '[{"id":"resource:read","actions":["read"]}]'::jsonb))
           OR ("catalog_id" = 'opencrane-core' AND ("revision" <> 1 OR "digest" <> 'sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6' OR "capabilities" <> '[{"id":"mcp-server:use","actions":["use"]}]'::jsonb))
           OR ("id" = 'capability-catalog-resource-sharing-v1' AND "catalog_id" <> 'opencrane-resource-sharing')
           OR ("id" = 'capability-catalog-opencrane-core-v1' AND "catalog_id" <> 'opencrane-core')
    ) THEN
        RAISE EXCEPTION 'existing capability catalog rows conflict with the reviewed 0.9.3 seeds' USING ERRCODE = 'OC900';
    END IF;
END;
$$;
INSERT INTO "capability_catalog_revisions" ("id", "catalog_id", "revision", "digest", "capabilities", "created_by") VALUES
('capability-catalog-resource-sharing-v1', 'opencrane-resource-sharing', 1, 'sha256:03c84ee77c531ddc95d5c379e195e12d94aed9129783a07105066a875d24c775', '[{"id":"resource:read","actions":["read"]}]'::jsonb, 'system:target-baseline'),
('capability-catalog-opencrane-core-v1', 'opencrane-core', 1, 'sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6', '[{"id":"mcp-server:use","actions":["use"]}]'::jsonb, 'system:target-baseline')
ON CONFLICT DO NOTHING;

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage", "manager_id",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind", "resource_id",
    "effect", "priority", "valid_from", "require_approval", "created_by", "created_at"
)
SELECT 'migration-mcp-user-' || md5(policy."id" || ':' || access_user."user_id"), server."silo_id",
       'principal', NULL, principal_reference."principal_id", 'group', organization_group."group_id", NULL, 'exact', 'mcp-access-editor',
       'opencrane-core', 1, 'sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6',
       'mcp-server:use', 'mcp-server', server."id", 'allow', 0, policy."created_at", false,
       'migration:0.9.0-to-0.9.3', policy."created_at"
FROM "mcp_server_access_policies" policy
JOIN "mcp_servers" server ON server."id" = policy."mcp_server_id"
JOIN "mcp_server_access_users" access_user ON access_user."access_policy_id" = policy."id"
JOIN "_iam_principal_reference" principal_reference ON principal_reference."reference" = access_user."user_id"
CROSS JOIN LATERAL (
    SELECT reference."group_id" FROM "_iam_group_reference" reference
    WHERE reference."legacy_scope" = 'org' AND NOT reference."is_resource_share"
) organization_group;

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage", "manager_id",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind", "resource_id",
    "effect", "priority", "valid_from", "require_approval", "created_by", "created_at"
)
SELECT 'migration-mcp-group-' || md5(policy."id" || ':' || group_name."reference"), server."silo_id",
       'group', group_reference."group_id", NULL, 'group', organization_group."group_id", NULL, 'exact', 'mcp-access-editor',
       'opencrane-core', 1, 'sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6',
       'mcp-server:use', 'mcp-server', server."id", 'allow', 0, policy."created_at", false,
       'migration:0.9.0-to-0.9.3', policy."created_at"
FROM "mcp_server_access_policies" policy
JOIN "mcp_servers" server ON server."id" = policy."mcp_server_id"
CROSS JOIN LATERAL unnest(COALESCE(policy."groups", ARRAY[]::TEXT[])) group_name("reference")
JOIN "_iam_group_reference" group_reference ON group_reference."reference" = group_name."reference" AND NOT group_reference."is_resource_share"
CROSS JOIN LATERAL (
    SELECT reference."group_id" FROM "_iam_group_reference" reference
    WHERE reference."legacy_scope" = 'org' AND NOT reference."is_resource_share"
) organization_group;

CREATE TABLE "resource_shares" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "resource_kind" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "owner_principal_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "resource_shares_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "resource_share_recipients" (
    "silo_id" TEXT NOT NULL,
    "resource_share_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "granted_by_principal_id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_share_recipients_pkey" PRIMARY KEY ("resource_share_id", "principal_id")
);

INSERT INTO "resource_shares" ("id", "silo_id", "resource_kind", "resource_id", "owner_principal_id", "created_at", "updated_at")
SELECT group_row."id", group_row."silo_id", split_part(group_row."name", ':', 2), substring(group_row."name" from '^[^:]+:[^:]+:(.+)$'),
       owner_reference."principal_id", group_row."created_at", group_row."updated_at"
FROM "groups" group_row
CROSS JOIN LATERAL (SELECT value #>> '{}' AS subject FROM jsonb_array_elements(group_row."members") WITH ORDINALITY member(value, ordinal) WHERE ordinal = 1) owner_member
JOIN "_iam_principal_reference" owner_reference ON owner_reference."reference" = owner_member.subject
WHERE group_row."name" LIKE 'resource:%';

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_principal_id", "boundary_kind", "boundary_principal_id", "boundary_coverage", "manager_id",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind", "resource_id",
    "effect", "priority", "valid_from", "require_approval", "created_by", "created_at"
)
SELECT 'migration-resource-share-' || md5(group_row."id" || ':' || recipient_reference."principal_id"), group_row."silo_id",
       'principal', recipient_reference."principal_id", 'personal', owner_reference."principal_id", 'exact', 'resource-share-editor',
       'opencrane-resource-sharing', 1, 'sha256:03c84ee77c531ddc95d5c379e195e12d94aed9129783a07105066a875d24c775',
       'resource:read', split_part(group_row."name", ':', 2), substring(group_row."name" from '^[^:]+:[^:]+:(.+)$'),
       'allow', 0, group_row."created_at", false, owner_reference."principal_id", group_row."created_at"
FROM "groups" group_row
CROSS JOIN LATERAL jsonb_array_elements(group_row."members") WITH ORDINALITY owner_member(value, ordinal)
JOIN "_iam_principal_reference" owner_reference ON owner_reference."reference" = (owner_member.value #>> '{}') AND owner_member.ordinal = 1
CROSS JOIN LATERAL jsonb_array_elements(group_row."members") WITH ORDINALITY recipient_member(value, ordinal)
JOIN "_iam_principal_reference" recipient_reference ON recipient_reference."reference" = (recipient_member.value #>> '{}') AND recipient_member.ordinal > 1
WHERE group_row."name" LIKE 'resource:%';

INSERT INTO "resource_share_recipients" ("silo_id", "resource_share_id", "principal_id", "granted_by_principal_id", "grant_id", "created_at")
SELECT share."silo_id", share."id", grant_row."subject_principal_id", share."owner_principal_id", grant_row."id", grant_row."created_at"
FROM "resource_shares" share
JOIN "authorization_grants" grant_row
  ON grant_row."manager_id" = 'resource-share-editor'
 AND grant_row."boundary_principal_id" = share."owner_principal_id"
 AND grant_row."resource_kind" = share."resource_kind"
 AND grant_row."resource_id" = share."resource_id";

DELETE FROM "groups" WHERE "name" LIKE 'resource:%';

DROP INDEX "groups_scope_idx";
DROP INDEX "mcp_servers_scope_idx";
DROP INDEX "verified_fleet_membership_assertions_silo_id_subject_id_sco_idx";
ALTER TABLE "groups" DROP COLUMN "members";
ALTER TABLE "groups" DROP COLUMN "scope";
ALTER TABLE "mcp_servers" DROP COLUMN "scope";
ALTER TABLE "verified_fleet_membership_assertions" DROP COLUMN "scope_kind";
ALTER TABLE "verified_fleet_membership_assertions" DROP COLUMN "organization_id";
ALTER TABLE "verified_fleet_membership_assertions" DROP COLUMN "scope_resource_id";

DROP TABLE "agent_revision_scope_attachments";
DROP TABLE "mcp_server_access_users";
DROP TABLE "mcp_server_access_policies";

DROP INDEX "groups_name_key";
DROP INDEX "mcp_servers_name_key";

CREATE INDEX "agent_revision_boundary_attachments_agent_revision_id_bound_idx" ON "agent_revision_boundary_attachments"("agent_revision_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage");
CREATE INDEX "agent_revision_boundary_attachments_silo_id_boundary_kind_idx" ON "agent_revision_boundary_attachments"("silo_id", "boundary_kind");
CREATE INDEX "groups_silo_id_parent_id_idx" ON "groups"("silo_id", "parent_id");
CREATE INDEX "groups_silo_id_membership_authority_idx" ON "groups"("silo_id", "membership_authority");
CREATE UNIQUE INDEX "groups_id_silo_id_key" ON "groups"("id", "silo_id");
CREATE UNIQUE INDEX "groups_silo_id_name_key" ON "groups"("silo_id", "name");
CREATE INDEX "group_memberships_silo_id_principal_id_idx" ON "group_memberships"("silo_id", "principal_id");
CREATE UNIQUE INDEX "mcp_servers_silo_id_name_key" ON "mcp_servers"("silo_id", "name");
CREATE INDEX "verified_fleet_membership_assertions_silo_id_subject_id_idx" ON "verified_fleet_membership_assertions"("silo_id", "subject_id");
CREATE UNIQUE INDEX "resource_shares_id_silo_id_key" ON "resource_shares"("id", "silo_id");
CREATE UNIQUE INDEX "resource_shares_silo_id_resource_kind_resource_id_key" ON "resource_shares"("silo_id", "resource_kind", "resource_id");
CREATE UNIQUE INDEX "resource_share_recipients_grant_id_key" ON "resource_share_recipients"("grant_id");
CREATE INDEX "resource_share_recipients_silo_id_principal_id_idx" ON "resource_share_recipients"("silo_id", "principal_id");

ALTER TABLE "agent_revision_boundary_attachments" ADD CONSTRAINT "agent_revision_boundary_attachments_exact_boundary_check" CHECK (
    btrim("agent_revision_id") <> '' AND btrim("silo_id") <> '' AND
    (("boundary_kind" = 'group' AND "boundary_group_id" IS NOT NULL AND "boundary_principal_id" IS NULL) OR
     ("boundary_kind" = 'personal' AND "boundary_group_id" IS NULL AND "boundary_principal_id" IS NOT NULL AND "boundary_coverage" = 'exact'))
);
ALTER TABLE "groups" ADD CONSTRAINT "groups_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("name") <> '' AND ("parent_id" IS NULL OR btrim("parent_id") <> '')
);
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("group_id") <> '' AND btrim("principal_id") <> ''
);
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("resource_kind") NOT IN ('', '*') AND btrim("resource_id") NOT IN ('', '*') AND btrim("owner_principal_id") <> ''
);
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("resource_share_id") <> '' AND btrim("principal_id") <> '' AND btrim("granted_by_principal_id") <> '' AND btrim("grant_id") <> ''
);

ALTER TABLE "agent_revision_boundary_attachments" ADD CONSTRAINT "agent_revision_boundary_attachments_agent_revision_id_fkey" FOREIGN KEY ("agent_revision_id") REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_revision_boundary_attachments" ADD CONSTRAINT "agent_revision_boundary_attachments_boundary_group_id_silo_fkey" FOREIGN KEY ("boundary_group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_revision_boundary_attachments" ADD CONSTRAINT "agent_revision_boundary_attachments_boundary_principal_id__fkey" FOREIGN KEY ("boundary_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_subject_group_id_silo_id_fkey" FOREIGN KEY ("subject_group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_subject_principal_id_silo_id_fkey" FOREIGN KEY ("subject_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_boundary_group_id_silo_id_fkey" FOREIGN KEY ("boundary_group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_boundary_principal_id_silo_id_fkey" FOREIGN KEY ("boundary_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "groups" ADD CONSTRAINT "groups_parent_id_silo_id_fkey" FOREIGN KEY ("parent_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_silo_id_fkey" FOREIGN KEY ("group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_principal_id_silo_id_fkey" FOREIGN KEY ("principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_datasets" ADD CONSTRAINT "memory_datasets_boundary_group_id_silo_id_fkey" FOREIGN KEY ("boundary_group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memory_datasets" ADD CONSTRAINT "memory_datasets_boundary_principal_id_silo_id_fkey" FOREIGN KEY ("boundary_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_owner_principal_id_silo_id_fkey" FOREIGN KEY ("owner_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_resource_share_id_silo_id_fkey" FOREIGN KEY ("resource_share_id", "silo_id") REFERENCES "resource_shares"("id", "silo_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_principal_id_silo_id_fkey" FOREIGN KEY ("principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_granted_by_principal_id_silo_id_fkey" FOREIGN KEY ("granted_by_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "authorization_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "agent_revision_boundary_attachments_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "agent_revision_boundary_attachments"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_revision_assignment_immutability"();

CREATE FUNCTION "enforce_resource_share_immutability"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ResourceShare rows cannot be deleted; revoke recipients instead'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
       OR NEW."resource_kind" IS DISTINCT FROM OLD."resource_kind" OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id"
       OR NEW."owner_principal_id" IS DISTINCT FROM OLD."owner_principal_id" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'ResourceShare authority fields are immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "resource_shares_immutable" BEFORE UPDATE OR DELETE ON "resource_shares"
    FOR EACH ROW EXECUTE FUNCTION "enforce_resource_share_immutability"();

CREATE FUNCTION "enforce_resource_share_recipient_authority"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'ResourceShareRecipient rows cannot be updated'; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "resource_shares" share
        JOIN "authorization_grants" grant_row ON grant_row."id" = NEW."grant_id"
        WHERE share."id" = NEW."resource_share_id" AND share."silo_id" = NEW."silo_id"
          AND grant_row."silo_id" = NEW."silo_id" AND grant_row."manager_id" = 'resource-share-editor'
          AND grant_row."subject_kind" = 'principal' AND grant_row."subject_group_id" IS NULL
          AND grant_row."subject_principal_id" = NEW."principal_id" AND grant_row."boundary_kind" = 'personal'
          AND grant_row."boundary_group_id" IS NULL AND grant_row."boundary_principal_id" = share."owner_principal_id"
          AND grant_row."boundary_coverage" = 'exact' AND grant_row."resource_kind" = share."resource_kind"
          AND grant_row."resource_id" = share."resource_id" AND grant_row."effect" = 'allow'
          AND grant_row."revoked_at" IS NULL AND grant_row."created_by" = NEW."granted_by_principal_id"
    ) THEN
        RAISE EXCEPTION 'ResourceShareRecipient must link its exact active manager-owned grant';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "resource_share_recipients_authority" BEFORE INSERT OR UPDATE ON "resource_share_recipients"
    FOR EACH ROW EXECUTE FUNCTION "enforce_resource_share_recipient_authority"();

CREATE FUNCTION "enforce_group_hierarchy"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE creates_cycle BOOLEAN;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('opencrane:group-hierarchy:' || NEW."silo_id", 0));
    IF NEW."parent_id" IS NULL THEN RETURN NEW; END IF;
    WITH RECURSIVE ancestors("id", "parent_id", "silo_id", "path") AS (
        SELECT parent."id", parent."parent_id", parent."silo_id", ARRAY[parent."id"]
        FROM "groups" parent WHERE parent."id" = NEW."parent_id" AND parent."silo_id" = NEW."silo_id"
        UNION ALL
        SELECT parent."id", parent."parent_id", parent."silo_id", ancestors."path" || parent."id"
        FROM "groups" parent JOIN ancestors ON parent."id" = ancestors."parent_id" AND parent."silo_id" = ancestors."silo_id"
        WHERE NOT parent."id" = ANY(ancestors."path")
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE "id" = NEW."id" AND "silo_id" = NEW."silo_id") INTO creates_cycle;
    IF creates_cycle THEN RAISE EXCEPTION 'group hierarchy cannot contain a cycle' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "groups_hierarchy_guard" AFTER INSERT OR UPDATE OF "parent_id" ON "groups"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_group_hierarchy"();

CREATE OR REPLACE FUNCTION "enforce_personal_configuration_change_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_silo TEXT; profile_user TEXT; active_persona TEXT; conversation_silo TEXT; conversation_service TEXT; conversation_mode "ConversationMode";
        run_silo TEXT; run_conversation TEXT; run_service TEXT; run_user TEXT; service_silo TEXT; service_kind "AgentServiceKind"; active_agent TEXT;
        refresh_change TEXT; applied_revision_profile TEXT; applied_revision_service TEXT; applied_revision_parent TEXT; applied_model_alias TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PersonalConfigurationChange rows cannot be deleted'; END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'proposed' THEN RAISE EXCEPTION 'PersonalConfigurationChange must begin as Proposed'; END IF;
        SELECT "silo_id", "user_id", "active_revision_id" INTO profile_silo, profile_user, active_persona
          FROM "persona_profiles" WHERE "id" = NEW."persona_profile_id" FOR UPDATE;
        SELECT "silo_id", "agent_service_id", "mode" INTO conversation_silo, conversation_service, conversation_mode
          FROM "conversations" WHERE "id" = NEW."source_conversation_id" FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM "conversation_participants" WHERE "conversation_id" = NEW."source_conversation_id" AND "user_id" = NEW."user_id" AND "access_ended_position" IS NULL) THEN
            RAISE EXCEPTION 'PersonalConfigurationChange source conversation requires the initiating participant with current access';
        END IF;
        SELECT "silo_id", "conversation_id", "agent_service_id", "delegated_user_id" INTO run_silo, run_conversation, run_service, run_user
          FROM "agent_runs" WHERE "id" = NEW."source_run_id" FOR UPDATE;
        SELECT "silo_id", "kind", "active_revision_id" INTO service_silo, service_kind, active_agent
          FROM "agent_services" WHERE "id" = NEW."agent_service_id" FOR UPDATE;
        IF profile_silo IS DISTINCT FROM NEW."silo_id" OR profile_user IS DISTINCT FROM NEW."user_id"
           OR conversation_silo IS DISTINCT FROM NEW."silo_id" OR conversation_service IS DISTINCT FROM NEW."agent_service_id" OR conversation_mode IS DISTINCT FROM 'agent_session'
           OR run_silo IS DISTINCT FROM NEW."silo_id" OR run_conversation IS DISTINCT FROM NEW."source_conversation_id"
           OR run_service IS DISTINCT FROM NEW."agent_service_id" OR run_user IS DISTINCT FROM NEW."user_id"
           OR service_silo IS DISTINCT FROM NEW."silo_id" OR service_kind IS DISTINCT FROM 'personal'
           OR active_persona IS DISTINCT FROM NEW."expected_persona_revision_id" OR active_agent IS DISTINCT FROM NEW."expected_agent_revision_id" THEN
            RAISE EXCEPTION 'PersonalConfigurationChange provenance or active-revision fence conflict';
        END IF;
        IF NEW."source_message_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "conversation_messages" WHERE "id" = NEW."source_message_id" AND "conversation_id" = NEW."source_conversation_id") THEN
            RAISE EXCEPTION 'PersonalConfigurationChange source message must belong to its source conversation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
       OR NEW."persona_profile_id" IS DISTINCT FROM OLD."persona_profile_id" OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
       OR NEW."source_conversation_id" IS DISTINCT FROM OLD."source_conversation_id" OR NEW."source_run_id" IS DISTINCT FROM OLD."source_run_id"
       OR NEW."source_message_id" IS DISTINCT FROM OLD."source_message_id" OR NEW."requested_patch" IS DISTINCT FROM OLD."requested_patch"
       OR NEW."requested_patch_digest" IS DISTINCT FROM OLD."requested_patch_digest" OR NEW."expected_persona_revision_id" IS DISTINCT FROM OLD."expected_persona_revision_id"
       OR NEW."expected_agent_revision_id" IS DISTINCT FROM OLD."expected_agent_revision_id" OR NEW."proposed_at" IS DISTINCT FROM OLD."proposed_at" THEN
        RAISE EXCEPTION 'PersonalConfigurationChange proposal evidence is immutable';
    END IF;
    IF OLD."state" <> 'proposed' AND (NEW."decided_at" IS DISTINCT FROM OLD."decided_at" OR NEW."decided_by" IS DISTINCT FROM OLD."decided_by" OR NEW."rejection_reason" IS DISTINCT FROM OLD."rejection_reason") THEN
        RAISE EXCEPTION 'PersonalConfigurationChange decision evidence is immutable';
    END IF;
    IF OLD."state" = 'proposed' AND NEW."state" IN ('accepted', 'rejected') THEN RETURN NEW; END IF;
    IF OLD."state" = 'accepted' AND NEW."state" = 'applied' THEN
        IF NEW."requested_patch" = '{"kind":"persona_refresh"}'::jsonb THEN
            IF NEW."applied_persona_revision_id" IS NULL OR NEW."applied_agent_revision_id" IS NOT NULL THEN
                RAISE EXCEPTION 'persona_refresh requires an approved persona revision only';
            END IF;
            SELECT revision."persona_profile_id", interview."refresh_configuration_change_id"
              INTO applied_revision_profile, refresh_change
              FROM "persona_revisions" revision JOIN "persona_interviews" interview ON interview."id" = revision."interview_id"
              WHERE revision."id" = NEW."applied_persona_revision_id" AND revision."state" = 'approved' FOR UPDATE OF revision, interview;
            IF applied_revision_profile IS DISTINCT FROM NEW."persona_profile_id" OR refresh_change IS DISTINCT FROM NEW."id" THEN
                RAISE EXCEPTION 'applied persona refresh must use its exact approved interview-derived revision';
            END IF;
        ELSIF NEW."requested_patch"->>'kind' = 'model_alias' THEN
            IF NEW."applied_persona_revision_id" IS NOT NULL OR NEW."applied_agent_revision_id" IS NULL THEN
                RAISE EXCEPTION 'model_alias requires a published personal AgentRevision only';
            END IF;
            SELECT profile."active_revision_id" INTO active_persona
              FROM "persona_profiles" profile
              WHERE profile."id" = NEW."persona_profile_id" AND profile."silo_id" = NEW."silo_id" AND profile."user_id" = NEW."user_id"
              FOR UPDATE OF profile;
            IF active_persona IS DISTINCT FROM NEW."expected_persona_revision_id" THEN
                RAISE EXCEPTION 'applied model_alias must preserve the proposal persona revision';
            END IF;
            SELECT revision."agent_service_id", revision."parent_revision_id", definition."public_model_name"
              INTO applied_revision_service, applied_revision_parent, applied_model_alias
              FROM "agent_revisions" revision JOIN "model_definitions" definition ON definition."id" = revision."model_definition_id"
              WHERE revision."id" = NEW."applied_agent_revision_id" AND revision."state" = 'published' FOR UPDATE OF revision, definition;
            IF applied_revision_service IS DISTINCT FROM NEW."agent_service_id" OR applied_revision_parent IS DISTINCT FROM NEW."expected_agent_revision_id"
               OR applied_model_alias IS DISTINCT FROM NEW."requested_patch"->>'modelAlias'
               OR NOT EXISTS (SELECT 1 FROM "agent_services" service WHERE service."id" = NEW."agent_service_id" AND service."kind" = 'personal' AND service."state" = 'active' AND service."active_revision_id" = NEW."applied_agent_revision_id") THEN
                RAISE EXCEPTION 'applied model_alias must activate its exact published personal AgentRevision';
            END IF;
            IF EXISTS (
                SELECT 1 FROM "agent_revisions" child JOIN "agent_revisions" parent ON parent."id" = NEW."expected_agent_revision_id"
                WHERE child."id" = NEW."applied_agent_revision_id" AND (
                    child."prompt_policy_version" IS DISTINCT FROM parent."prompt_policy_version"
                    OR child."persona_revision_id" IS DISTINCT FROM parent."persona_revision_id"
                    OR child."persona_revision_id" IS DISTINCT FROM active_persona
                    OR child."budget" IS DISTINCT FROM parent."budget"
                )
            ) OR EXISTS (
                (SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id"
                 EXCEPT SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id")
                UNION ALL
                (SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id"
                 EXCEPT SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id")
            ) OR EXISTS (
                (SELECT "integration_id", "silo_id", "custody_reference_id", "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id"
                 EXCEPT SELECT "integration_id", "silo_id", "custody_reference_id", "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id")
                UNION ALL
                (SELECT "integration_id", "silo_id", "custody_reference_id", "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id"
                 EXCEPT SELECT "integration_id", "silo_id", "custody_reference_id", "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id")
            ) OR EXISTS (
                (SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id"
                 EXCEPT SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id")
                UNION ALL
                (SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id"
                 EXCEPT SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id")
            ) THEN
                RAISE EXCEPTION 'applied model_alias may change only its model definition';
            END IF;
        ELSE
            RAISE EXCEPTION 'PersonalConfigurationChange has an unsupported applied patch';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PersonalConfigurationChange has an invalid lifecycle transition';
END;
$$;

DROP TYPE "AuthorizationScopeKind";
DROP TYPE "GrantScope";
DROP TYPE "GrantSubjectType";
DROP TYPE "FleetMembershipScopeKind";

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
    "schema_version", "source_schema_version", "source_baseline_sha256", "target_baseline_sha256", "sql_sha256", "migration_id"
) VALUES (
    '0.9.3', '0.9.0', :'source_baseline_sha256',
    '7972fe51934780a79233c9e327a1179ab6e51fd0f2824501db04f17d14f4dccd',
    :'migration_sql_sha256', '0.9.0-to-0.9.3'
);

COMMIT;
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
\endif
