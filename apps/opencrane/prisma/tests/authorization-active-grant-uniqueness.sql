BEGIN;

SELECT pg_temp.seed_external_user('active-grant-test-silo', 'active-grant-test-principal');

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
