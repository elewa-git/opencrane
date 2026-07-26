BEGIN;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES ('personal-configuration-model', 'global', 'personal-configuration-model', 'litellm-personal-configuration-model', 'personal-configuration-model', clock_timestamp());

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

INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "updated_at") VALUES ('service-1', 'silo-1', 'personal', 'Personal agent', 'personal-default', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "model_definition_id", "budget", "authored_by") VALUES ('agent-1', 'service-1', 1, 'sha256:' || repeat('a',64), 'prompt-v1', 'personal-configuration-model', '{}', 'user-1');
INSERT INTO "persona_profiles" ("id", "silo_id", "user_id", "updated_at") VALUES ('profile-1', 'silo-1', 'user-1', clock_timestamp());
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at") VALUES ('thread-1', 'silo-1', 'service-1', clock_timestamp());
INSERT INTO "conversation_participants" ("thread_id", "user_id") VALUES ('thread-1', 'user-1');
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger", "delegated_user_id", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest") VALUES ('run-1', 'silo-1', 'service-1', 'agent-1', 'thread-1', 'interactive', 'user-1', 'request-1', 'run-1', 'sha256:' || repeat('b',64), 'sha256:' || repeat('c',64));

INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest") VALUES ('change-1', 'silo-1', 'user-1', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"model_alias","modelAlias":"careful"}', 'sha256:' || repeat('d',64));
SELECT pg_temp.expect_failure('proposal evidence is immutable', $statement$UPDATE "personal_configuration_changes" SET "requested_patch"='{"kind":"model_alias","modelAlias":"unsafe"}' WHERE "id"='change-1'$statement$, 'proposal evidence is immutable');
SELECT pg_temp.expect_failure('proposal cannot be deleted', $statement$DELETE FROM "personal_configuration_changes" WHERE "id"='change-1'$statement$, 'cannot be deleted');
SELECT pg_temp.expect_failure('source ownership is enforced', $statement$INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest") VALUES ('change-other-user', 'silo-1', 'user-2', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"model_alias","modelAlias":"careful"}', 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')$statement$, 'source thread requires the initiating participant');
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='change-1';
SELECT pg_temp.expect_failure('accepted decision evidence is immutable', $statement$UPDATE "personal_configuration_changes" SET "decided_by"='other-user' WHERE "id"='change-1'$statement$, 'decision evidence is immutable');
SELECT pg_temp.expect_failure('accepted proposal cannot return to proposed', $statement$UPDATE "personal_configuration_changes" SET "state"='proposed' WHERE "id"='change-1'$statement$, 'invalid lifecycle transition');
SELECT pg_temp.expect_failure('unknown patch fields are rejected', $statement$INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest") VALUES ('change-extra', 'silo-1', 'user-1', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"model_alias","modelAlias":"careful","budget":1}', 'sha256:' || repeat('e',64))$statement$, 'personal_configuration_changes_valid_check');
SELECT pg_temp.expect_failure('whitespace model alias is rejected', $statement$INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest") VALUES ('change-whitespace', 'silo-1', 'user-1', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"model_alias","modelAlias":"\t"}', 'sha256:' || repeat('f',64))$statement$, 'personal_configuration_changes_valid_check');

INSERT INTO "persona_question_sets" ("question_set_id", "version") VALUES ('refresh-onboarding', 1);
INSERT INTO "persona_questions" ("question_set_id", "question_set_version", "question_id", "category", "prompt", "ordinal") VALUES
('refresh-onboarding',1,'q1','relationship_role','Role?',1), ('refresh-onboarding',1,'q2','tone_language','Tone?',2),
('refresh-onboarding',1,'q3','answer_structure','Structure?',3), ('refresh-onboarding',1,'q4','challenge_support','Challenge?',4),
('refresh-onboarding',1,'q5','initiative','Initiative?',5), ('refresh-onboarding',1,'q6','approval_risk','Risk?',6),
('refresh-onboarding',1,'q7','working_habits','Habits?',7), ('refresh-onboarding',1,'q8','memory_boundaries','Memory?',8);
UPDATE "persona_question_sets" SET "state"='reviewed', "reviewed_by"='reviewer-1', "reviewed_at"=clock_timestamp() WHERE "question_set_id"='refresh-onboarding' AND "version"=1;
SELECT pg_temp.expect_failure('refresh interview rejects a non-refresh proposal', $statement$INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "refresh_configuration_change_id", "question_set_id", "question_set_version") VALUES ('invalid-refresh-interview','profile-1','user-1','change-1','refresh-onboarding',1)$statement$, 'PersonaInterview refresh must bind one accepted owner persona_refresh proposal');
INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest") VALUES ('refresh-change-1', 'silo-1', 'user-1', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"persona_refresh"}', 'sha256:' || repeat('a',64));
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='refresh-change-1';
INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "refresh_configuration_change_id", "question_set_id", "question_set_version") VALUES ('refresh-interview','profile-1','user-1','refresh-change-1','refresh-onboarding',1);

ROLLBACK;
