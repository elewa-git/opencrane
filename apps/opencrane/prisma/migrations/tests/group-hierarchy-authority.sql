BEGIN;

CREATE FUNCTION pg_temp.expect_group_hierarchy_failure(statement TEXT, expected_message TEXT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    failure_message TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
        SET CONSTRAINTS groups_hierarchy_guard IMMEDIATE;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS failure_message = MESSAGE_TEXT;
    END;
    IF failure_message IS NULL THEN
        RAISE EXCEPTION 'Group hierarchy unexpectedly accepted: %', statement;
    END IF;
    IF strpos(failure_message, expected_message) = 0 THEN
        RAISE EXCEPTION 'Group hierarchy returned unexpected failure: %', failure_message;
    END IF;
END;
$$;

INSERT INTO "groups" ("id", "name", "scope", "parent_id", "updated_at") VALUES
    ('hierarchy-company', 'Hierarchy Company', 'org', NULL, clock_timestamp()),
    ('hierarchy-engineering', 'Hierarchy Engineering', 'department', 'hierarchy-company', clock_timestamp()),
    ('hierarchy-platform', 'Hierarchy Platform', 'team', 'hierarchy-engineering', clock_timestamp());

SELECT pg_temp.expect_group_hierarchy_failure(
    $statement$
    UPDATE "groups" SET "parent_id" = 'hierarchy-platform' WHERE "id" = 'hierarchy-company'
    $statement$,
    'group hierarchy cannot contain a cycle'
);

SELECT pg_temp.expect_group_hierarchy_failure(
    $statement$
    UPDATE "groups" SET "parent_id" = 'hierarchy-platform' WHERE "id" = 'hierarchy-platform'
    $statement$,
    'group hierarchy cannot contain a cycle'
);

SELECT pg_temp.expect_group_hierarchy_failure(
    $statement$
    UPDATE "groups" SET "parent_id" = 'hierarchy-missing' WHERE "id" = 'hierarchy-platform'
    $statement$,
    'groups_parent_id_fkey'
);

SELECT pg_temp.expect_group_hierarchy_failure(
    $statement$
    DELETE FROM "groups" WHERE "id" = 'hierarchy-company'
    $statement$,
    'groups_parent_id_fkey'
);

UPDATE "groups" SET "parent_id" = 'hierarchy-company' WHERE "id" = 'hierarchy-platform';
SET CONSTRAINTS groups_hierarchy_guard IMMEDIATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "groups"
         WHERE "id" = 'hierarchy-platform'
           AND "parent_id" = 'hierarchy-company'
    ) THEN
        RAISE EXCEPTION 'Group hierarchy did not preserve a valid reparenting';
    END IF;
END;
$$;

ROLLBACK;
