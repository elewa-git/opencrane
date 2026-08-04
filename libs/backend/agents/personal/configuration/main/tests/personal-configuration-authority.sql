BEGIN;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES
('personal-configuration-model', 'global', 'personal-configuration-model', 'litellm-personal-configuration-model', 'personal-configuration-model', clock_timestamp()),
('careful-model', 'global', 'careful', 'litellm-careful-model', 'careful-model', clock_timestamp());

INSERT INTO "persona_question_sets" ("question_set_id", "version") VALUES ('configuration-onboarding', 1);
INSERT INTO "persona_questions" ("question_set_id", "question_set_version", "question_id", "category", "prompt", "ordinal") VALUES
('configuration-onboarding',1,'q1','relationship_role','Role?',1), ('configuration-onboarding',1,'q2','tone_language','Tone?',2),
('configuration-onboarding',1,'q3','answer_structure','Structure?',3), ('configuration-onboarding',1,'q4','challenge_support','Challenge?',4),
('configuration-onboarding',1,'q5','initiative','Initiative?',5), ('configuration-onboarding',1,'q6','approval_risk','Risk?',6),
('configuration-onboarding',1,'q7','working_habits','Habits?',7), ('configuration-onboarding',1,'q8','memory_boundaries','Memory?',8);
UPDATE "persona_question_sets" SET "state"='reviewed', "reviewed_by"='reviewer-1', "reviewed_at"=clock_timestamp() WHERE "question_set_id"='configuration-onboarding' AND "version"=1;
INSERT INTO "persona_soul_templates" ("template_id", "version", "digest", "content", "selection_rules", "reviewed_by", "reviewed_at") VALUES ('configuration-partner',1,'sha256:'||repeat('1',64),'# Soul','[{"id":"configuration-partner-rule","priority":10,"answers":{"q1":"answer"}}]','reviewer-1',clock_timestamp());

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

INSERT INTO "persona_profiles" ("id", "silo_id", "user_id", "updated_at") VALUES ('profile-1', 'silo-1', 'user-1', clock_timestamp());
INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "question_set_id", "question_set_version") VALUES ('configuration-interview-1','profile-1','user-1','configuration-onboarding',1);
INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "value")
SELECT 'configuration-answer-' || "ordinal", 'configuration-interview-1', 'configuration-onboarding', 1, "question_id", 'answer'
FROM "persona_questions" WHERE "question_set_id"='configuration-onboarding' AND "question_set_version"=1;
UPDATE "persona_interviews" SET "state"='completed', "completed_at"=clock_timestamp() WHERE "id"='configuration-interview-1';
INSERT INTO "persona_revisions" ("id", "persona_profile_id", "revision", "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id", "selection_rule_id", "selection_answer_ids", "compiled_instructions", "authored_by") VALUES ('persona-1','profile-1',1,'configuration-partner',1,'sha256:'||repeat('1',64),'configuration-interview-1','configuration-partner-rule',ARRAY['configuration-answer-1'],'# Compiled','user-1');
INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES
('configuration-insight-1','persona-1','relationship_role','Insight one','configuration-interview-1','configuration-onboarding',1,'q1','configuration-answer-1'),
('configuration-insight-2','persona-1','tone_language','Insight two','configuration-interview-1','configuration-onboarding',1,'q2','configuration-answer-2'),
('configuration-insight-3','persona-1','answer_structure','Insight three','configuration-interview-1','configuration-onboarding',1,'q3','configuration-answer-3');
UPDATE "persona_revisions" SET "state"='approved', "approved_by"='user-1', "approved_at"=clock_timestamp() WHERE "id"='persona-1';
UPDATE "persona_profiles" SET "active_revision_id"='persona-1' WHERE "id"='profile-1';
INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "updated_at") VALUES ('service-1', 'silo-1', 'personal', 'Personal agent', 'personal-default', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "persona_revision_id", "model_definition_id", "budget", "authored_by") VALUES ('agent-1', 'service-1', 1, 'sha256:' || repeat('a',64), 'prompt-v1', 'persona-1', 'personal-configuration-model', '{}', 'user-1');
UPDATE "agent_revisions" SET "state"='published', "published_at"=clock_timestamp() WHERE "id"='agent-1';
UPDATE "agent_services" SET "state"='active', "active_revision_id"='agent-1' WHERE "id"='service-1';
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at") VALUES ('thread-1', 'silo-1', 'service-1', clock_timestamp());
INSERT INTO "conversation_participants" ("thread_id", "user_id") VALUES ('thread-1', 'user-1');
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger", "delegated_user_id", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest") VALUES ('run-1', 'silo-1', 'service-1', 'agent-1', 'thread-1', 'interactive', 'user-1', 'request-1', 'run-1', 'sha256:' || repeat('b',64), 'sha256:' || repeat('c',64));

INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('change-1', 'silo-1', 'user-1', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"model_alias","modelAlias":"careful"}', 'sha256:' || repeat('d',64), 'persona-1', 'agent-1');
SELECT pg_temp.expect_failure('proposal evidence is immutable', $statement$UPDATE "personal_configuration_changes" SET "requested_patch"='{"kind":"model_alias","modelAlias":"unsafe"}' WHERE "id"='change-1'$statement$, 'proposal evidence is immutable');
SELECT pg_temp.expect_failure('proposal cannot be deleted', $statement$DELETE FROM "personal_configuration_changes" WHERE "id"='change-1'$statement$, 'cannot be deleted');
SELECT pg_temp.expect_failure('source ownership is enforced', $statement$INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest") VALUES ('change-other-user', 'silo-1', 'user-2', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"model_alias","modelAlias":"careful"}', 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')$statement$, 'source thread requires the initiating participant');
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='change-1';
SELECT pg_temp.expect_failure('accepted decision evidence is immutable', $statement$UPDATE "personal_configuration_changes" SET "decided_by"='other-user' WHERE "id"='change-1'$statement$, 'decision evidence is immutable');
SELECT pg_temp.expect_failure('accepted proposal cannot return to proposed', $statement$UPDATE "personal_configuration_changes" SET "state"='proposed' WHERE "id"='change-1'$statement$, 'invalid lifecycle transition');
SELECT pg_temp.expect_failure('model alias cannot apply an unpublished or inactive revision', $statement$UPDATE "personal_configuration_changes" SET "state"='applied', "applied_agent_revision_id"='agent-1' WHERE "id"='change-1'$statement$, 'applied model_alias must activate its exact published personal AgentRevision');
SELECT pg_temp.expect_failure('unknown patch fields are rejected', $statement$INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('change-extra', 'silo-1', 'user-1', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"model_alias","modelAlias":"careful","budget":1}', 'sha256:' || repeat('e',64), 'persona-1', 'agent-1')$statement$, 'personal_configuration_changes_valid_check');
SELECT pg_temp.expect_failure('whitespace model alias is rejected', $statement$INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('change-whitespace', 'silo-1', 'user-1', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"model_alias","modelAlias":"\t"}', 'sha256:' || repeat('f',64), 'persona-1', 'agent-1')$statement$, 'personal_configuration_changes_valid_check');

INSERT INTO "persona_question_sets" ("question_set_id", "version") VALUES ('refresh-onboarding', 1);
INSERT INTO "persona_questions" ("question_set_id", "question_set_version", "question_id", "category", "prompt", "ordinal") VALUES
('refresh-onboarding',1,'q1','relationship_role','Role?',1), ('refresh-onboarding',1,'q2','tone_language','Tone?',2),
('refresh-onboarding',1,'q3','answer_structure','Structure?',3), ('refresh-onboarding',1,'q4','challenge_support','Challenge?',4),
('refresh-onboarding',1,'q5','initiative','Initiative?',5), ('refresh-onboarding',1,'q6','approval_risk','Risk?',6),
('refresh-onboarding',1,'q7','working_habits','Habits?',7), ('refresh-onboarding',1,'q8','memory_boundaries','Memory?',8);
UPDATE "persona_question_sets" SET "state"='reviewed', "reviewed_by"='reviewer-1', "reviewed_at"=clock_timestamp() WHERE "question_set_id"='refresh-onboarding' AND "version"=1;
SELECT pg_temp.expect_failure('refresh interview rejects a non-refresh proposal', $statement$INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "refresh_configuration_change_id", "question_set_id", "question_set_version") VALUES ('invalid-refresh-interview','profile-1','user-1','change-1','refresh-onboarding',1)$statement$, 'PersonaInterview refresh must bind one accepted owner persona_refresh proposal');
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "parent_revision_id", "digest", "prompt_policy_version", "persona_revision_id", "model_definition_id", "budget", "authored_by") VALUES ('agent-2', 'service-1', 2, 'agent-1', 'sha256:' || repeat('2',64), 'prompt-v1', 'persona-1', 'careful-model', '{}', 'user-1');
UPDATE "agent_revisions" SET "state"='published', "published_at"=clock_timestamp() WHERE "id"='agent-2';
UPDATE "agent_services" SET "active_revision_id"='agent-2' WHERE "id"='service-1';
UPDATE "personal_configuration_changes" SET "state"='applied', "applied_agent_revision_id"='agent-2' WHERE "id"='change-1';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "personal_configuration_changes" WHERE "id"='change-1' AND "state"='applied' AND "applied_agent_revision_id"='agent-2') THEN
        RAISE EXCEPTION 'FAIL: accepted model alias did not apply its exact published revision';
    END IF;
    RAISE NOTICE 'PASS: accepted model alias applies its exact published revision';
END;
$$;
INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('refresh-change-1', 'silo-1', 'user-1', 'profile-1', 'service-1', 'thread-1', 'run-1', '{"kind":"persona_refresh"}', 'sha256:' || repeat('a',64), 'persona-1', 'agent-2');
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='refresh-change-1';
INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "refresh_configuration_change_id", "question_set_id", "question_set_version") VALUES ('refresh-interview','profile-1','user-1','refresh-change-1','refresh-onboarding',1);

ROLLBACK;
