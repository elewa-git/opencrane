BEGIN;

SELECT pg_temp.seed_silo_model('routine-silo', 'routine-model');
SELECT pg_temp.seed_external_user('routine-silo', 'routine-requester');
SELECT pg_temp.seed_external_user('routine-silo', 'later-reader');
SELECT pg_temp.seed_managed_service('routine-silo', 'routine-service', 'routine-model', 'routine-agent-revision');
SELECT pg_temp.seed_direct_conversation('routine-destination', 'routine-silo');

INSERT INTO "agent_routines" (
    "id", "silo_id", "original_requester_principal_id", "requester_issuer", "requester_subject_id", "requester_authenticated_at",
    "destination_conversation_id", "selected_managed_service_id", "automatic_enabled_after", "next_automatic_occurrence", "created_at", "updated_at"
) VALUES (
    'routine-1', 'routine-silo', 'routine-requester', 'https://identity.example.test', 'routine-requester', '2026-01-01T00:00:00Z',
    'routine-destination', 'routine-service', clock_timestamp() - INTERVAL '1 hour', clock_timestamp() + INTERVAL '1 hour', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_routine_revisions" (
    "id", "silo_id", "routine_id", "revision", "schedule_expression", "schedule_timezone", "instruction_key_id", "instruction_nonce",
    "instruction_auth_tag", "instruction_ciphertext", "instruction_ciphertext_digest", "audience_principal_ids", "created_by_principal_id", "created_at"
) VALUES (
    'routine-revision-1', 'routine-silo', 'routine-1', 1, '0 9 * * *', 'Africa/Nairobi', 'key-1', decode(repeat('00', 12), 'hex'),
    decode(repeat('00', 16), 'hex'), decode('01', 'hex'), 'sha256:' || encode(sha256(decode('01', 'hex')), 'hex'), ARRAY['routine-requester'], 'routine-requester', clock_timestamp()
);
SELECT pg_temp.expect_failure('active routine cannot commit before saving its schedule task',
    'SET CONSTRAINTS agent_routines_schedule_complete IMMEDIATE', 'Active routine requires its saved next-slot workflow receipt');
UPDATE "agent_routines" SET "schedule_task_id" = 'routine-task', "schedule_task_name" = 'routine-schedule', "schedule_task_key" = 'routine-task-key' WHERE "id" = 'routine-1';
SET CONSTRAINTS ALL IMMEDIATE;

SELECT pg_temp.expect_failure('routine cannot change its requester provenance',
    $$UPDATE "agent_routines" SET "requester_authenticated_at" = clock_timestamp() WHERE "id" = 'routine-1'$$,
    'Routine requester, destination and selected service are immutable');
SELECT pg_temp.expect_failure('routine instructions are immutable',
    $$UPDATE "agent_routine_revisions" SET "schedule_expression" = '0 10 * * *' WHERE "id" = 'routine-revision-1'$$,
    'Routine revisions are immutable');
SELECT pg_temp.expect_failure('a later revision cannot expose history to another reader',
    $$INSERT INTO "agent_routine_revisions" SELECT 'routine-revision-2', "silo_id", "routine_id", 2, "schedule_expression", "schedule_timezone",
        "instruction_key_id", "instruction_nonce", "instruction_auth_tag", "instruction_ciphertext", "instruction_ciphertext_digest",
        ARRAY['routine-requester', 'later-reader'], "created_by_principal_id", clock_timestamp() FROM "agent_routine_revisions" WHERE "id" = 'routine-revision-1'$$,
    'Routine revisions cannot change the confirmed audience');

-- The helper creates independent manual occurrences, including two simultaneous active runs.
CREATE FUNCTION pg_temp.seed_manual_routine_run(run_identifier TEXT, origin_patch JSONB DEFAULT '{}'::jsonb) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    firing_identifier TEXT := run_identifier || '-firing';
    conversation_identifier TEXT := run_identifier || '-conversation';
    input_digest TEXT := 'sha256:' || encode(sha256(convert_to(run_identifier, 'UTF8')), 'hex');
    subject JSONB := '{"principalId":"routine-service-principal","requester":{"requesterPrincipalId":"routine-requester"},"runScope":{"attempt":1}}';
    origin JSONB;
