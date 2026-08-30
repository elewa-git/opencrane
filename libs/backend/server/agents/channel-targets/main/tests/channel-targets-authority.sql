BEGIN;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('channel-model', 'global', 'channel-model', 'litellm-channel-model', 'channel-model', clock_timestamp());

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

INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "updated_at") VALUES
    ('channel-user-principal', 'silo-channel', 'https://issuer.test', 'user-1', 'oidc', clock_timestamp()),
    ('channel-service-principal', 'silo-channel', 'urn:opencrane:agent-service', 'channel-service', 'internal', clock_timestamp()),
    ('channel-service-2-principal', 'silo-channel', 'urn:opencrane:agent-service', 'channel-service-2', 'internal', clock_timestamp());
INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "principal_id", "updated_at")
VALUES ('channel-service', 'silo-channel', 'managed', 'Channel agent', 'managed-agent', 'channel-service-principal', clock_timestamp());
INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "principal_id", "updated_at")
VALUES ('channel-service-2', 'silo-channel', 'managed', 'Second channel agent', 'managed-agent', 'channel-service-2-principal', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by", "published_at")
VALUES ('channel-revision', 'channel-service', 1, 'published', 'sha256:' || repeat('a', 64), 'prompt-v1', 'channel-model', '{}', 'user-1', clock_timestamp());
UPDATE "agent_services" SET "state" = 'active', "active_revision_id" = 'channel-revision' WHERE "id" = 'channel-service';
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at") VALUES ('channel-conversation', 'silo-channel', 'channel-service', 'agent_session', clock_timestamp());
INSERT INTO "conversation_participants" ("conversation_id", "user_id", "visible_from_position", "read_through_position")
VALUES ('channel-conversation', 'user-1', 1, 0);

INSERT INTO "channel_runtime_routes" ("id", "receiver_id", "silo_id", "agent_service_id", "action", "endpoint")
VALUES ('route-events', 'conversation-replay-v1', 'silo-channel', 'channel-service', 'events.read', 'http://agent-runtime.silo-channel.svc.cluster.local:8080/v1/events');
INSERT INTO "channel_runtime_routes" ("id", "receiver_id", "silo_id", "agent_service_id", "action", "endpoint")
VALUES ('route-events-2', 'conversation-replay-v1', 'silo-channel', 'channel-service-2', 'events.read', 'http://agent-runtime.silo-channel.svc.cluster.local:8080/v1/events');

SELECT pg_temp.expect_failure('one receiver route per service action', $statement$INSERT INTO "channel_runtime_routes" ("id", "receiver_id", "silo_id", "agent_service_id", "action", "endpoint") VALUES ('route-events-duplicate', 'conversation-replay-v1', 'silo-channel', 'channel-service', 'events.read', 'http://other.svc.cluster.local:8080/v1/events')$statement$, 'channel_runtime_routes_receiver_service_key');
SELECT pg_temp.expect_failure('removed command forwarding action is rejected', $statement$INSERT INTO "channel_runtime_routes" ("id", "receiver_id", "silo_id", "agent_service_id", "action", "endpoint") VALUES ('route-command', 'command-receiver-v1', 'silo-channel', 'channel-service', 'command.forward', 'http://agent-runtime.silo-channel.svc.cluster.local:8080/v1/commands')$statement$, 'invalid input value for enum');
SELECT pg_temp.expect_failure('runtime cannot manufacture legacy route evidence', $statement$INSERT INTO "channel_runtime_routes" ("id", "receiver_id", "silo_id", "agent_service_id", "action", "endpoint", "is_current", "legacy_expires_at", "revoked_at") VALUES ('legacy-forged', 'legacy-route-v0:legacy-forged', 'silo-channel', 'channel-service', 'events.read', 'http://agent-runtime.silo-channel.svc.cluster.local:8080/v1/events', FALSE, clock_timestamp() + interval '1 minute', clock_timestamp())$statement$, 'legacy ChannelRuntimeRoute evidence can only be created by a reviewed migration');
SELECT pg_temp.expect_failure('route retirement requires matching revocation evidence', $statement$UPDATE "channel_runtime_routes" SET "is_current" = FALSE WHERE "id" = 'route-events-2'$statement$, 'channel_runtime_routes_state_check');
SELECT pg_temp.expect_failure('runtime cannot add legacy evidence to a current route', $statement$UPDATE "channel_runtime_routes" SET "receiver_id" = 'legacy-route-v0:route-events-2', "legacy_expires_at" = clock_timestamp() + interval '1 minute', "is_current" = FALSE, "revoked_at" = clock_timestamp() WHERE "id" = 'route-events-2'$statement$, 'legacy ChannelRuntimeRoute evidence cannot be added at runtime');
SELECT pg_temp.expect_failure('route evidence cannot be deleted', $statement$DELETE FROM "channel_runtime_routes" WHERE "id" = 'route-events-2'$statement$, 'ChannelRuntimeRoute evidence cannot be deleted');
SELECT pg_temp.expect_failure('context subject must participate in conversation', $statement$INSERT INTO "channel_invocation_contexts" ("id", "digest", "subject_id", "silo_id", "conversation_id", "agent_service_id", "action", "route_id", "receiver_id", "membership_revision", "authorization_digest", "expires_at") VALUES ('bad-participant', 'sha256:' || repeat('d', 64), 'user-2', 'silo-channel', 'channel-conversation', 'channel-service', 'events.read', 'route-events', 'conversation-replay-v1', 1, 'sha256:' || repeat('e', 64), clock_timestamp() + interval '1 minute')$statement$, 'channel_invocation_contexts_participant_fkey');

INSERT INTO "channel_invocation_contexts" ("id", "digest", "subject_id", "silo_id", "conversation_id", "agent_service_id", "action", "route_id", "receiver_id", "membership_revision", "authorization_digest", "expires_at")
VALUES ('valid-events-read', 'sha256:' || repeat('2', 64), 'user-1', 'silo-channel', 'channel-conversation', 'channel-service', 'events.read', 'route-events', 'conversation-replay-v1', 7, 'sha256:' || repeat('e', 64), clock_timestamp() + interval '1 minute');

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_principal_id", "boundary_kind",
    "boundary_principal_id", "boundary_coverage", "manager_id", "catalog_id",
    "catalog_revision", "catalog_digest", "capability_id", "resource_kind", "resource_id",
    "effect", "priority", "created_by"
) VALUES (
    'channel-participant-send', 'silo-channel', 'principal', 'channel-user-principal', 'personal',
    'channel-user-principal', 'exact', 'channel-target-participant-access',
    'opencrane-product-authorization', 1,
    'sha256:92d109c411001265ae8dd6a4a89e6518cd28d60ab623c62c0dd4db0868ee2821',
    'channel-target:send', 'channel-target', 'route-events', 'allow', 0,
    'channel-user-principal'
);
UPDATE "conversation_participants"
   SET "access_ended_position" = 0
 WHERE "conversation_id" = 'channel-conversation' AND "user_id" = 'user-1';
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "authorization_grants" WHERE "id" = 'channel-participant-send' AND "revoked_at" IS NULL) THEN
        RAISE EXCEPTION 'FAIL: access end left the exact ChannelTarget send grant active';
    END IF;
    RAISE NOTICE 'PASS: access end revokes the exact ChannelTarget send grant';
END;
$$;

ROLLBACK;
