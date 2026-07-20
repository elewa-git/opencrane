BEGIN;

CREATE FUNCTION pg_temp.expect_failure(test_name TEXT, statement TEXT, expected_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_message TEXT;
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, expected_message) > 0 THEN RAISE NOTICE 'PASS: %', test_name; RETURN; END IF;
        RAISE EXCEPTION 'FAIL: % returned unexpected error: %', test_name, actual_message;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "owner_scope", "owner_subject_id", "workload_profile", "updated_at")
VALUES ('channel-service', 'silo-channel', 'managed', 'Channel agent', 'organization', 'organization-1', 'managed-agent', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version", "model_policy_id", "budget", "authored_by", "published_at")
VALUES ('channel-revision', 'channel-service', 1, 'published', 'sha256:' || repeat('a', 64), 'prompt-v1', 'model-v1', '{}', 'user-1', clock_timestamp());
UPDATE "agent_services" SET "state" = 'active', "active_revision_id" = 'channel-revision' WHERE "id" = 'channel-service';
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at") VALUES ('channel-thread', 'silo-channel', 'channel-service', clock_timestamp());
INSERT INTO "conversation_participants" ("thread_id", "user_id") VALUES ('channel-thread', 'user-1');
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger", "delegated_user_id", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest")
VALUES ('channel-run', 'silo-channel', 'channel-service', 'channel-revision', 'channel-thread', 'interactive', 'user-1', 'channel-request', 'channel-run', 'sha256:' || repeat('b', 64), 'sha256:' || repeat('c', 64));

INSERT INTO "channel_runtime_routes" ("id", "silo_id", "agent_service_id", "action", "endpoint", "expires_at")
VALUES ('route-command', 'silo-channel', 'channel-service', 'command.forward', 'http://agent-runtime.silo-channel.svc.cluster.local:8080/v1/commands', clock_timestamp() + interval '5 minutes');
INSERT INTO "channel_runtime_routes" ("id", "silo_id", "agent_service_id", "action", "endpoint", "expires_at")
VALUES ('route-events', 'silo-channel', 'channel-service', 'events.read', 'http://agent-runtime.silo-channel.svc.cluster.local:8080/v1/events', clock_timestamp() + interval '5 minutes');

SELECT pg_temp.expect_failure('one current route per service action', $statement$INSERT INTO "channel_runtime_routes" ("id", "silo_id", "agent_service_id", "action", "endpoint", "expires_at") VALUES ('route-command-2', 'silo-channel', 'channel-service', 'command.forward', 'http://other.svc.cluster.local:8080/v1/commands', clock_timestamp() + interval '5 minutes')$statement$, 'channel_runtime_routes_one_current_target');
SELECT pg_temp.expect_failure('context subject must participate in thread', $statement$INSERT INTO "channel_invocation_contexts" ("id", "digest", "subject_id", "silo_id", "thread_id", "agent_service_id", "action", "route_id", "run_id", "membership_revision", "authorization_digest", "expires_at") VALUES ('bad-participant', 'sha256:' || repeat('d', 64), 'user-2', 'silo-channel', 'channel-thread', 'channel-service', 'command.forward', 'route-command', 'channel-run', 1, 'sha256:' || repeat('e', 64), clock_timestamp() + interval '1 minute')$statement$, 'channel_invocation_contexts_participant_fkey');
SELECT pg_temp.expect_failure('command context requires durable run', $statement$INSERT INTO "channel_invocation_contexts" ("id", "digest", "subject_id", "silo_id", "thread_id", "agent_service_id", "action", "route_id", "membership_revision", "authorization_digest", "expires_at") VALUES ('missing-run', 'sha256:' || repeat('f', 64), 'user-1', 'silo-channel', 'channel-thread', 'channel-service', 'command.forward', 'route-command', 1, 'sha256:' || repeat('e', 64), clock_timestamp() + interval '1 minute')$statement$, 'channel_invocation_contexts_action_run_binding');
SELECT pg_temp.expect_failure('event read cannot smuggle run authority', $statement$INSERT INTO "channel_invocation_contexts" ("id", "digest", "subject_id", "silo_id", "thread_id", "agent_service_id", "action", "route_id", "run_id", "membership_revision", "authorization_digest", "expires_at") VALUES ('event-run', 'sha256:' || repeat('1', 64), 'user-1', 'silo-channel', 'channel-thread', 'channel-service', 'events.read', 'route-events', 'channel-run', 1, 'sha256:' || repeat('e', 64), clock_timestamp() + interval '1 minute')$statement$, 'channel_invocation_contexts_action_run_binding');

INSERT INTO "channel_invocation_contexts" ("id", "digest", "subject_id", "silo_id", "thread_id", "agent_service_id", "action", "route_id", "run_id", "membership_revision", "authorization_digest", "expires_at")
VALUES ('valid-command', 'sha256:' || repeat('2', 64), 'user-1', 'silo-channel', 'channel-thread', 'channel-service', 'command.forward', 'route-command', 'channel-run', 7, 'sha256:' || repeat('e', 64), clock_timestamp() + interval '1 minute');

ROLLBACK;