BEGIN
    SET CONSTRAINTS ALL DEFERRED;
    PERFORM pg_temp.seed_agent_conversation(conversation_identifier, 'routine-silo', 'routine-service');
    INSERT INTO "agent_routine_firings" ("id", "silo_id", "routine_id", "routine_revision", "trigger", "requester_principal_id", "conversation_id",
        "disposition", "firing_key", "workflow_task_id", "workflow_task_name", "workflow_task_key", "created_at", "updated_at")
    VALUES (firing_identifier, 'routine-silo', 'routine-1', 1, 'manual', 'routine-requester', conversation_identifier,
        'preparing', run_identifier, run_identifier || '-task', 'routine-occurrence', run_identifier || '-task-key', clock_timestamp(), clock_timestamp());
    UPDATE "agent_routine_firings" SET "preparation_receipt" = '{"receiptId":"prepared"}', "activation_receipt" = '{"receiptId":"activated"}' WHERE "id" = firing_identifier;
    INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "routine_firing_id", "routine_id", "routine_revision",
        "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest")
    VALUES (run_identifier, 'routine-silo', 'routine-service', 'routine-agent-revision', conversation_identifier, 'manual', firing_identifier, 'routine-1', 1,
        run_identifier || '-identity', 'routine-service-principal', subject, run_identifier, input_digest);
    origin := jsonb_build_object('kind', 'manual', 'routineId', 'routine-1', 'routineRevision', 1, 'firingId', firing_identifier, 'scheduledSlot', NULL,
        'requesterPrincipalId', 'routine-requester', 'requesterIssuer', 'https://identity.example.test', 'requesterSubjectId', 'routine-requester',
        'requesterAuthenticatedAt', '2026-01-01T00:00:00.000Z', 'workflowTaskId', run_identifier || '-task', 'workflowTaskName', 'routine-occurrence', 'workflowTaskKey', run_identifier || '-task-key') || origin_patch;
    INSERT INTO "run_input_snapshots" ("id", "run_id", "attempt", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "agent_identity_id", "principal_id",
        "execution_subject", "conversation_id", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest", "origin")
    VALUES (run_identifier || '-snapshot', run_identifier, 1, 4, 'routine-silo', 'routine-service', 'routine-agent-revision', run_identifier || '-identity',
        'routine-service-principal', subject, conversation_identifier, '{}', '[]', '{}', '{}', 'prompt-v1', input_digest, origin);
    UPDATE "agent_routine_firings" SET "run_id" = run_identifier WHERE "id" = firing_identifier;
    SET CONSTRAINTS ALL IMMEDIATE;
END;
$$;

SELECT pg_temp.seed_manual_routine_run('manual-one');
SELECT pg_temp.seed_manual_routine_run('manual-two');
SELECT pg_temp.assert_true('manual occurrences admit independent overlapping root runs', (SELECT count(*) = 2 FROM "agent_runs" WHERE "routine_id" = 'routine-1'));
SELECT pg_temp.expect_failure('an already admitted run cannot become a pre-admission refusal',
    $$UPDATE "agent_routine_firings" SET "disposition" = 'refused', "refusal_reason" = 'permission-revoked', "finished_at" = clock_timestamp() WHERE "id" = 'manual-two-firing'$$,
    'Refused routine firing cannot have an admitted run');

INSERT INTO "agent_routine_firings" ("id", "silo_id", "routine_id", "routine_revision", "trigger", "requester_principal_id", "conversation_id",
    "disposition", "firing_key", "workflow_task_id", "workflow_task_name", "workflow_task_key", "created_at", "updated_at")
VALUES ('revoked-before-run', 'routine-silo', 'routine-1', 1, 'manual', 'routine-requester', 'routine-destination',
    'preparing', 'revoked-before-run', 'revoked-task', 'routine-occurrence', 'revoked-task-key', clock_timestamp(), clock_timestamp());
UPDATE "agent_routine_firings" SET "preparation_receipt" = '{"receiptId":"prepared"}', "activation_receipt" = '{"receiptId":"activated"}' WHERE "id" = 'revoked-before-run';
SELECT pg_temp.expect_failure('a stage refusal must retain a reason',
    $$UPDATE "agent_routine_firings" SET "disposition" = 'refused', "finished_at" = clock_timestamp() WHERE "id" = 'revoked-before-run'$$,
    'agent_routine_firings_material_check');
UPDATE "agent_routine_firings" SET "disposition" = 'refused', "refusal_reason" = 'run-admission:permission-revoked', "finished_at" = clock_timestamp() WHERE "id" = 'revoked-before-run';
SELECT pg_temp.assert_true('a revoked preparation retains its receipts without admitting a run',
    (SELECT "run_id" IS NULL AND "preparation_receipt" IS NOT NULL AND "activation_receipt" IS NOT NULL AND "disposition" = 'refused' FROM "agent_routine_firings" WHERE "id" = 'revoked-before-run'));
SELECT pg_temp.expect_failure('a refused firing cannot restart preparation',
    $$UPDATE "agent_routine_firings" SET "disposition" = 'preparing', "finished_at" = NULL WHERE "id" = 'revoked-before-run'$$,
    'Terminal routine firing evidence is immutable');
SELECT pg_temp.expect_failure('a routine run requires a non-null revision even when other coordinates exist',
    $$INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "routine_firing_id", "routine_id", "routine_revision", "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest")
        VALUES ('missing-routine-revision', 'routine-silo', 'routine-service', 'routine-agent-revision', 'manual-one-conversation', 'manual', 'manual-one-firing', 'routine-1', NULL, 'manual-one-identity', 'routine-service-principal', '{}', 'missing-routine-revision', 'sha256:' || repeat('e', 64))$$,
    'agent_runs_routine_origin_check');
