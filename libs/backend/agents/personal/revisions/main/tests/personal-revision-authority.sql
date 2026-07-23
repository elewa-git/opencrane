BEGIN;

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

INSERT INTO "persona_question_sets" ("question_set_id", "version") VALUES ('personal-revision-onboarding', 1);
INSERT INTO "persona_questions" ("question_set_id", "question_set_version", "question_id", "category", "prompt", "ordinal") VALUES
('personal-revision-onboarding',1,'q1','relationship_role','Role?',1), ('personal-revision-onboarding',1,'q2','tone_language','Tone?',2),
('personal-revision-onboarding',1,'q3','answer_structure','Structure?',3), ('personal-revision-onboarding',1,'q4','challenge_support','Challenge?',4),
('personal-revision-onboarding',1,'q5','initiative','Initiative?',5), ('personal-revision-onboarding',1,'q6','approval_risk','Risk?',6),
('personal-revision-onboarding',1,'q7','working_habits','Habits?',7), ('personal-revision-onboarding',1,'q8','memory_boundaries','Memory?',8);
UPDATE "persona_question_sets" SET "state"='reviewed', "reviewed_by"='reviewer-1', "reviewed_at"=clock_timestamp() WHERE "question_set_id"='personal-revision-onboarding' AND "version"=1;
INSERT INTO "persona_profiles" ("id", "silo_id", "user_id", "updated_at") VALUES ('personal-revision-profile', 'silo-1', 'user-1', clock_timestamp());
INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "question_set_id", "question_set_version") VALUES ('personal-revision-interview','personal-revision-profile','user-1','personal-revision-onboarding',1);
INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "value") SELECT 'personal-revision-answer-' || "ordinal", 'personal-revision-interview', 'personal-revision-onboarding', 1, "question_id", 'answer' FROM "persona_questions" WHERE "question_set_id"='personal-revision-onboarding' AND "question_set_version"=1;
UPDATE "persona_interviews" SET "state"='completed', "completed_at"=clock_timestamp() WHERE "id"='personal-revision-interview';
INSERT INTO "persona_soul_templates" ("template_id", "version", "digest", "content", "selection_rules", "reviewed_by", "reviewed_at") VALUES ('personal-revision-template',1,'sha256:'||repeat('a',64),'# Soul','[{"id":"rule-1","priority":10,"answers":{"q1":"answer"}}]','reviewer-1',clock_timestamp());
INSERT INTO "persona_revisions" ("id", "persona_profile_id", "revision", "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id", "selection_rule_id", "selection_answer_ids", "compiled_instructions", "authored_by") VALUES ('personal-revision-persona','personal-revision-profile',1,'personal-revision-template',1,'sha256:'||repeat('a',64),'personal-revision-interview','rule-1',ARRAY['personal-revision-answer-1'],'# Compiled','user-1');
UPDATE "persona_revisions" SET "state"='approved', "approved_by"='user-1', "approved_at"=clock_timestamp() WHERE "id"='personal-revision-persona';
UPDATE "persona_profiles" SET "active_revision_id"='personal-revision-persona' WHERE "id"='personal-revision-profile';

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at") VALUES
('personal-revision-model-a', 'global', 'default-model', 'litellm-personal-revision-a', 'model-a', clock_timestamp()),
('personal-revision-model-b', 'global', 'careful-model', 'litellm-personal-revision-b', 'model-b', clock_timestamp());
INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "updated_at") VALUES ('personal-revision-service', 'silo-1', 'personal', 'Personal agent', 'personal-default', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "persona_revision_id", "model_definition_id", "budget", "authored_by") VALUES ('personal-revision-agent-1', 'personal-revision-service', 1, 'sha256:' || repeat('b',64), 'prompt-v1', 'personal-revision-persona', 'personal-revision-model-a', '{}', 'user-1');
UPDATE "agent_revisions" SET "state"='published', "published_at"=clock_timestamp() WHERE "id"='personal-revision-agent-1';
UPDATE "agent_services" SET "state"='active', "active_revision_id"='personal-revision-agent-1', "updated_at"=clock_timestamp() WHERE "id"='personal-revision-service';
INSERT INTO "conversation_threads" ("id", "silo_id", "agent_service_id", "updated_at") VALUES ('personal-revision-thread', 'silo-1', 'personal-revision-service', clock_timestamp());
INSERT INTO "conversation_participants" ("thread_id", "user_id") VALUES ('personal-revision-thread', 'user-1');
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger", "delegated_user_id", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest") VALUES ('personal-revision-run', 'silo-1', 'personal-revision-service', 'personal-revision-agent-1', 'personal-revision-thread', 'interactive', 'user-1', 'personal-revision-request', 'personal-revision-run', 'sha256:' || repeat('c',64), 'sha256:' || repeat('d',64));
INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('personal-revision-change', 'silo-1', 'user-1', 'personal-revision-profile', 'personal-revision-service', 'personal-revision-thread', 'personal-revision-run', '{"kind":"model_alias","modelAlias":"careful-model"}', 'sha256:' || repeat('e',64), 'personal-revision-persona', 'personal-revision-agent-1');
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='personal-revision-change';
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "parent_revision_id", "digest", "prompt_policy_version", "persona_revision_id", "model_definition_id", "budget", "authored_by") VALUES ('personal-revision-agent-2', 'personal-revision-service', 2, 'personal-revision-agent-1', 'sha256:' || repeat('f',64), 'prompt-v1', 'personal-revision-persona', 'personal-revision-model-b', '{}', 'user-1');
UPDATE "agent_revisions" SET "state"='published', "published_at"=clock_timestamp() WHERE "id"='personal-revision-agent-2';
UPDATE "agent_services" SET "active_revision_id"='personal-revision-agent-2', "updated_at"=clock_timestamp() WHERE "id"='personal-revision-service';
UPDATE "personal_configuration_changes" SET "state"='applied', "applied_persona_revision_id"='personal-revision-persona', "applied_agent_revision_id"='personal-revision-agent-2' WHERE "id"='personal-revision-change';
SELECT pg_temp.expect_failure('applied change is terminal', $statement$UPDATE "personal_configuration_changes" SET "state"='superseded' WHERE "id"='personal-revision-change'$statement$, 'invalid lifecycle transition');
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger", "delegated_user_id", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest") VALUES ('personal-revision-run-2', 'silo-1', 'personal-revision-service', 'personal-revision-agent-2', 'personal-revision-thread', 'interactive', 'user-1', 'personal-revision-request-2', 'personal-revision-run-2', 'sha256:' || repeat('c',64), 'sha256:' || repeat('d',64));
INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('personal-revision-change-mismatch', 'silo-1', 'user-1', 'personal-revision-profile', 'personal-revision-service', 'personal-revision-thread', 'personal-revision-run-2', '{"kind":"model_alias","modelAlias":"careful-model"}', 'sha256:' || repeat('e',64), 'personal-revision-persona', 'personal-revision-agent-2');
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='personal-revision-change-mismatch';
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "parent_revision_id", "digest", "prompt_policy_version", "persona_revision_id", "model_definition_id", "budget", "authored_by") VALUES ('personal-revision-agent-3', 'personal-revision-service', 3, 'personal-revision-agent-2', 'sha256:' || repeat('1',64), 'prompt-v1', 'personal-revision-persona', 'personal-revision-model-a', '{}', 'user-1');
UPDATE "agent_revisions" SET "state"='published', "published_at"=clock_timestamp() WHERE "id"='personal-revision-agent-3';
UPDATE "agent_services" SET "active_revision_id"='personal-revision-agent-3', "updated_at"=clock_timestamp() WHERE "id"='personal-revision-service';
SELECT pg_temp.expect_failure('applied model must match accepted alias', $statement$UPDATE "personal_configuration_changes" SET "state"='applied', "applied_persona_revision_id"='personal-revision-persona', "applied_agent_revision_id"='personal-revision-agent-3' WHERE "id"='personal-revision-change-mismatch'$statement$, 'application fence conflict');

