BEGIN;

-- This suite is source-only until the renewed baseline is rendered and loaded in CI.

CREATE FUNCTION pg_temp.expect_check(test_name TEXT, statement TEXT, expected_constraint TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_state TEXT; actual_constraint TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE, actual_constraint = CONSTRAINT_NAME;
        IF actual_state = '23514' AND actual_constraint = expected_constraint THEN
            RAISE NOTICE 'PASS: %', test_name;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL: % returned SQLSTATE % from constraint %, expected check constraint %', test_name, actual_state, actual_constraint, expected_constraint;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

CREATE FUNCTION pg_temp.expect_constraint(test_name TEXT, statement TEXT, expected_state TEXT, expected_constraint TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_state TEXT; actual_constraint TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE, actual_constraint = CONSTRAINT_NAME;
        IF actual_state = expected_state AND actual_constraint = expected_constraint THEN
            RAISE NOTICE 'PASS: %', test_name;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL: % returned SQLSTATE % from constraint %, expected SQLSTATE % from constraint %', test_name, actual_state, actual_constraint, expected_state, expected_constraint;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

CREATE FUNCTION pg_temp.expect_message(test_name TEXT, statement TEXT, expected_state TEXT, expected_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_state TEXT; actual_message TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_state = RETURNED_SQLSTATE, actual_message = MESSAGE_TEXT;
        IF actual_state = expected_state AND actual_message = expected_message THEN
            RAISE NOTICE 'PASS: %', test_name;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL: % returned SQLSTATE % with message %, expected SQLSTATE % with message %', test_name, actual_state, actual_message, expected_state, expected_message;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

CREATE FUNCTION pg_temp.insert_invalid_budget_run(paying_group_id TEXT, decision_digest TEXT, policy_digest TEXT, effective_digest TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE subject JSONB := jsonb_build_object('runScope', jsonb_build_object('runId', 'budget-invalid-run', 'attempt', 1), 'requester', jsonb_build_object('requesterPrincipalId', 'budget-service-principal'));
BEGIN
    INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "paying_group_id", "paying_group_authorization_decision_digest", "paying_group_authorization_policy_revision_hash", "paying_group_effective_authorization_digest", "execution_subject", "request_idempotency_key", "input_snapshot_digest")
    VALUES ('budget-invalid-run', 'budget-silo', 'budget-service', 'budget-revision', 'budget-conversation', 'interactive', 'identity-budget-invalid-run', 'budget-service-principal', paying_group_id, decision_digest, policy_digest, effective_digest, subject, 'budget-invalid-run-request', 'sha256:' || repeat('9', 64));
END;
$$;

CREATE FUNCTION pg_temp.insert_invalid_budget_policy(scope "ManagedBudgetScope", scope_key TEXT, group_id TEXT, agent_service_id TEXT, limit_eur_micros BIGINT DEFAULT 1000000, revision INTEGER DEFAULT 1) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "managed_budget_policies" ("id", "silo_id", "scope", "scope_key", "group_id", "agent_service_id", "limit_eur_micros", "revision", "updated_at")
    VALUES ('budget-invalid-policy', 'budget-silo', scope, scope_key, group_id, agent_service_id, limit_eur_micros, revision, clock_timestamp());
END;
$$;

CREATE FUNCTION pg_temp.insert_invalid_budget_account(policy_revision INTEGER DEFAULT 1, limit_eur_micros BIGINT DEFAULT 1000000, settled_eur_micros BIGINT DEFAULT 0, unknown_eur_micros BIGINT DEFAULT 0, claimed_eur_micros BIGINT DEFAULT 0, reserved_eur_micros BIGINT DEFAULT 0, revision INTEGER DEFAULT 0, period_start TIMESTAMPTZ DEFAULT TIMESTAMPTZ '2026-11-01 00:00:00+00') RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "managed_budget_monthly_accounts" ("id", "silo_id", "policy_id", "period_start", "policy_revision", "limit_eur_micros", "settled_eur_micros", "unknown_eur_micros", "claimed_eur_micros", "reserved_eur_micros", "revision")
    VALUES ('budget-invalid-account', 'budget-silo', 'budget-policy-global', period_start, policy_revision, limit_eur_micros, settled_eur_micros, unknown_eur_micros, claimed_eur_micros, reserved_eur_micros, revision);
END;
$$;

CREATE FUNCTION pg_temp.insert_invalid_budget_effect(effect_state "ManagedBudgetEffectState" DEFAULT 'reserved', max_input_tokens INTEGER DEFAULT 100000, max_completion_tokens INTEGER DEFAULT 1000, worst_case_eur_micros BIGINT DEFAULT 1, actual_eur_micros BIGINT DEFAULT NULL, actual_input_tokens BIGINT DEFAULT NULL, actual_output_tokens BIGINT DEFAULT NULL, terminal_at TIMESTAMPTZ DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "managed_budget_effects" ("id", "silo_id", "run_id", "run_attempt", "paying_group_id", "agent_service_id", "logical_fence", "model_alias", "period_start", "tariff_revision_id", "tariff_revision", "tariff_digest", "quote_digest", "max_input_tokens", "max_completion_tokens", "worst_case_eur_micros", "actual_eur_micros", "actual_input_tokens", "actual_output_tokens", "state", "terminal_at")
    VALUES ('budget-invalid-effect', 'budget-silo', 'budget-run', 1, 'budget-group', 'budget-service', 'budget-invalid-logical-fence', 'budget-model', TIMESTAMPTZ '2026-09-01 00:00:00+00', 'budget-tariff', 1, 'sha256:' || repeat('e', 64), 'sha256:' || repeat('8', 64), max_input_tokens, max_completion_tokens, worst_case_eur_micros, actual_eur_micros, actual_input_tokens, actual_output_tokens, effect_state, terminal_at);
END;
$$;

CREATE FUNCTION pg_temp.insert_invalid_budget_attempt(attempt_state "ManagedBudgetAttemptState" DEFAULT 'claimed', deadline_epoch_ms BIGINT DEFAULT 1798800000000, terminal_at TIMESTAMPTZ DEFAULT NULL) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "managed_budget_physical_attempts" ("id", "silo_id", "effect_id", "physical_nonce", "request_body_sha256", "deadline_epoch_ms", "state", "claimed_at", "terminal_at")
    VALUES ('budget-invalid-attempt', 'budget-silo', 'budget-effect', repeat('3', 64), repeat('4', 64), deadline_epoch_ms, attempt_state, TIMESTAMPTZ '2026-09-30 10:00:00+00', terminal_at);
END;
$$;

CREATE FUNCTION pg_temp.insert_invalid_budget_tariff(revision INTEGER DEFAULT 2, token_unit BIGINT DEFAULT 1000000, max_input_tokens INTEGER DEFAULT 100000, input_rate BIGINT DEFAULT 5, output_rate BIGINT DEFAULT 10, effective_at TIMESTAMPTZ DEFAULT TIMESTAMPTZ '2026-10-01 00:00:00+00', valid_until TIMESTAMPTZ DEFAULT TIMESTAMPTZ '2026-11-01 00:00:00+00') RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "model_eur_tariff_revisions" ("id", "silo_id", "model_definition_id", "revision", "digest", "token_unit", "max_input_tokens", "input_eur_micros_per_unit", "output_eur_micros_per_unit", "effective_at", "valid_until")
    VALUES ('budget-invalid-tariff', 'budget-silo', 'budget-model', revision, 'sha256:' || repeat('7', 64), token_unit, max_input_tokens, input_rate, output_rate, effective_at, valid_until);
END;
$$;

CREATE FUNCTION pg_temp.seed_budget_run() RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE subject JSONB := jsonb_build_object('runScope', jsonb_build_object('runId', 'budget-run', 'attempt', 1), 'requester', jsonb_build_object('requesterPrincipalId', 'budget-service-principal'));
BEGIN
    PERFORM pg_temp.seed_agent_conversation('budget-conversation', 'budget-silo', 'budget-service');
    INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "paying_group_id", "paying_group_authorization_decision_digest", "paying_group_authorization_policy_revision_hash", "paying_group_effective_authorization_digest", "execution_subject", "request_idempotency_key", "input_snapshot_digest")
    VALUES ('budget-run', 'budget-silo', 'budget-service', 'budget-revision', 'budget-conversation', 'interactive', 'identity-budget-run', 'budget-service-principal', 'budget-group', 'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64), 'sha256:' || repeat('c', 64), subject, 'budget-run-request', 'sha256:' || repeat('d', 64));
    INSERT INTO "run_input_snapshots" ("id", "run_id", "attempt", "snapshot_version", "origin", "silo_id", "agent_service_id", "agent_revision_id", "agent_identity_id", "principal_id", "execution_subject", "conversation_id", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest")
    VALUES ('budget-run-snapshot', 'budget-run', 1, 4, '{"kind":"interactive","messageId":null,"historyRevision":null}', 'budget-silo', 'budget-service', 'budget-revision', 'identity-budget-run', 'budget-service-principal', subject, 'budget-conversation', '{}', '[]', '{}', '{"maxModelTurns":10,"maxCompletionTokens":1000,"maxCostUsdMicros":null,"maxToolInvocations":10,"maxLoopIterations":10,"wallClockDeadlineEpochMs":4102444800000}', 'prompt-v1', 'sha256:' || repeat('d', 64));
END;
$$;

SELECT pg_temp.seed_silo_model('budget-silo', 'budget-model');
SELECT pg_temp.seed_managed_service('budget-silo', 'budget-service', 'budget-model', 'budget-revision');
INSERT INTO "groups" ("id", "silo_id", "name", "membership_authority") VALUES ('budget-group', 'budget-silo', 'Budget group', 'local');
SELECT pg_temp.seed_budget_run();
INSERT INTO "model_eur_tariff_revisions" ("id", "silo_id", "model_definition_id", "revision", "digest", "token_unit", "max_input_tokens", "input_eur_micros_per_unit", "output_eur_micros_per_unit", "effective_at", "valid_until")
VALUES ('budget-tariff', 'budget-silo', 'budget-model', 1, 'sha256:' || repeat('e', 64), 1000000, 100000, 5, 10, TIMESTAMPTZ '2026-09-01 00:00:00+00', TIMESTAMPTZ '2026-10-01 00:00:00+00');

INSERT INTO "managed_budget_policies" ("id", "silo_id", "scope", "scope_key", "group_id", "agent_service_id", "limit_eur_micros", "updated_at") VALUES
    ('budget-policy-global', 'budget-silo', 'global', 'global', NULL, NULL, 1000000, clock_timestamp()),
    ('budget-policy-group', 'budget-silo', 'group', 'budget-group', 'budget-group', NULL, 1000000, clock_timestamp()),
    ('budget-policy-service', 'budget-silo', 'agent_service', 'budget-service', NULL, 'budget-service', 1000000, clock_timestamp());
INSERT INTO "managed_budget_policy_fences" ("policy_id", "revision") VALUES
    ('budget-policy-global', 1), ('budget-policy-group', 1), ('budget-policy-service', 1);
INSERT INTO "managed_budget_monthly_accounts" ("id", "silo_id", "policy_id", "period_start", "policy_revision", "limit_eur_micros") VALUES
    ('budget-account-global', 'budget-silo', 'budget-policy-global', TIMESTAMPTZ '2026-09-01 00:00:00+00', 1, 1000000),
    ('budget-account-group', 'budget-silo', 'budget-policy-group', TIMESTAMPTZ '2026-09-01 00:00:00+00', 1, 1000000),
    ('budget-account-service', 'budget-silo', 'budget-policy-service', TIMESTAMPTZ '2026-09-01 00:00:00+00', 1, 1000000);

INSERT INTO "managed_budget_effects" ("id", "silo_id", "run_id", "run_attempt", "paying_group_id", "agent_service_id", "logical_fence", "model_alias", "period_start", "tariff_revision_id", "tariff_revision", "tariff_digest", "quote_digest", "max_input_tokens", "max_completion_tokens", "worst_case_eur_micros", "state")
VALUES ('budget-effect', 'budget-silo', 'budget-run', 1, 'budget-group', 'budget-service', 'budget-logical-fence', 'budget-model', TIMESTAMPTZ '2026-09-01 00:00:00+00', 'budget-tariff', 1, 'sha256:' || repeat('e', 64), 'sha256:' || repeat('f', 64), 100000, 1000, 1, 'claimed');
UPDATE "managed_budget_monthly_accounts" SET "claimed_eur_micros" = 1 WHERE "silo_id" = 'budget-silo';
INSERT INTO "managed_budget_physical_attempts" ("id", "silo_id", "effect_id", "physical_nonce", "request_body_sha256", "deadline_epoch_ms", "claimed_at")
VALUES ('budget-attempt', 'budget-silo', 'budget-effect', repeat('1', 64), repeat('2', 64), 1798800000000, TIMESTAMPTZ '2026-09-30 10:00:00+00');
INSERT INTO "managed_budget_scope_impacts" ("effect_id", "account_id", "silo_id") VALUES
    ('budget-effect', 'budget-account-global', 'budget-silo'),
    ('budget-effect', 'budget-account-group', 'budget-silo'),
    ('budget-effect', 'budget-account-service', 'budget-silo');
SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.assert_true('valid policy targets retain their scope coordinates', (SELECT count(*) = 2 FROM "managed_budget_policies" WHERE "id" IN ('budget-policy-group', 'budget-policy-service') AND ("group_id" IS NOT NULL OR "agent_service_id" IS NOT NULL)));
SELECT pg_temp.assert_true('valid effect and attempt retain the same silo', (SELECT e."silo_id" = a."silo_id" FROM "managed_budget_effects" e JOIN "managed_budget_physical_attempts" a ON a."effect_id" = e."id" WHERE e."id" = 'budget-effect'));
SELECT pg_temp.assert_true('all counters start nonnegative', (SELECT bool_and("limit_eur_micros" >= 0 AND "settled_eur_micros" >= 0 AND "unknown_eur_micros" >= 0 AND "claimed_eur_micros" >= 0 AND "reserved_eur_micros" >= 0) FROM "managed_budget_monthly_accounts" WHERE "silo_id" = 'budget-silo'));

SELECT pg_temp.expect_constraint('policy group relation keeps its silo binding', $$INSERT INTO "managed_budget_policies" ("id", "silo_id", "scope", "scope_key", "group_id", "limit_eur_micros", "updated_at") VALUES ('budget-policy-cross-silo-group', 'other-silo', 'group', 'budget-group', 'budget-group', 1000000, clock_timestamp())$$, '23503', 'managed_budget_policies_group_id_silo_id_fkey');
SELECT pg_temp.expect_constraint('policy service relation keeps its silo binding', $$INSERT INTO "managed_budget_policies" ("id", "silo_id", "scope", "scope_key", "agent_service_id", "limit_eur_micros", "updated_at") VALUES ('budget-policy-cross-silo-service', 'other-silo', 'agent_service', 'budget-service', 'budget-service', 1000000, clock_timestamp())$$, '23503', 'managed_budget_policies_agent_service_id_silo_id_fkey');
SELECT pg_temp.expect_constraint('monthly account keeps its policy silo binding', $$INSERT INTO "managed_budget_monthly_accounts" ("id", "silo_id", "policy_id", "period_start", "policy_revision", "limit_eur_micros") VALUES ('budget-account-cross-silo', 'other-silo', 'budget-policy-global', TIMESTAMPTZ '2026-10-01 00:00:00+00', 1, 1000000)$$, '23503', 'managed_budget_monthly_accounts_policy_id_silo_id_fkey');
SELECT pg_temp.expect_constraint('effect requires its exact run silo binding', $$INSERT INTO "managed_budget_effects" ("id", "silo_id", "run_id", "run_attempt", "paying_group_id", "agent_service_id", "logical_fence", "model_alias", "period_start", "tariff_revision_id", "tariff_revision", "tariff_digest", "quote_digest", "max_input_tokens", "max_completion_tokens", "worst_case_eur_micros") VALUES ('budget-effect-missing-run', 'budget-silo', 'missing-run', 1, 'budget-group', 'budget-service', 'budget-logical-fence-missing-run', 'budget-model', TIMESTAMPTZ '2026-09-01 00:00:00+00', 'budget-tariff', 1, 'sha256:' || repeat('e', 64), 'sha256:' || repeat('f', 64), 100000, 1000, 1)$$, '23503', 'managed_budget_effects_run_id_silo_id_fkey');
SELECT pg_temp.expect_constraint('effect requires its exact tariff silo binding', $$INSERT INTO "managed_budget_effects" ("id", "silo_id", "run_id", "run_attempt", "paying_group_id", "agent_service_id", "logical_fence", "model_alias", "period_start", "tariff_revision_id", "tariff_revision", "tariff_digest", "quote_digest", "max_input_tokens", "max_completion_tokens", "worst_case_eur_micros") VALUES ('budget-effect-missing-tariff', 'budget-silo', 'budget-run', 1, 'budget-group', 'budget-service', 'budget-logical-fence-missing-tariff', 'budget-model', TIMESTAMPTZ '2026-09-01 00:00:00+00', 'missing-tariff', 1, 'sha256:' || repeat('e', 64), 'sha256:' || repeat('f', 64), 100000, 1000, 1)$$, '23503', 'managed_budget_effects_tariff_revision_id_silo_id_fkey');
SELECT pg_temp.expect_constraint('attempt keeps its effect silo binding', $$INSERT INTO "managed_budget_physical_attempts" ("id", "silo_id", "effect_id", "physical_nonce", "request_body_sha256", "deadline_epoch_ms", "claimed_at") VALUES ('budget-attempt-cross-silo', 'other-silo', 'budget-effect', repeat('3', 64), repeat('4', 64), 1798800000000, TIMESTAMPTZ '2026-09-30 10:00:00+00')$$, '23503', 'managed_budget_physical_attempts_effect_id_silo_id_fkey');
INSERT INTO "managed_budget_monthly_accounts" ("id", "silo_id", "policy_id", "period_start", "policy_revision", "limit_eur_micros") VALUES ('budget-account-scope', 'budget-silo', 'budget-policy-global', TIMESTAMPTZ '2026-10-01 00:00:00+00', 1, 1000000);
SELECT pg_temp.expect_constraint('scope impact requires its exact effect silo binding', $$INSERT INTO "managed_budget_scope_impacts" ("effect_id", "account_id", "silo_id") VALUES ('missing-effect', 'budget-account-scope', 'budget-silo')$$, '23503', 'managed_budget_scope_impacts_effect_id_silo_id_fkey');
SELECT pg_temp.expect_constraint('scope impact requires its exact account silo binding', $$INSERT INTO "managed_budget_scope_impacts" ("effect_id", "account_id", "silo_id") VALUES ('budget-effect', 'missing-account', 'budget-silo')$$, '23503', 'managed_budget_scope_impacts_account_id_silo_id_fkey');

SELECT pg_temp.expect_check('global policy cannot name a group target', $$SELECT pg_temp.insert_invalid_budget_policy('global', 'global', 'budget-group', NULL)$$, 'managed_budget_policies_scope_check');
SELECT pg_temp.expect_check('group policy requires exactly its group target tuple', $$SELECT pg_temp.insert_invalid_budget_policy('group', 'budget-group', NULL, NULL)$$, 'managed_budget_policies_scope_check');
SELECT pg_temp.expect_check('agent policy requires exactly its service target tuple', $$SELECT pg_temp.insert_invalid_budget_policy('agent_service', 'budget-service', 'budget-group', 'budget-service')$$, 'managed_budget_policies_scope_check');
SELECT pg_temp.expect_check('payer group and evidence are all-or-none', $$SELECT pg_temp.insert_invalid_budget_run(NULL, 'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64), 'sha256:' || repeat('c', 64))$$, 'agent_runs_paying_group_evidence_check');
SELECT pg_temp.expect_check('payer decision evidence is all-or-none', $$SELECT pg_temp.insert_invalid_budget_run('budget-group', NULL, 'sha256:' || repeat('b', 64), 'sha256:' || repeat('c', 64))$$, 'agent_runs_paying_group_evidence_check');
SELECT pg_temp.expect_check('payer policy evidence is all-or-none', $$SELECT pg_temp.insert_invalid_budget_run('budget-group', 'sha256:' || repeat('a', 64), NULL, 'sha256:' || repeat('c', 64))$$, 'agent_runs_paying_group_evidence_check');
SELECT pg_temp.expect_check('payer effective evidence is all-or-none', $$SELECT pg_temp.insert_invalid_budget_run('budget-group', 'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64), NULL)$$, 'agent_runs_paying_group_evidence_check');
SELECT pg_temp.expect_check('policy limit cannot be negative', $$SELECT pg_temp.insert_invalid_budget_policy('global', 'global', NULL, NULL, -1)$$, 'managed_budget_policies_scope_check');
SELECT pg_temp.expect_check('policy revision must be positive', $$SELECT pg_temp.insert_invalid_budget_policy('global', 'global', NULL, NULL, 1000000, 0)$$, 'managed_budget_policies_scope_check');
SELECT pg_temp.expect_check('policy fence revision cannot be negative', $$UPDATE "managed_budget_policy_fences" SET "revision" = -1 WHERE "policy_id" = 'budget-policy-global'$$, 'managed_budget_policy_fences_revision_check');

SELECT pg_temp.expect_check('monthly policy revision must be positive', $$SELECT pg_temp.insert_invalid_budget_account(policy_revision => 0)$$, 'managed_budget_monthly_accounts_values_check');
SELECT pg_temp.expect_check('monthly limit cannot be negative', $$SELECT pg_temp.insert_invalid_budget_account(limit_eur_micros => -1)$$, 'managed_budget_monthly_accounts_values_check');
SELECT pg_temp.expect_check('settled counter cannot be negative', $$SELECT pg_temp.insert_invalid_budget_account(settled_eur_micros => -1)$$, 'managed_budget_monthly_accounts_values_check');
SELECT pg_temp.expect_check('unknown counter cannot be negative', $$SELECT pg_temp.insert_invalid_budget_account(unknown_eur_micros => -1)$$, 'managed_budget_monthly_accounts_values_check');
SELECT pg_temp.expect_check('claimed counter cannot be negative', $$SELECT pg_temp.insert_invalid_budget_account(claimed_eur_micros => -1)$$, 'managed_budget_monthly_accounts_values_check');
SELECT pg_temp.expect_check('reserved counter cannot be negative', $$SELECT pg_temp.insert_invalid_budget_account(reserved_eur_micros => -1)$$, 'managed_budget_monthly_accounts_values_check');
SELECT pg_temp.expect_check('monthly revision cannot be negative', $$SELECT pg_temp.insert_invalid_budget_account(revision => -1)$$, 'managed_budget_monthly_accounts_values_check');
SELECT pg_temp.expect_check('monthly period begins at UTC month boundary', $$SELECT pg_temp.insert_invalid_budget_account(period_start => TIMESTAMPTZ '2026-11-02 00:00:00+00')$$, 'managed_budget_monthly_accounts_values_check');

SELECT pg_temp.expect_check('effect input ceiling must be positive', $$SELECT pg_temp.insert_invalid_budget_effect(max_input_tokens => 0)$$, 'managed_budget_effects_values_check');
SELECT pg_temp.expect_check('effect completion ceiling must be positive', $$SELECT pg_temp.insert_invalid_budget_effect(max_completion_tokens => 0)$$, 'managed_budget_effects_values_check');
SELECT pg_temp.expect_check('effect worst case cannot be negative', $$SELECT pg_temp.insert_invalid_budget_effect(worst_case_eur_micros => -1)$$, 'managed_budget_effects_values_check');
SELECT pg_temp.expect_check('actual input tokens cannot be negative', $$SELECT pg_temp.insert_invalid_budget_effect('settled', 100000, 1000, 1, 1, -1, 0, clock_timestamp())$$, 'managed_budget_effects_values_check');
SELECT pg_temp.expect_check('actual output tokens cannot be negative', $$SELECT pg_temp.insert_invalid_budget_effect('settled', 100000, 1000, 1, 1, 0, -1, clock_timestamp())$$, 'managed_budget_effects_values_check');
SELECT pg_temp.expect_check('terminal effect state needs terminal material', $$SELECT pg_temp.insert_invalid_budget_effect('settled', 100000, 1000, 1, 1, 0, 0, NULL)$$, 'managed_budget_effects_values_check');
SELECT pg_temp.expect_check('reserved effect cannot carry terminal material', $$SELECT pg_temp.insert_invalid_budget_effect('reserved', 100000, 1000, 1, NULL, NULL, NULL, clock_timestamp())$$, 'managed_budget_effects_values_check');
SELECT pg_temp.expect_check('actual usage evidence is all-or-none', $$SELECT pg_temp.insert_invalid_budget_effect('settled', 100000, 1000, 1, 1, 1, NULL, clock_timestamp())$$, 'managed_budget_effects_values_check');
SELECT pg_temp.expect_check('actual amount cannot be negative', $$SELECT pg_temp.insert_invalid_budget_effect('settled', 100000, 1000, 1, -1, 0, 0, clock_timestamp())$$, 'managed_budget_effects_values_check');

SELECT pg_temp.expect_check('physical deadline must be positive', $$SELECT pg_temp.insert_invalid_budget_attempt(deadline_epoch_ms => 0)$$, 'managed_budget_physical_attempts_values_check');
SELECT pg_temp.expect_check('claimed attempt cannot carry terminal material', $$SELECT pg_temp.insert_invalid_budget_attempt('claimed', 1798800000000, clock_timestamp())$$, 'managed_budget_physical_attempts_values_check');
SELECT pg_temp.expect_check('terminal attempt requires terminal material', $$SELECT pg_temp.insert_invalid_budget_attempt('settled', 1798800000000, NULL)$$, 'managed_budget_physical_attempts_values_check');

SELECT pg_temp.expect_check('tariff token unit is fixed to one million', $$SELECT pg_temp.insert_invalid_budget_tariff(token_unit => 1000)$$, 'model_eur_tariff_revisions_values_check');
SELECT pg_temp.expect_check('tariff revision must be positive', $$SELECT pg_temp.insert_invalid_budget_tariff(revision => 0)$$, 'model_eur_tariff_revisions_values_check');
SELECT pg_temp.expect_check('tariff input rate cannot be negative', $$SELECT pg_temp.insert_invalid_budget_tariff(input_rate => -1)$$, 'model_eur_tariff_revisions_values_check');
SELECT pg_temp.expect_check('tariff output rate cannot be negative', $$SELECT pg_temp.insert_invalid_budget_tariff(output_rate => -1)$$, 'model_eur_tariff_revisions_values_check');
SELECT pg_temp.expect_check('tariff input ceiling must be positive', $$SELECT pg_temp.insert_invalid_budget_tariff(max_input_tokens => 0)$$, 'model_eur_tariff_revisions_values_check');
SELECT pg_temp.expect_check('tariff validity window must increase', $$SELECT pg_temp.insert_invalid_budget_tariff(valid_until => TIMESTAMPTZ '2026-10-01 00:00:00+00')$$, 'model_eur_tariff_revisions_values_check');

SELECT pg_temp.expect_message('payer evidence is immutable after admission', $$UPDATE "agent_runs" SET "paying_group_authorization_decision_digest" = 'sha256:' || repeat('6', 64) WHERE "id" = 'budget-run'$$, 'P0001', 'AgentRun identity and accepted inputs are immutable');
SELECT pg_temp.expect_message('policy scope identity is immutable', $$UPDATE "managed_budget_policies" SET "scope_key" = 'different-group' WHERE "id" = 'budget-policy-group'$$, 'P0001', 'ManagedBudgetPolicy scope identity is immutable');
SELECT pg_temp.expect_message('tariff rows are immutable', $$UPDATE "model_eur_tariff_revisions" SET "input_eur_micros_per_unit" = 6 WHERE "id" = 'budget-tariff'$$, 'P0001', 'ModelEurTariffRevision rows are immutable');
SELECT pg_temp.expect_message('effect monetary coordinates are immutable', $$UPDATE "managed_budget_effects" SET "worst_case_eur_micros" = 2 WHERE "id" = 'budget-effect'$$, 'P0001', 'ManagedBudgetEffect monetary coordinates are immutable');
SELECT pg_temp.expect_message('effect lifecycle rejects a no-op transition', $$UPDATE "managed_budget_effects" SET "state" = 'claimed' WHERE "id" = 'budget-effect'$$, 'P0001', 'ManagedBudgetEffect lifecycle transition is invalid');
SELECT pg_temp.expect_message('physical claim coordinates are immutable', $$UPDATE "managed_budget_physical_attempts" SET "deadline_epoch_ms" = 1798800000001 WHERE "id" = 'budget-attempt'$$, 'P0001', 'ManagedBudgetPhysicalAttempt transition must preserve its exact claim');
UPDATE "managed_budget_monthly_accounts" SET "settled_eur_micros" = 1 WHERE "id" = 'budget-account-scope';
SELECT pg_temp.expect_message('incurred monthly liability cannot decrease', $$UPDATE "managed_budget_monthly_accounts" SET "settled_eur_micros" = 0 WHERE "id" = 'budget-account-scope'$$, 'P0001', 'ManagedBudgetMonthlyAccount ownership, incurred liability and durable closure cannot be reversed');
UPDATE "managed_budget_monthly_accounts" SET "unknown_eur_micros" = 1, "admission_closed_at" = clock_timestamp() WHERE "id" = 'budget-account-scope';
SELECT pg_temp.expect_message('unknown monthly liability cannot decrease', $$UPDATE "managed_budget_monthly_accounts" SET "unknown_eur_micros" = 0 WHERE "id" = 'budget-account-scope'$$, 'P0001', 'ManagedBudgetMonthlyAccount ownership, incurred liability and durable closure cannot be reversed');
SELECT pg_temp.expect_message('durable admission closure cannot reopen', $$UPDATE "managed_budget_monthly_accounts" SET "admission_closed_at" = NULL WHERE "id" = 'budget-account-scope'$$, 'P0001', 'ManagedBudgetMonthlyAccount ownership, incurred liability and durable closure cannot be reversed');
SELECT pg_temp.expect_message('scope impacts are immutable', $$DELETE FROM "managed_budget_scope_impacts" WHERE "effect_id" = 'budget-effect' AND "account_id" = 'budget-account-global'$$, 'P0001', 'ManagedBudgetScopeImpact rows are immutable');

SELECT pg_temp.expect_constraint('scope impacts remain unique per effect and account', $$INSERT INTO "managed_budget_scope_impacts" ("effect_id", "account_id", "silo_id") VALUES ('budget-effect', 'budget-account-global', 'budget-silo')$$, '23505', 'managed_budget_scope_impacts_pkey');

UPDATE "managed_budget_physical_attempts" SET "state" = 'settled', "terminal_at" = clock_timestamp() WHERE "id" = 'budget-attempt';
UPDATE "managed_budget_effects" SET "state" = 'settled', "terminal_at" = clock_timestamp(), "actual_eur_micros" = 1, "actual_input_tokens" = 100000, "actual_output_tokens" = 1000 WHERE "id" = 'budget-effect';
UPDATE "managed_budget_monthly_accounts" SET "claimed_eur_micros" = 0, "settled_eur_micros" = 1 WHERE "id" IN ('budget-account-global', 'budget-account-group', 'budget-account-service');
SELECT pg_temp.assert_true('valid settlement preserves one known liability across every scope', (SELECT count(*) = 3 FROM "managed_budget_scope_impacts" impact JOIN "managed_budget_monthly_accounts" account ON account."id" = impact."account_id" WHERE impact."effect_id" = 'budget-effect' AND account."claimed_eur_micros" = 0 AND account."settled_eur_micros" = 1));

ROLLBACK;