SELECT pg_temp.expect_failure('a saved occurrence cannot move to another task',
    $$UPDATE "agent_routine_firings" SET "workflow_task_key" = 'other-task' WHERE "id" = 'manual-one-firing'$$,
    'Routine firing identity and saved receipts are immutable');
SELECT pg_temp.expect_failure('a saved occurrence cannot be rebound to another run',
    $$UPDATE "agent_routine_firings" SET "run_id" = 'manual-two' WHERE "id" = 'manual-one-firing'$$,
    'Routine firing identity and saved receipts are immutable');
SELECT pg_temp.expect_failure('manual origin cannot claim an automatic slot',
    $$SELECT pg_temp.seed_manual_routine_run('wrong-slot', '{"scheduledSlot":"2026-01-01T09:00:00.000Z"}')$$,
    'Routine snapshot origin requires the exact firing, managed agent and original requester');
SELECT pg_temp.expect_failure('origin cannot replace the original requester',
    $$SELECT pg_temp.seed_manual_routine_run('wrong-requester', '{"requesterPrincipalId":"later-reader"}')$$,
    'Routine snapshot origin requires the exact firing, managed agent and original requester');
SELECT pg_temp.expect_failure('origin cannot substitute another occurrence workflow',
    $$SELECT pg_temp.seed_manual_routine_run('wrong-workflow', '{"workflowTaskKey":"other-task"}')$$,
    'Routine snapshot origin requires the exact firing, managed agent and original requester');
SELECT pg_temp.expect_failure('routine snapshot cannot be presented as interactive',
    $$SELECT pg_temp.seed_manual_routine_run('wrong-trigger', '{"kind":"interactive"}')$$,
    'RunInputSnapshot requires version 4 and its exact run trigger origin');
SELECT pg_temp.expect_failure('an admitted run cannot change routine coordinates',
    $$UPDATE "agent_runs" SET "routine_revision" = 2 WHERE "id" = 'manual-one'$$,
    'AgentRun identity and accepted inputs are immutable');

SELECT pg_temp.expect_failure('a routine proposal cannot substitute another source conversation',
    $$INSERT INTO "agent_routine_proposals" (
        "id", "silo_id", "source_conversation_id", "source_run_id", "source_run_attempt", "source_ordinal", "requester_principal_id",
        "suggestion_key_id", "suggestion_nonce", "suggestion_auth_tag", "suggestion_ciphertext", "suggestion_ciphertext_digest",
        "arguments_digest", "created_at", "expires_at"
    ) VALUES (
        'proposal-wrong-conversation', 'routine-silo', 'routine-destination', 'manual-one', 1, 1, 'routine-requester',
        'proposal-key', decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), decode('01', 'hex'),
        'sha256:' || encode(sha256(decode('01', 'hex')), 'hex'), 'sha256:' || repeat('a', 64), '2000-01-01', '2000-01-02'
    )$$,
    'AgentRoutineProposal requires its exact source run, conversation and requester');
