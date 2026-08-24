DO $$
DECLARE
	violated_constraint TEXT;
BEGIN
	BEGIN
		INSERT INTO "authorization_grants" (
			"id", "silo_id", "subject_kind", "subject_principal_id", "boundary_kind",
			"boundary_principal_id", "boundary_coverage", "catalog_id", "catalog_revision",
			"catalog_digest", "capability_id", "resource_kind", "resource_id", "effect",
			"priority", "created_by"
		) VALUES (
			'iam-empty-catalog-digest', 'iam-convergence-silo', 'principal', 'iam-subject', 'personal',
			'iam-subject', 'exact', 'iam-catalog', 1, '', 'iam-capability', 'message',
			'iam-message', 'allow', 0, 'iam-test'
		);
		RAISE EXCEPTION 'authorization grant accepted an empty catalog digest';
	EXCEPTION WHEN check_violation THEN
		GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
		IF violated_constraint IS DISTINCT FROM 'authorization_grants_exact_check' THEN
			RAISE;
		END IF;
	END;
END;
$$;

INSERT INTO "verified_fleet_membership_revisions" (
	"id", "revision", "issuer_id", "issuer_key_id", "silo_id", "issued_at", "expires_at",
	"payload_digest", "signature", "verified_at"
) VALUES (
	'iam-verified-revision', 1, 'iam-issuer', 'iam-key', 'iam-convergence-silo',
	'2026-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z',
	'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
	'iam-signature', '2026-01-01T00:00:01.000Z'
);

DO $$
DECLARE
	violated_constraint TEXT;
BEGIN
	BEGIN
		INSERT INTO "verified_fleet_membership_assertions" (
			"id", "revision_id", "assertion_id", "silo_id", "subject_id"
		) VALUES ('iam-blank-assertion', 'iam-verified-revision', '', 'iam-convergence-silo', 'iam-subject');
		RAISE EXCEPTION 'fleet membership assertion accepted a blank identity';
	EXCEPTION WHEN check_violation THEN
		GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
		IF violated_constraint IS DISTINCT FROM 'verified_fleet_membership_assertions_exact_check' THEN
			RAISE;
		END IF;
	END;
END;
$$;

INSERT INTO "principals" (
	"id", "silo_id", "issuer", "subject", "provenance", "updated_at"
) VALUES (
	'iam-external-principal', 'iam-convergence-silo', 'https://identity.test.invalid',
	'iam-external-subject', 'external', clock_timestamp()
);

DO $$
BEGIN
	BEGIN
		INSERT INTO "agent_services" (
			"id", "silo_id", "kind", "name", "workload_profile", "principal_id", "updated_at"
		) VALUES (
			'iam-managed-service', 'iam-convergence-silo', 'managed', 'Invalid managed service',
			'iam-test', 'iam-external-principal', clock_timestamp()
		);
		RAISE EXCEPTION 'managed AgentService accepted an external Principal';
	EXCEPTION WHEN raise_exception THEN
		IF SQLERRM IS DISTINCT FROM 'managed AgentService Principal has invalid internal provenance' THEN
			RAISE;
		END IF;
	END;
END;
$$;

INSERT INTO "groups" (
	"id", "silo_id", "name", "membership_authority", "updated_at"
) VALUES ('iam-memory-group', 'iam-convergence-silo', 'Memory boundary', 'local', clock_timestamp());

DO $$
DECLARE
	violated_constraint TEXT;
BEGIN
	BEGIN
		INSERT INTO "memory_datasets" (
			"id", "silo_id", "boundary_kind", "boundary_group_id", "cognee_dataset_id", "created_by"
		) VALUES
			('iam-memory-a', 'iam-convergence-silo', 'group', 'iam-memory-group', 'iam-cognee-a', 'iam-test'),
			('iam-memory-b', 'iam-convergence-silo', 'group', 'iam-memory-group', 'iam-cognee-b', 'iam-test');
		RAISE EXCEPTION 'memory datasets accepted a duplicate NULL-bearing boundary';
	EXCEPTION WHEN unique_violation THEN
		GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
		IF violated_constraint IS DISTINCT FROM 'memory_datasets_exact_boundary_key' THEN
			RAISE;
		END IF;
	END;
END;
$$;
