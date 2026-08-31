BEGIN;

CREATE FUNCTION pg_temp.expect_failure(test_name TEXT, statement TEXT, expected_message TEXT)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    actual_message TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, expected_message) > 0 THEN
            RAISE NOTICE 'PASS: %', test_name;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL: % returned unexpected error: %', test_name, actual_message;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

CREATE FUNCTION pg_temp.assert_true(test_name TEXT, condition BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF condition IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL: %', test_name;
    END IF;
    RAISE NOTICE 'PASS: %', test_name;
END;
$$;

INSERT INTO "principals" (
    "id", "silo_id", "issuer", "subject", "provenance", "updated_at"
) VALUES (
    'active-grant-test-principal', 'active-grant-test-silo',
    'https://identity.example.test', 'active-grant-test-subject', 'external', clock_timestamp()
);

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'active-grant-test-1', 'active-grant-test-silo', 'principal', NULL,
    'active-grant-test-principal', 'personal', NULL, 'active-grant-test-principal', 'exact',
    'active-grant-test-manager', catalog."catalog_id", catalog."revision", catalog."digest",
    'organization:read', 'organization', 'active-grant-test-silo', 'allow', 0,
    'active-grant-test-principal'
FROM "capability_catalog_revisions" catalog
WHERE catalog."catalog_id" = 'opencrane-product-authorization'
  AND catalog."revision" = 1;

SELECT pg_temp.expect_failure(
    'duplicate active grant fails',
    $statement$
        INSERT INTO "authorization_grants" (
            "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
            "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
            "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
            "resource_kind", "resource_id", "effect", "priority", "created_by"
        )
        SELECT
            'active-grant-test-2', 'active-grant-test-silo', 'principal', NULL,
            'active-grant-test-principal', 'personal', NULL, 'active-grant-test-principal', 'exact',
            'active-grant-test-manager', catalog."catalog_id", catalog."revision", catalog."digest",
            'organization:read', 'organization', 'active-grant-test-silo', 'allow', 0,
            'active-grant-test-principal'
        FROM "capability_catalog_revisions" catalog
        WHERE catalog."catalog_id" = 'opencrane-product-authorization'
          AND catalog."revision" = 1
    $statement$,
    'authorization_grant_exact_authority_key'
);

UPDATE "authorization_grants"
   SET "revoked_at" = clock_timestamp()
 WHERE "id" = 'active-grant-test-1';

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
    "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
    "resource_kind", "resource_id", "effect", "priority", "created_by"
)
SELECT
    'active-grant-test-2', 'active-grant-test-silo', 'principal', NULL,
    'active-grant-test-principal', 'personal', NULL, 'active-grant-test-principal', 'exact',
    'active-grant-test-manager', catalog."catalog_id", catalog."revision", catalog."digest",
    'organization:read', 'organization', 'active-grant-test-silo', 'allow', 0,
    'active-grant-test-principal'
FROM "capability_catalog_revisions" catalog
WHERE catalog."catalog_id" = 'opencrane-product-authorization'
  AND catalog."revision" = 1;

SELECT pg_temp.assert_true(
    'revoked history remains while one replacement is active',
    (SELECT count(*) = 2 AND count(*) FILTER (WHERE "revoked_at" IS NULL) = 1
       FROM "authorization_grants"
      WHERE "manager_id" = 'active-grant-test-manager')
);

SELECT pg_temp.expect_failure(
    'the next active duplicate fails',
    $statement$
        INSERT INTO "authorization_grants" (
            "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
            "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage",
            "manager_id", "catalog_id", "catalog_revision", "catalog_digest", "capability_id",
            "resource_kind", "resource_id", "effect", "priority", "created_by"
        )
        SELECT
            'active-grant-test-3', 'active-grant-test-silo', 'principal', NULL,
            'active-grant-test-principal', 'personal', NULL, 'active-grant-test-principal', 'exact',
            'active-grant-test-manager', catalog."catalog_id", catalog."revision", catalog."digest",
            'organization:read', 'organization', 'active-grant-test-silo', 'allow', 0,
            'active-grant-test-principal'
        FROM "capability_catalog_revisions" catalog
        WHERE catalog."catalog_id" = 'opencrane-product-authorization'
          AND catalog."revision" = 1
    $statement$,
    'authorization_grant_exact_authority_key'
);

ROLLBACK;