SELECT pg_temp.expect_failure('a routine proposal cannot substitute another requester',
    $$INSERT INTO "agent_routine_proposals" (
        "id", "silo_id", "source_conversation_id", "source_run_id", "source_run_attempt", "source_ordinal", "requester_principal_id",
        "suggestion_key_id", "suggestion_nonce", "suggestion_auth_tag", "suggestion_ciphertext", "suggestion_ciphertext_digest",
        "arguments_digest", "created_at", "expires_at"
    ) VALUES (
        'proposal-wrong-requester', 'routine-silo', 'manual-one-conversation', 'manual-one', 1, 1, 'later-reader',
        'proposal-key', decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), decode('01', 'hex'),
        'sha256:' || encode(sha256(decode('01', 'hex')), 'hex'), 'sha256:' || repeat('a', 64), '2000-01-01', '2000-01-02'
    )$$,
    'AgentRoutineProposal requires its exact source run, conversation and requester');

INSERT INTO "agent_routine_proposals" (
    "id", "silo_id", "source_conversation_id", "source_run_id", "source_run_attempt", "source_ordinal", "requester_principal_id",
    "suggestion_key_id", "suggestion_nonce", "suggestion_auth_tag", "suggestion_ciphertext", "suggestion_ciphertext_digest",
    "arguments_digest", "created_at", "expires_at"
) VALUES (
    'proposal-1', 'routine-silo', 'manual-one-conversation', 'manual-one', 1, 1, 'routine-requester',
    'proposal-key', decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), decode('01', 'hex'),
    'sha256:' || encode(sha256(decode('01', 'hex')), 'hex'), 'sha256:' || repeat('a', 64), '2000-01-01', '2000-01-02'
);
SELECT pg_temp.assert_true('proposal creation and expiry are stamped by the database',
    (SELECT "created_at" <> '2000-01-01'::TIMESTAMP AND "expires_at" = "created_at" + INTERVAL '24 hours'
     FROM "agent_routine_proposals" WHERE "id" = 'proposal-1'));
SELECT pg_temp.expect_failure('a proposal source slot cannot be replayed by another identifier',
    $$INSERT INTO "agent_routine_proposals" (
        "id", "silo_id", "source_conversation_id", "source_run_id", "source_run_attempt", "source_ordinal", "requester_principal_id",
        "suggestion_key_id", "suggestion_nonce", "suggestion_auth_tag", "suggestion_ciphertext", "suggestion_ciphertext_digest",
        "arguments_digest", "created_at", "expires_at"
    ) SELECT 'proposal-replay', "silo_id", "source_conversation_id", "source_run_id", "source_run_attempt", "source_ordinal", "requester_principal_id",
        "suggestion_key_id", "suggestion_nonce", "suggestion_auth_tag", "suggestion_ciphertext", "suggestion_ciphertext_digest",
        "arguments_digest", clock_timestamp(), clock_timestamp() + INTERVAL '24 hours'
      FROM "agent_routine_proposals" WHERE "id" = 'proposal-1'$$,
    'agent_routine_proposals_source_slot_key');
SELECT pg_temp.expect_failure('proposal expiry cannot be declared before its database deadline',
    $$UPDATE "agent_routine_proposals" SET "state" = 'expired', "terminal_at" = clock_timestamp() WHERE "id" = 'proposal-1'$$,
    'AgentRoutineProposal cannot expire before its deadline');
SELECT pg_temp.expect_failure('proposal ciphertext cannot change during review',
    $$UPDATE "agent_routine_proposals" SET "suggestion_ciphertext" = decode('02', 'hex') WHERE "id" = 'proposal-1'$$,
    'AgentRoutineProposal source, requester and suggestion are immutable');