-- A persona refresh must carry real new interview evidence rather than reusing the onboarding persona.
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger", "delegated_user_id", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest") VALUES ('personal-refresh-run', 'silo-1', 'personal-revision-service', 'personal-revision-agent-3', 'personal-revision-thread', 'interactive', 'user-1', 'personal-refresh-request', 'personal-refresh-run', 'sha256:' || repeat('c',64), 'sha256:' || repeat('d',64));
INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('personal-refresh-change', 'silo-1', 'user-1', 'personal-revision-profile', 'personal-revision-service', 'personal-revision-thread', 'personal-refresh-run', '{"kind":"persona_refresh"}', 'sha256:' || repeat('2',64), 'personal-revision-persona', 'personal-revision-agent-3');
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='personal-refresh-change';
INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "refresh_change_id", "question_set_id", "question_set_version") VALUES ('personal-refresh-interview','personal-revision-profile','user-1','personal-refresh-change','personal-revision-onboarding',1);
INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "value") SELECT 'personal-refresh-answer-' || "ordinal", 'personal-refresh-interview', 'personal-revision-onboarding', 1, "question_id", 'answer' FROM "persona_questions" WHERE "question_set_id"='personal-revision-onboarding' AND "question_set_version"=1;
UPDATE "persona_interviews" SET "state"='completed', "completed_at"=clock_timestamp() WHERE "id"='personal-refresh-interview';
INSERT INTO "persona_revisions" ("id", "persona_profile_id", "revision", "previous_revision_id", "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id", "selection_rule_id", "selection_answer_ids", "compiled_instructions", "authored_by") VALUES ('personal-refresh-persona','personal-revision-profile',2,'personal-revision-persona','personal-revision-template',1,'sha256:'||repeat('a',64),'personal-refresh-interview','rule-1',ARRAY['personal-refresh-answer-1'],'# Refreshed compiled instructions','user-1');
INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES
('personal-refresh-insight-1','personal-refresh-persona','relationship_role','Updated relationship preference','personal-refresh-interview','personal-revision-onboarding',1,'q1','personal-refresh-answer-1'),
('personal-refresh-insight-2','personal-refresh-persona','tone_language','Updated tone preference','personal-refresh-interview','personal-revision-onboarding',1,'q2','personal-refresh-answer-2'),
('personal-refresh-insight-3','personal-refresh-persona','answer_structure','Updated structure preference','personal-refresh-interview','personal-revision-onboarding',1,'q3','personal-refresh-answer-3');

