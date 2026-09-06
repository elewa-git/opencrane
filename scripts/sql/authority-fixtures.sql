-- Shared helpers for the PostgreSQL authority suites.
-- scripts/run-postgres-authority-tests.sh feeds this file into the same psql session before each suite,
-- so every pg_temp function below is available inside the suite transaction.
-- Every seed_* helper does nothing when its row already exists, and each row it writes satisfies the
-- current baseline checks and triggers so suites only spell out the rows they assert on.

CREATE FUNCTION pg_temp.expect_failure(test_name TEXT, statement TEXT, expected_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE actual_message TEXT;
BEGIN
    BEGIN EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, expected_message) > 0 THEN RAISE NOTICE 'PASS: %', test_name; RETURN; END IF;
        RAISE EXCEPTION 'FAIL: % returned unexpected error: %', test_name, actual_message;
    END;
    RAISE EXCEPTION 'FAIL: % unexpectedly succeeded', test_name;
END;
$$;

CREATE FUNCTION pg_temp.assert_true(test_name TEXT, condition BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF condition IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', test_name; END IF;
    RAISE NOTICE 'PASS: %', test_name;
END;
$$;

-- Adds a global model definition the silo can route to.
CREATE FUNCTION pg_temp.seed_silo_model(silo_id TEXT, model_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "model_definitions" WHERE "id" = model_id) THEN RETURN; END IF;
    INSERT INTO "model_definitions" ("id", "silo_id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
    VALUES (model_id, silo_id, 'global', model_id, 'litellm-' || model_id, model_id, clock_timestamp());
END;
$$;

-- Adds a human principal whose id and subject both equal user_id.
CREATE FUNCTION pg_temp.seed_external_user(silo_id TEXT, user_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "principals" WHERE "id" = user_id) THEN RETURN; END IF;
    INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "updated_at")
    VALUES (user_id, silo_id, 'https://identity.example.test', user_id, 'external', clock_timestamp());
END;
$$;

-- Adds the internal principal a managed agent service must own; its id is <service_id>-principal.
CREATE FUNCTION pg_temp.seed_service_principal(silo_id TEXT, service_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "principals" WHERE "id" = service_id || '-principal') THEN RETURN; END IF;
    INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "updated_at")
    VALUES (service_id || '-principal', silo_id, 'urn:opencrane:agent-service', service_id, 'internal', clock_timestamp());
END;
$$;

-- Adds a managed agent service with one published revision and activates it on that revision.
CREATE FUNCTION pg_temp.seed_managed_service(silo_id TEXT, service_id TEXT, model_id TEXT, revision_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "agent_services" WHERE "id" = service_id) THEN RETURN; END IF;
    PERFORM pg_temp.seed_service_principal(silo_id, service_id);
    INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "principal_id", "updated_at")
    VALUES (service_id, silo_id, 'managed', service_id, 'managed-agent', service_id || '-principal', clock_timestamp());
    INSERT INTO "agent_revisions" ("id", "silo_id", "agent_service_id", "revision", "state", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by", "published_at")
    VALUES (revision_id, silo_id, service_id, 1, 'published', 'sha256:' || encode(sha256(convert_to(revision_id, 'UTF8')), 'hex'), 'prompt-v1', model_id, '{}', service_id || '-principal', clock_timestamp());
    UPDATE "agent_services" SET "state" = 'active', "active_revision_id" = revision_id WHERE "id" = service_id;
END;
$$;

-- Adds an open agent-session conversation bound to a service, with computer coordinates derived from its id.
CREATE FUNCTION pg_temp.seed_agent_conversation(conversation_id TEXT, silo_id TEXT, service_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "conversations" WHERE "id" = conversation_id) THEN RETURN; END IF;
    INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "computer_id", "computer_agent_identity_id", "computer_profile_revision_id")
    VALUES (conversation_id, silo_id, service_id, 'agent_session', 'computer-' || conversation_id, 'identity-' || conversation_id, 'profile-' || conversation_id);
END;
$$;

-- Adds an open direct conversation with no agent or computer binding.
CREATE FUNCTION pg_temp.seed_direct_conversation(conversation_id TEXT, silo_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "conversations" WHERE "id" = conversation_id) THEN RETURN; END IF;
    INSERT INTO "conversations" ("id", "silo_id", "mode") VALUES (conversation_id, silo_id, 'direct');
END;
$$;

-- Joins a user to a conversation; the participant trigger allocates the timeline positions.
CREATE FUNCTION pg_temp.seed_participant(conversation_id TEXT, user_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM "conversation_participants" participant WHERE participant."conversation_id" = seed_participant.conversation_id AND participant."user_id" = seed_participant.user_id) THEN RETURN; END IF;
    INSERT INTO "conversation_participants" ("conversation_id", "user_id") VALUES (conversation_id, user_id);
END;
$$;
