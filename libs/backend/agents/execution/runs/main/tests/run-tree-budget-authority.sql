BEGIN;

SELECT pg_temp.seed_silo_model('tree-silo', 'tree-model');
SELECT pg_temp.seed_managed_service('tree-silo', 'tree-service', 'tree-model', 'tree-revision');
SELECT set_config('opencrane.tree_test_deadline', (date_trunc('milliseconds', clock_timestamp()) + interval '1 hour')::TEXT, TRUE);

-- Each account has a real run and its immutable snapshot; none of these rows admits a child workflow.
CREATE FUNCTION pg_temp.seed_tree_run(run_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    subject JSONB := jsonb_build_object('runScope', jsonb_build_object('runId', run_id, 'attempt', 1), 'requester', jsonb_build_object('requesterPrincipalId', 'tree-requester'));
    digest TEXT := 'sha256:' || encode(sha256(convert_to(run_id, 'UTF8')), 'hex');
    budget JSONB := jsonb_build_object('maxModelTurns', 100, 'maxCompletionTokens', 1000, 'maxToolInvocations', 100, 'maxLoopIterations', 100, 'maxCostUsdMicros', 1000000, 'wallClockDeadlineEpochMs', (extract(epoch FROM current_setting('opencrane.tree_test_deadline')::TIMESTAMP) * 1000)::BIGINT);
BEGIN
    PERFORM pg_temp.seed_agent_conversation(run_id || '-conversation', 'tree-silo', 'tree-service');
    INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest", "workflow_task_id", "workflow_task_name", "workflow_task_key")
    VALUES (run_id, 'tree-silo', 'tree-service', 'tree-revision', run_id || '-conversation', 'interactive', 'tree-identity', 'tree-service-principal', subject, run_id, digest, md5(run_id)::UUID::TEXT, 'conversation-computer-turn', md5(run_id || '-workflow')::UUID::TEXT);
    INSERT INTO "run_input_snapshots" ("id", "run_id", "attempt", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "agent_identity_id", "principal_id", "execution_subject", "conversation_id", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest")
    VALUES (run_id || '-snapshot', run_id, 1, 1, 'tree-silo', 'tree-service', 'tree-revision', 'tree-identity', 'tree-service-principal', subject, run_id || '-conversation', '{}', '[]', '{}', budget, 'prompt-v1', digest);
END;
$$;

CREATE FUNCTION pg_temp.open_tree_account(run_id TEXT, parent_id TEXT DEFAULT NULL, root_id TEXT DEFAULT NULL, units INTEGER DEFAULT 10) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "agent_run_tree_accounts" ("run_id", "root_run_id", "parent_run_id", "admission_key", "admission_digest", "deadline_at", "allocated_model_calls", "allocated_completion_tokens", "allocated_tool_invocations", "allocated_loop_iterations", "allocated_cost_micros", "available_model_calls", "available_completion_tokens", "available_tool_invocations", "available_loop_iterations", "available_cost_micros")
    VALUES (run_id, COALESCE(root_id, run_id), parent_id, run_id, 'sha256:' || repeat('a', 64), current_setting('opencrane.tree_test_deadline')::TIMESTAMP,
        CASE WHEN parent_id IS NULL THEN 100 ELSE units END, CASE WHEN parent_id IS NULL THEN 1000 ELSE units END, CASE WHEN parent_id IS NULL THEN 100 ELSE units END, CASE WHEN parent_id IS NULL THEN 100 ELSE units END, CASE WHEN parent_id IS NULL THEN 1000000 ELSE units END,
        CASE WHEN parent_id IS NULL THEN 100 ELSE units END, CASE WHEN parent_id IS NULL THEN 1000 ELSE units END, CASE WHEN parent_id IS NULL THEN 100 ELSE units END, CASE WHEN parent_id IS NULL THEN 100 ELSE units END, CASE WHEN parent_id IS NULL THEN 1000000 ELSE units END);
END;
$$;

CREATE FUNCTION pg_temp.reserve_tree_work(reservation_id TEXT, run_id TEXT, units INTEGER DEFAULT 1) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "agent_run_tree_reservations" ("id", "run_id", "idempotency_key", "command_digest", "model_calls", "completion_tokens", "tool_invocations", "loop_iterations", "cost_micros")
    VALUES (reservation_id, run_id, reservation_id, 'sha256:' || repeat('b', 64), units, units, units, units, units);
END;
$$;

CREATE FUNCTION pg_temp.stop_tree_run(run_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    command_id TEXT := md5(run_id || '-stop')::UUID::TEXT;
    command_digest TEXT := 'sha256:' || encode(sha256(convert_to(command_id, 'UTF8')), 'hex');
    decision_digest TEXT := 'sha256:' || encode(sha256(convert_to(command_id || '-decision', 'UTF8')), 'hex');
BEGIN
    INSERT INTO "audit_decisions" ("id", "decision_digest", "silo_id", "actor_kind", "actor_id", "resource_kind", "resource_id", "action", "catalog_id", "catalog_revision", "catalog_digest", "arguments_digest", "policy_revision_hash", "effective_authorization_digest", "outcome", "reason_code")
    VALUES (run_id || '-stop-audit', decision_digest, 'tree-silo', 'user', 'tree-requester', 'conversation', run_id || '-conversation', 'use', 'tree-test-catalog', 1, 'sha256:' || repeat('c', 64), command_digest, 'sha256:' || repeat('d', 64), 'sha256:' || repeat('e', 64), 'allow', 'requester_stop');
    UPDATE "agent_runs" SET "state" = 'cancelling', "cancellation_command_id" = command_id, "cancellation_command_digest" = command_digest,
        "cancellation_bootstrap_id" = md5(run_id || '-bootstrap')::UUID::TEXT, "cancellation_requested_by_principal_id" = 'tree-requester', "cancellation_requested_at" = clock_timestamp(),
        "cancellation_authorization_decision_digest" = decision_digest, "cancellation_workflow_task_id" = md5(run_id || '-stop-workflow')::UUID::TEXT,
        "cancellation_workflow_task_name" = 'conversation-computer-stop', "cancellation_workflow_task_key" = command_id WHERE "id" = run_id;
END;
$$;

SELECT pg_temp.seed_tree_run('tree-root');
SELECT pg_temp.open_tree_account('tree-root');
DO $$
DECLARE ordinal INTEGER; parent_id TEXT := 'tree-root';
BEGIN
    FOR ordinal IN 1..6 LOOP
        PERFORM pg_temp.seed_tree_run('tree-sibling-' || ordinal);
        PERFORM pg_temp.open_tree_account('tree-sibling-' || ordinal, 'tree-root', 'tree-root');
    END LOOP;
    parent_id := 'tree-sibling-1';
    FOR ordinal IN 1..6 LOOP
        PERFORM pg_temp.seed_tree_run('tree-descendant-' || ordinal);
        PERFORM pg_temp.open_tree_account('tree-descendant-' || ordinal, parent_id, 'tree-root');
        parent_id := 'tree-descendant-' || ordinal;
    END LOOP;
END;
$$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.assert_true('six siblings and six nested descendants are admitted without policy caps', (SELECT count(*) = 13 FROM "agent_run_tree_accounts" WHERE "root_run_id" = 'tree-root'));
SELECT pg_temp.assert_true('child allocations conserve the original model allowance', (SELECT sum("available_model_calls") = 100 FROM "agent_run_tree_accounts" WHERE "root_run_id" = 'tree-root'));
SELECT pg_temp.reserve_tree_work('deep-operation', 'tree-descendant-6', 2);
SELECT pg_temp.assert_true('local spending and subtree allocations share the same original allowance', (SELECT sum("available_model_calls") = 98 FROM "agent_run_tree_accounts" WHERE "root_run_id" = 'tree-root'));
SELECT pg_temp.expect_failure('duplicate reservations cannot spend twice', $$SELECT pg_temp.reserve_tree_work('deep-operation', 'tree-descendant-6', 2)$$, 'duplicate key');
SELECT pg_temp.assert_true('a rejected duplicate rolls its debit back', (SELECT "available_model_calls" = 8 FROM "agent_run_tree_accounts" WHERE "run_id" = 'tree-descendant-6'));
SELECT pg_temp.expect_failure('a retry with a changed amount cannot replace the reservation', $$UPDATE "agent_run_tree_reservations" SET "model_calls" = 3 WHERE "id" = 'deep-operation'$$, 'spending reservations are immutable');
SELECT pg_temp.expect_failure('uncertain spending cannot be refunded by deletion', $$DELETE FROM "agent_run_tree_reservations" WHERE "id" = 'deep-operation'$$, 'spending reservations are immutable');
SELECT pg_temp.expect_failure('direct balance changes cannot mint spending authority', $$UPDATE "agent_run_tree_accounts" SET "available_model_calls" = 9 WHERE "run_id" = 'tree-descendant-6'$$, 'available allowance is debited only by admission');
SELECT pg_temp.expect_failure('a child cannot be reparented', $$UPDATE "agent_run_tree_accounts" SET "parent_run_id" = 'tree-sibling-2' WHERE "run_id" = 'tree-descendant-1'$$, 'lineage and allocated allowance are immutable');
SELECT pg_temp.expect_failure('root allowance cannot be enlarged', $$UPDATE "agent_run_tree_accounts" SET "allocated_model_calls" = 101 WHERE "run_id" = 'tree-root'$$, 'lineage and allocated allowance are immutable');
SELECT pg_temp.expect_failure('overspending a leaf is rejected', $$SELECT pg_temp.reserve_tree_work('overspend', 'tree-descendant-6', 9)$$, 'insufficient unreserved allowance');
SELECT pg_temp.expect_failure('fabricated Stop evidence cannot close an account', $$UPDATE "agent_run_tree_accounts" SET "closed_at" = clock_timestamp(), "closure_source_run_id" = 'tree-root', "closure_reason" = 'authorized_stop' WHERE "run_id" = 'tree-sibling-2'$$, 'closure requires saved ancestor Stop');
SELECT pg_temp.expect_failure('a sibling is not an ancestor', $$UPDATE "agent_run_tree_accounts" SET "closed_at" = clock_timestamp(), "closure_source_run_id" = 'tree-sibling-2', "closure_reason" = 'terminal_run' WHERE "run_id" = 'tree-sibling-3'$$, 'closure source must be this run or an ancestor');
SELECT pg_temp.expect_failure('deadline closure cannot be fabricated early', $$UPDATE "agent_run_tree_accounts" SET "closed_at" = clock_timestamp(), "closure_source_run_id" = 'tree-root', "closure_reason" = 'deadline' WHERE "run_id" = 'tree-root'$$, 'closure requires saved ancestor Stop');
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.seed_tree_run('tree-oversized-child');
SELECT pg_temp.expect_failure('a child cannot duplicate its parent allocation', $$SELECT pg_temp.open_tree_account('tree-oversized-child', 'tree-root', 'tree-root', 41)$$, 'insufficient unreserved allowance');
SELECT pg_temp.seed_tree_run('tree-wrong-root');
SELECT pg_temp.expect_failure('a child cannot claim a different root', $$SELECT pg_temp.open_tree_account('tree-wrong-root', 'tree-root', 'tree-sibling-2', 1)$$, 'preserve its parent root');
SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.stop_tree_run('tree-sibling-1');
SELECT pg_temp.expect_failure('ancestor Stop fences deep work before asynchronous account closure', $$SELECT pg_temp.reserve_tree_work('after-branch-stop', 'tree-descendant-6')$$, 'ancestor no longer accepts work');
UPDATE "agent_run_tree_accounts" SET "closed_at" = clock_timestamp(), "closure_source_run_id" = 'tree-sibling-1', "closure_reason" = 'authorized_stop' WHERE "run_id" = 'tree-descendant-6';
SELECT pg_temp.assert_true('inherited Stop does not impersonate a new requester command', (SELECT "cancellation_command_id" IS NULL FROM "agent_runs" WHERE "id" = 'tree-descendant-6'));
SELECT pg_temp.reserve_tree_work('unrelated-sibling-operation', 'tree-sibling-2');
SELECT pg_temp.expect_failure('Stop closure cannot reopen after restart', $$UPDATE "agent_run_tree_accounts" SET "closed_at" = NULL, "closure_source_run_id" = NULL, "closure_reason" = NULL WHERE "run_id" = 'tree-descendant-6'$$, 'closure cannot be replaced or reopened');
SELECT pg_temp.stop_tree_run('tree-root');
SELECT pg_temp.expect_failure('root Stop fences an otherwise active sibling', $$SELECT pg_temp.reserve_tree_work('after-root-stop', 'tree-sibling-3')$$, 'ancestor no longer accepts work');
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.seed_tree_run('tree-racing-child');
SELECT pg_temp.expect_failure('a child losing the Stop race cannot acquire an account', $$SELECT pg_temp.open_tree_account('tree-racing-child', 'tree-sibling-3', 'tree-root', 1)$$, 'ancestor no longer accepts work');
SELECT pg_temp.assert_true('the refused child has no allocation receipt', NOT EXISTS (SELECT 1 FROM "agent_run_tree_accounts" WHERE "run_id" = 'tree-racing-child'));

SELECT pg_temp.seed_tree_run('tree-legacy-key');
INSERT INTO "run_model_credential_mint_authorizations" ("id", "run_id", "attempt", "generation", "principal_id", "model_definition_id", "authorization_digest", "key_alias", "expires_at")
VALUES ('tree-legacy-mint', 'tree-legacy-key', 1, 1, 'tree-service-principal', 'tree-model', 'sha256:' || repeat('f', 64), 'tree-legacy-alias', clock_timestamp() + interval '1 hour');
SELECT pg_temp.expect_failure('an issued full-attempt key cannot acquire a second allocation', $$SELECT pg_temp.open_tree_account('tree-legacy-key')$$, 'cannot adopt existing spending authority');
SELECT pg_temp.expect_failure('an account cannot receive the old full-attempt key', $$INSERT INTO "run_model_credential_mint_authorizations" ("id", "run_id", "attempt", "generation", "principal_id", "model_definition_id", "authorization_digest", "key_alias", "expires_at") VALUES ('tree-forbidden-mint', 'tree-sibling-4', 1, 1, 'tree-service-principal', 'tree-model', 'sha256:' || repeat('f', 64), 'tree-forbidden-alias', clock_timestamp() + interval '1 hour')$$, 'require reservation-scoped authority');

SELECT pg_temp.seed_tree_run('tree-terminal-root');
SELECT pg_temp.open_tree_account('tree-terminal-root');
UPDATE "agent_runs" SET "state" = 'failed', "finished_at" = clock_timestamp(), "terminal_reason" = 'runtime_failure' WHERE "id" = 'tree-terminal-root';
SELECT pg_temp.expect_failure('parent terminal failure also closes work admission', $$SELECT pg_temp.reserve_tree_work('after-terminal', 'tree-terminal-root')$$, 'ancestor no longer accepts work');
UPDATE "agent_run_tree_accounts" SET "closed_at" = clock_timestamp(), "closure_source_run_id" = 'tree-terminal-root', "closure_reason" = 'terminal_run' WHERE "run_id" = 'tree-terminal-root';
SELECT pg_temp.assert_true('closure records a fence without finalizing descendants', (SELECT "closure_reason" = 'terminal_run' AND "closed_at" IS NOT NULL FROM "agent_run_tree_accounts" WHERE "run_id" = 'tree-terminal-root'));
SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;