SET CONSTRAINTS ALL DEFERRED;
INSERT INTO "agent_routines" (
    "id", "silo_id", "original_requester_principal_id", "requester_issuer", "requester_subject_id", "requester_authenticated_at",
    "destination_conversation_id", "selected_managed_service_id", "status", "automatic_enabled_after", "next_automatic_occurrence",
    "schedule_task_id", "schedule_task_name", "schedule_task_key", "created_at", "updated_at"
) VALUES (
    'routine-other-requester', 'routine-silo', 'later-reader', 'https://identity.example.test', 'later-reader', '2026-01-01T00:00:00Z',
    'routine-destination', 'routine-service', 'active', clock_timestamp() - INTERVAL '1 hour', clock_timestamp() + INTERVAL '1 hour',
    'routine-other-task', 'routine-schedule', 'routine-other-task-key', clock_timestamp(), clock_timestamp()
);
INSERT INTO "agent_routine_revisions" (
    "id", "silo_id", "routine_id", "revision", "schedule_expression", "schedule_timezone", "instruction_key_id", "instruction_nonce",
    "instruction_auth_tag", "instruction_ciphertext", "instruction_ciphertext_digest", "audience_principal_ids", "created_by_principal_id", "created_at"
) VALUES (
    'routine-other-revision-1', 'routine-silo', 'routine-other-requester', 1, '0 10 * * *', 'Africa/Nairobi', 'key-1', decode(repeat('00', 12), 'hex'),
    decode(repeat('00', 16), 'hex'), decode('02', 'hex'), 'sha256:' || encode(sha256(decode('02', 'hex')), 'hex'), ARRAY['later-reader'], 'later-reader', clock_timestamp()
);
UPDATE "agent_routines"
SET "status" = 'paused', "lifecycle_revision" = 2, "next_automatic_occurrence" = NULL,
    "schedule_task_id" = NULL, "schedule_task_name" = NULL, "schedule_task_key" = NULL, "updated_at" = clock_timestamp()
WHERE "id" = 'routine-other-requester';
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.expect_failure('a proposal cannot accept a routine owned by another requester',
    $$UPDATE "agent_routine_proposals" SET "state" = 'accepted', "accepted_routine_id" = 'routine-other-requester', "terminal_at" = clock_timestamp() WHERE "id" = 'proposal-1'$$,
    'AgentRoutineProposal acceptance requires a routine owned by its requester');
UPDATE "agent_routine_proposals" SET "state" = 'accepted', "accepted_routine_id" = 'routine-1', "terminal_at" = '2000-01-01' WHERE "id" = 'proposal-1';
SELECT pg_temp.assert_true('proposal acceptance binds its requester routine and database terminal time',
    (SELECT "state" = 'accepted' AND "accepted_routine_id" = 'routine-1' AND "terminal_at" <> '2000-01-01'::TIMESTAMP
     FROM "agent_routine_proposals" WHERE "id" = 'proposal-1'));
SELECT pg_temp.expect_failure('an accepted proposal cannot be rebound',
    $$UPDATE "agent_routine_proposals" SET "state" = 'cancelled', "accepted_routine_id" = NULL WHERE "id" = 'proposal-1'$$,
    'AgentRoutineProposal may leave pending exactly once');
SELECT pg_temp.expect_failure('proposal evidence cannot be deleted',
    $$DELETE FROM "agent_routine_proposals" WHERE "id" = 'proposal-1'$$,
    'AgentRoutineProposal rows cannot be deleted');

INSERT INTO "agent_routine_proposals" (
    "id", "silo_id", "source_conversation_id", "source_run_id", "source_run_attempt", "source_ordinal", "requester_principal_id",
    "suggestion_key_id", "suggestion_nonce", "suggestion_auth_tag", "suggestion_ciphertext", "suggestion_ciphertext_digest",
    "arguments_digest", "created_at", "expires_at"
) VALUES (
    'proposal-expired', 'routine-silo', 'manual-one-conversation', 'manual-one', 1, 2, 'routine-requester',
    'proposal-key', decode(repeat('00', 12), 'hex'), decode(repeat('00', 16), 'hex'), decode('02', 'hex'),
    'sha256:' || encode(sha256(decode('02', 'hex')), 'hex'), 'sha256:' || repeat('b', 64), clock_timestamp(), clock_timestamp() + INTERVAL '24 hours'
);
ALTER TABLE "agent_routine_proposals" DISABLE TRIGGER "agent_routine_proposals_authority";
UPDATE "agent_routine_proposals" SET "created_at" = clock_timestamp() - INTERVAL '25 hours', "expires_at" = clock_timestamp() - INTERVAL '1 hour' WHERE "id" = 'proposal-expired';
ALTER TABLE "agent_routine_proposals" ENABLE TRIGGER "agent_routine_proposals_authority";
SELECT pg_temp.expect_failure('an expired proposal cannot be accepted',
    $$UPDATE "agent_routine_proposals" SET "state" = 'accepted', "accepted_routine_id" = 'routine-1', "terminal_at" = clock_timestamp() WHERE "id" = 'proposal-expired'$$,
    'AgentRoutineProposal cannot be accepted after expiry');
