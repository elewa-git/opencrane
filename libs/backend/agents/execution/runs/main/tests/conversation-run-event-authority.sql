BEGIN;

SELECT pg_temp.seed_silo_model('silo-run-event', 'run-event-model');
SELECT pg_temp.seed_external_user('silo-run-event', 'user-run-event');
SELECT pg_temp.seed_managed_service('silo-run-event', 'run-event-service', 'run-event-model', 'run-event-revision');
SELECT pg_temp.seed_agent_conversation('run-event-conversation', 'silo-run-event', 'run-event-service');
SELECT pg_temp.seed_direct_conversation('direct-conversation', 'silo-run-event');
SELECT pg_temp.expect_failure(
    'an agent run cannot bind a direct conversation',
    $statement$INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest") VALUES ('direct-conversation-run', 'silo-run-event', 'run-event-service', 'run-event-revision', 'direct-conversation', 'interactive', 'identity-run-event', 'user-run-event', '{"runScope":{"attempt":1}}', 'direct-conversation-request', 'sha256:' || repeat('e', 64))$statement$,
    'AgentRun requires the exact agent-session Conversation authority'
);
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "agent_identity_id", "principal_id", "execution_subject", "request_idempotency_key", "input_snapshot_digest")
VALUES ('run-event-run', 'silo-run-event', 'run-event-service', 'run-event-revision', 'run-event-conversation', 'interactive', 'identity-run-event', 'user-run-event', '{"runScope":{"attempt":1}}', 'run-event-request', 'sha256:' || repeat('c', 64));
INSERT INTO "run_input_snapshots" ("id", "run_id", "attempt", "snapshot_version", "silo_id", "agent_service_id", "agent_revision_id", "agent_identity_id", "principal_id", "execution_subject", "conversation_id", "model_route", "mcp_tools", "memory_query_policy", "budget_policy", "prompt_compiler_version", "input_digest")
VALUES ('run-event-input', 'run-event-run', 1, 1, 'silo-run-event', 'run-event-service', 'run-event-revision', 'identity-run-event', 'user-run-event', '{"runScope":{"attempt":1}}', 'run-event-conversation', '{}', '[]', '{}', '{}', 'prompt-v1', 'sha256:' || repeat('c', 64));
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

SELECT pg_temp.seed_participant('run-event-conversation', 'user-run-event');
SELECT pg_temp.seed_participant('direct-conversation', 'user-run-event');
SELECT pg_temp.expect_failure(
    'conversation mode is immutable after creation',
    $statement$UPDATE "conversations" SET "mode" = 'group' WHERE "id" = 'direct-conversation'$statement$,
    'Conversation identity, mode, and agent binding are immutable'
);
SELECT pg_temp.expect_failure(
    'agent-session user input requires run provenance',
    $statement$INSERT INTO "conversation_messages" ("id", "conversation_id", "user_id", "idempotency_key", "role", "state", "source", "blocks", "completed_at") VALUES ('missing-run-message', 'run-event-conversation', 'user-run-event', 'missing-run-message', 'user', 'completed', 'user_input', '[]', clock_timestamp())$statement$,
    'user input run provenance must match persisted Conversation mode'
);
SELECT pg_temp.expect_failure(
    'direct user input rejects run provenance',
    $statement$INSERT INTO "conversation_messages" ("id", "conversation_id", "run_id", "user_id", "idempotency_key", "role", "state", "source", "blocks", "completed_at") VALUES ('direct-run-message', 'direct-conversation', 'run-event-run', 'user-run-event', 'direct-run-message', 'user', 'completed', 'user_input', '[]', clock_timestamp())$statement$,
    'user input run provenance must match persisted Conversation mode'
);
INSERT INTO "conversation_messages" ("id", "conversation_id", "user_id", "idempotency_key", "role", "state", "source", "blocks", "completed_at")
VALUES ('direct-message', 'direct-conversation', 'user-run-event', 'direct-message', 'user', 'completed', 'user_input', '[]', clock_timestamp());

INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "attempt", "sequence", "type", "payload")
VALUES ('run-event-conversation', 'run-event-run', 1, 1, 'run.accepted', '{}');

SELECT pg_temp.expect_failure(
    'run events cannot skip a sequence',
    $statement$INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "attempt", "sequence", "type", "payload") VALUES ('run-event-conversation', 'run-event-run', 1, 3, 'run.started', '{}')$statement$,
    'RunEvent sequence must be contiguous'
);
SELECT pg_temp.expect_failure(
    'completed events require a completed run',
    $statement$INSERT INTO "conversation_run_events" ("conversation_id", "run_id", "attempt", "sequence", "type", "payload") VALUES ('run-event-conversation', 'run-event-run', 1, 2, 'run.completed', '{}')$statement$,
    'run.completed event requires Completed AgentRun authority'
);

ROLLBACK;
