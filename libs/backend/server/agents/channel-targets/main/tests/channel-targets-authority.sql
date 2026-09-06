BEGIN;

SELECT pg_temp.seed_silo_model('silo-channel', 'channel-model');
SELECT pg_temp.seed_external_user('silo-channel', 'user-1');
SELECT pg_temp.seed_managed_service('silo-channel', 'channel-service', 'channel-model', 'channel-revision');
SELECT pg_temp.seed_managed_service('silo-channel', 'channel-service-2', 'channel-model', 'channel-revision-2');
SELECT pg_temp.seed_agent_conversation('channel-conversation', 'silo-channel', 'channel-service');
SELECT pg_temp.seed_participant('channel-conversation', 'user-1');

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
    'channel-participant-send', 'silo-channel', 'principal', 'user-1', 'personal',
    'user-1', 'exact', 'channel-target-participant-access',
    'opencrane-product-authorization', 1,
    'sha256:2e5c65be1512d8e4ce7dfa495d125f9de3238e57376fa45f74850de44e3d4952',
    'channel-target:send', 'channel-target', 'route-events', 'allow', 0,
    'user-1'
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