UPDATE "agent_routine_proposals" SET "state" = 'expired', "terminal_at" = '2000-01-01' WHERE "id" = 'proposal-expired';
SELECT pg_temp.assert_true('expired proposal closure uses the database terminal time',
    (SELECT "state" = 'expired' AND "accepted_routine_id" IS NULL AND "terminal_at" <> '2000-01-01'::TIMESTAMP
     FROM "agent_routine_proposals" WHERE "id" = 'proposal-expired'));

UPDATE "agent_routine_firings" SET "disposition" = 'uncertain', "result_reference" = 'uncertain-effect-evidence', "result_digest" = 'sha256:' || repeat('f', 64) WHERE "id" = 'manual-one-firing';
SELECT pg_temp.assert_true('uncertain outcome stays unfinished until its run resolves',
    (SELECT "finished_at" IS NULL FROM "agent_routine_firings" WHERE "id" = 'manual-one-firing'));
SELECT pg_temp.expect_failure('uncertain firing cannot invent a completed outcome',
    $$UPDATE "agent_routine_firings" SET "disposition" = 'completed', "finished_at" = clock_timestamp() WHERE "id" = 'manual-one-firing'$$,
    'Uncertain routine firing resolution requires its linked run outcome');
UPDATE "agent_runs" SET "state" = 'failed', "finished_at" = clock_timestamp(), "terminal_reason" = 'runtime_failure' WHERE "id" = 'manual-one';
SELECT pg_temp.expect_failure('uncertain resolution cannot erase saved effect evidence',
    $$UPDATE "agent_routine_firings" SET "disposition" = 'failed', "finished_at" = clock_timestamp(), "result_reference" = NULL, "result_digest" = NULL WHERE "id" = 'manual-one-firing'$$,
    'Routine firing identity and saved receipts are immutable');
UPDATE "agent_routine_firings" SET "disposition" = 'failed', "finished_at" = clock_timestamp() WHERE "id" = 'manual-one-firing';
SELECT pg_temp.assert_true('saved run outcome can resolve uncertain firing without replacing it',
    (SELECT "disposition" = 'failed' AND "run_id" = 'manual-one' FROM "agent_routine_firings" WHERE "id" = 'manual-one-firing'));

UPDATE "agent_routines" SET "status" = 'paused', "lifecycle_revision" = 2, "next_automatic_occurrence" = NULL,
    "schedule_task_id" = NULL, "schedule_task_name" = NULL, "schedule_task_key" = NULL WHERE "id" = 'routine-1';
SELECT pg_temp.seed_manual_routine_run('manual-paused');
SELECT pg_temp.assert_true('manual firing remains available while paused', EXISTS (SELECT 1 FROM "agent_runs" WHERE "id" = 'manual-paused'));
UPDATE "agent_routines" SET "status" = 'retired', "lifecycle_revision" = 3 WHERE "id" = 'routine-1';
SELECT pg_temp.expect_failure('retired routines cannot prepare another manual run',
    $$SELECT pg_temp.seed_manual_routine_run('manual-retired')$$, 'A routine firing begins unprepared at its current revision');
SELECT pg_temp.expect_failure('retired routines cannot resume',
    $$UPDATE "agent_routines" SET "status" = 'active', "lifecycle_revision" = 4 WHERE "id" = 'routine-1'$$,
    'Retired routines cannot reopen or change');

ROLLBACK;
