BEGIN;

SELECT pg_temp.seed_silo_model('child-silo', 'child-model');
SELECT pg_temp.seed_managed_service('child-silo', 'child-service', 'child-model', 'child-revision');
SELECT pg_temp.seed_external_user('child-silo', 'child-owner');
SELECT pg_temp.seed_external_user('child-silo', 'child-peer');
INSERT INTO "org_memberships" ("id", "cluster_tenant", "subject", "role", "status", "updated_at")
VALUES ('child-owner-member', 'child-silo', 'child-owner', 'member', 'active', clock_timestamp()),
       ('child-peer-member', 'child-silo', 'child-peer', 'member', 'active', clock_timestamp());
INSERT INTO "conversations" ("id", "silo_id", "mode") VALUES ('child-parent', 'child-silo', 'group');
SELECT pg_temp.seed_participant('child-parent', 'child-owner');
SELECT pg_temp.seed_participant('child-parent', 'child-peer');
SELECT pg_temp.seed_direct_conversation('child-direct', 'child-silo');

-- Supplies a valid command, then replaces only the fields each negative case attacks.
CREATE FUNCTION pg_temp.new_child_request(request_id TEXT, changes JSONB DEFAULT '{}') RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO "conversation_child_requests"
    SELECT * FROM jsonb_populate_record(NULL::"conversation_child_requests", jsonb_build_object(
        'id', request_id, 'silo_id', 'child-silo', 'idempotency_key', request_id,
        'parent_conversation_id', 'child-parent', 'parent_message_id', 'parent-message', 'parent_message_position', 3,
        'child_conversation_id', 'child-' || request_id, 'computer_id', 'computer-child-' || request_id,
        'requested_by_principal_id', 'child-owner', 'requester_subject_id', 'child-owner',
        'requester_issuer', 'https://identity.example.test', 'requester_authenticated_at', clock_timestamp(),
        'agent_service_id', 'child-service', 'agent_revision_id', 'child-revision',
        'agent_identity_id', 'identity-child-' || request_id, 'agent_principal_id', 'child-service-principal',
        'agent_name', 'Company assistant', 'profile_revision_id', 'profile-child-' || request_id,
        'participant_subject_ids', '["child-owner", "child-peer"]'::jsonb,
        'command_digest', 'sha256:' || repeat('a', 64), 'state', 'pending', 'created_at', clock_timestamp()
    ) || changes);
END;
$$;

SELECT pg_temp.new_child_request('accepted');
SELECT pg_temp.assert_true('accepted command remains pending',
    (SELECT "state" = 'pending' FROM "conversation_child_requests" WHERE "id" = 'accepted'));
SELECT pg_temp.expect_failure('command source cannot change',
    'UPDATE "conversation_child_requests" SET "parent_message_id" = ''other-message'' WHERE "id" = ''accepted''', 'command and audience are immutable');
SELECT pg_temp.expect_failure('assistant cannot change',
    'UPDATE "conversation_child_requests" SET "agent_service_id" = ''other-service'' WHERE "id" = ''accepted''', 'command and audience are immutable');
SELECT pg_temp.expect_failure('audience cannot expand',
    'UPDATE "conversation_child_requests" SET "participant_subject_ids" = ''["child-owner", "child-peer", "stranger"]'' WHERE "id" = ''accepted''', 'command and audience are immutable');
SELECT pg_temp.expect_failure('accepted command cannot disappear',
    'DELETE FROM "conversation_child_requests" WHERE "id" = ''accepted''', 'cannot be deleted');
SELECT pg_temp.expect_failure('a child projection is required before ready',
    'UPDATE "conversation_child_requests" SET "state" = ''ready'' WHERE "id" = ''accepted''', 'matching child projection');
SELECT pg_temp.seed_agent_conversation('child-accepted', 'child-silo', 'child-service');
UPDATE "conversation_child_requests" SET "state" = 'ready' WHERE "id" = 'accepted';
SELECT pg_temp.expect_failure('ready requests cannot return to pending',
    'UPDATE "conversation_child_requests" SET "state" = ''pending'' WHERE "id" = ''accepted''', 'only once');
SELECT pg_temp.expect_failure('direct chats cannot spawn group children',
    $$SELECT pg_temp.new_child_request('wrong-mode', '{"parent_conversation_id":"child-direct"}')$$, 'open parent group');
SELECT pg_temp.expect_failure('requester cannot impersonate another subject',
    $$SELECT pg_temp.new_child_request('wrong-requester', '{"requested_by_principal_id":"child-peer"}')$$, 'authenticated external Principal');
SELECT pg_temp.expect_failure('request cannot borrow another service Principal',
    $$SELECT pg_temp.new_child_request('wrong-agent', '{"agent_principal_id":"child-owner"}')$$, 'active managed service');
SELECT pg_temp.expect_failure('duplicate audience entries are rejected',
    $$SELECT pg_temp.new_child_request('duplicates', '{"participant_subject_ids":["child-owner","child-owner"]}')$$, 'unique participant subjects');
SELECT pg_temp.expect_failure('requester must belong to the audience',
    $$SELECT pg_temp.new_child_request('missing-requester', '{"participant_subject_ids":["child-peer"]}')$$, 'unique participant subjects');
SELECT pg_temp.expect_failure('unknown audience members are rejected',
    $$SELECT pg_temp.new_child_request('unknown-peer', '{"participant_subject_ids":["child-owner","stranger"]}')$$, 'current parent membership');
SELECT pg_temp.expect_failure('genesis cannot supply a group request',
    $$SELECT pg_temp.new_child_request('genesis', '{"parent_message_position":0}')$$, 'pending command');

SELECT pg_temp.new_child_request('revoked');
UPDATE "org_memberships" SET "status" = 'suspended', "updated_at" = clock_timestamp() WHERE "id" = 'child-peer-member';
SELECT pg_temp.seed_agent_conversation('child-revoked', 'child-silo', 'child-service');
SELECT pg_temp.expect_failure('revocation during recovery prevents ready',
    'UPDATE "conversation_child_requests" SET "state" = ''ready'' WHERE "id" = ''revoked''', 'current parent membership');
UPDATE "conversation_child_requests" SET "state" = 'unavailable' WHERE "id" = 'revoked';
SELECT pg_temp.assert_true('revocation can finish the request without creating authority',
    (SELECT "state" = 'unavailable' FROM "conversation_child_requests" WHERE "id" = 'revoked'));

ROLLBACK;
