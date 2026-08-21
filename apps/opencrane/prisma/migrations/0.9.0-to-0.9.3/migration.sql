\set ON_ERROR_STOP on

-- The deployment owner supplies the protected origin digest and this file's manifest-bound digest:
--   psql -v source_baseline_sha256=<digest> -v migration_sql_sha256=<digest> -f migration.sql
SELECT pg_advisory_lock(hashtextextended('opencrane:database-schema-migration', 0));

SELECT to_regclass('opencrane_migrations.schema_history') IS NOT NULL AS migration_history_exists \gset
\if :migration_history_exists
SELECT (
    EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'parent_id'
    )
    AND EXISTS (
        SELECT 1 FROM "opencrane_migrations"."schema_history"
        WHERE "schema_version" = '0.9.3'
          AND "source_schema_version" = '0.9.0'
          AND "source_baseline_sha256" = :'source_baseline_sha256'
          AND "target_baseline_sha256" = '902946b9e7c624700b2ba4349d6a50912655415dca186ef344954c98883970f4'
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
        'bd2dfd915b66514d4c7ad95328adb4629567634a47f1a1e37aee69f23d9a98ee',
        '12505f3c15114bd2a407d0d4d2ef2befc3c8ec87acaa9787503cfbe4eba0032c',
        '25bfc5d31c4966ee697ae5aaa47edc855d25120d0829c241f213353f69e0358d'
    ) THEN
        RAISE EXCEPTION 'database origin is not an admitted 0.9.0 baseline lineage' USING ERRCODE = 'OC900';
    END IF;
    IF to_regclass('public.groups') IS NULL
       OR EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'parent_id'
       ) THEN
        RAISE EXCEPTION 'database does not match the expected 0.9.0 source shape' USING ERRCODE = 'OC900';
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

ALTER TABLE "groups" ADD COLUMN "parent_id" TEXT;
CREATE INDEX "groups_parent_id_idx" ON "groups"("parent_id");
ALTER TABLE "groups" ADD CONSTRAINT "groups_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "enforce_group_hierarchy"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    current_parent_id TEXT;
    creates_cycle BOOLEAN;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('opencrane:group-hierarchy', 0));
    SELECT "parent_id" INTO current_parent_id FROM "groups" WHERE "id" = NEW."id";
    IF current_parent_id IS NULL THEN
        RETURN NEW;
    END IF;

    WITH RECURSIVE ancestors("id", "parent_id", "path") AS (
        SELECT parent."id", parent."parent_id", ARRAY[parent."id"]
        FROM "groups" parent
        WHERE parent."id" = current_parent_id
        UNION ALL
        SELECT parent."id", parent."parent_id", ancestors."path" || parent."id"
        FROM "groups" parent
        JOIN ancestors ON parent."id" = ancestors."parent_id"
        WHERE NOT parent."id" = ANY(ancestors."path")
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE "id" = NEW."id") INTO creates_cycle;

    IF creates_cycle THEN
        RAISE EXCEPTION 'group hierarchy cannot contain a cycle' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "groups_hierarchy_guard" AFTER INSERT OR UPDATE OF "parent_id" ON "groups"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "enforce_group_hierarchy"();

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
    '0.9.3', '0.9.0', :'source_baseline_sha256',
    '902946b9e7c624700b2ba4349d6a50912655415dca186ef344954c98883970f4',
    :'migration_sql_sha256', '0.9.0-to-0.9.3'
);

COMMIT;
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
\endif