-- The deferred constraint denies an ordinary persona approval before it can leave the refresh journal unapplied.
DO $$
DECLARE actual_message TEXT;
BEGIN
    BEGIN
        UPDATE "persona_revisions" SET "state"='approved', "approved_by"='user-1', "approved_at"=clock_timestamp() WHERE "id"='personal-refresh-persona';
        SET CONSTRAINTS "refresh_persona_revisions_require_applied_configuration" IMMEDIATE;
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_message = MESSAGE_TEXT;
        IF strpos(actual_message, 'requires its linked configuration change to be applied atomically') > 0 THEN RAISE NOTICE 'PASS: standalone refresh persona approval is rejected'; ELSE RAISE EXCEPTION 'FAIL: standalone refresh persona approval returned unexpected error: %', actual_message; END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL: standalone refresh persona approval unexpectedly succeeded';
END;
$$;

-- The only valid flow commits the approved persona, published agent clone, both active heads, and applied journal pair together.
UPDATE "persona_revisions" SET "state"='approved', "approved_by"='user-1', "approved_at"=clock_timestamp() WHERE "id"='personal-refresh-persona';
UPDATE "persona_profiles" SET "active_revision_id"='personal-refresh-persona' WHERE "id"='personal-revision-profile';
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "parent_revision_id", "digest", "prompt_policy_version", "persona_revision_id", "model_definition_id", "budget", "authored_by") VALUES ('personal-refresh-agent', 'personal-revision-service', 4, 'personal-revision-agent-3', 'sha256:' || repeat('3',64), 'prompt-v1', 'personal-refresh-persona', 'personal-revision-model-a', '{}', 'user-1');
UPDATE "agent_revisions" SET "state"='published', "published_at"=clock_timestamp() WHERE "id"='personal-refresh-agent';
UPDATE "agent_services" SET "active_revision_id"='personal-refresh-agent', "updated_at"=clock_timestamp() WHERE "id"='personal-revision-service';
UPDATE "personal_configuration_changes" SET "state"='applied', "applied_persona_revision_id"='personal-refresh-persona', "applied_agent_revision_id"='personal-refresh-agent' WHERE "id"='personal-refresh-change';
SET CONSTRAINTS "refresh_persona_revisions_require_applied_configuration" IMMEDIATE;

-- A newly accepted refresh may not attach an interview once its expected agent head is stale.
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "thread_id", "trigger", "delegated_user_id", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest") VALUES ('personal-stale-refresh-run', 'silo-1', 'personal-revision-service', 'personal-refresh-agent', 'personal-revision-thread', 'interactive', 'user-1', 'personal-stale-refresh-request', 'personal-stale-refresh-run', 'sha256:' || repeat('c',64), 'sha256:' || repeat('d',64));
INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_thread_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('personal-stale-refresh-change', 'silo-1', 'user-1', 'personal-revision-profile', 'personal-revision-service', 'personal-revision-thread', 'personal-stale-refresh-run', '{"kind":"persona_refresh"}', 'sha256:' || repeat('4',64), 'personal-revision-persona', 'personal-revision-agent-3');
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='personal-stale-refresh-change';
SELECT pg_temp.expect_failure('stale refresh cannot claim a new interview', $statement$INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "refresh_change_id", "question_set_id", "question_set_version") VALUES ('personal-stale-refresh-interview','personal-revision-profile','user-1','personal-stale-refresh-change','personal-revision-onboarding',1)$statement$, 'PersonaInterview refresh link requires an accepted current personal configuration change');

ROLLBACK;
