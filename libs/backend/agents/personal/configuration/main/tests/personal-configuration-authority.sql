BEGIN;

INSERT INTO "model_definitions" ("id", "scope", "public_model_name", "litellm_model_id", "upstream_model", "updated_at")
VALUES
('personal-configuration-model', 'global', 'personal-configuration-model', 'litellm-personal-configuration-model', 'personal-configuration-model', clock_timestamp()),
('careful-model', 'global', 'careful', 'litellm-careful-model', 'careful-model', clock_timestamp());

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
INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "question_set_id", "question_set_version", "scoring_policy_id", "scoring_policy_version", "interpolation_map_id", "interpolation_map_version")
VALUES ('configuration-interview-1','profile-1','user-1','personal-agent-onboarding',1,'personal-agent-scoring',1,'personal-agent-interpolation',1);
INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "choice_id") VALUES
('configuration-answer-1','configuration-interview-1','personal-agent-onboarding',1,'q1-decision-speed','a'),
('configuration-answer-2','configuration-interview-1','personal-agent-onboarding',1,'q2-response-preference','a'),
('configuration-answer-3','configuration-interview-1','personal-agent-onboarding',1,'q3-feedback-preference','a'),
('configuration-answer-4','configuration-interview-1','personal-agent-onboarding',1,'q4-meeting-energy','a'),
('configuration-answer-5','configuration-interview-1','personal-agent-onboarding',1,'q5-new-ideas','a'),
('configuration-answer-6','configuration-interview-1','personal-agent-onboarding',1,'q6-risk-appetite','a'),
('configuration-answer-7','configuration-interview-1','personal-agent-onboarding',1,'q7-suggestion-cadence','a'),
('configuration-answer-8','configuration-interview-1','personal-agent-onboarding',1,'q8-challenge-preference','a'),
('configuration-answer-9','configuration-interview-1','personal-agent-onboarding',1,'q9-relationship-model','b'),
('configuration-answer-10','configuration-interview-1','personal-agent-onboarding',1,'q10-tone-preference','a');
UPDATE "persona_interviews" SET "state"='completed', "completed_at"=clock_timestamp() WHERE "id"='configuration-interview-1';
INSERT INTO "persona_interview_scores" ("interview_id", "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest", "ordered_answer_ids", "ordered_choice_ids", "red", "yellow", "green", "blue", "colour_total", "explorer", "guardian", "openness_total", "primary_candidates", "secondary_candidates", "modifier_candidates") VALUES
('configuration-interview-1','personal-agent-scoring',1,'sha256:dd84a619e9a465cce882e63e523946502a325dd5b0dcb56fd7d33da6fd072af9',
 ARRAY['configuration-answer-1','configuration-answer-2','configuration-answer-3','configuration-answer-4','configuration-answer-5','configuration-answer-6','configuration-answer-7','configuration-answer-8','configuration-answer-9','configuration-answer-10'],
 ARRAY['q1-decision-speed:a','q2-response-preference:a','q3-feedback-preference:a','q4-meeting-energy:a','q5-new-ideas:a','q6-risk-appetite:a','q7-suggestion-cadence:a','q8-challenge-preference:a','q9-relationship-model:b','q10-tone-preference:a'],
 21,6,0,5,32,7,0,7,ARRAY['Red']::"PersonaColour"[],ARRAY['Yellow']::"PersonaColour"[],ARRAY['Explorer']::"PersonaOpennessModifier"[]);
INSERT INTO "persona_revisions" ("id", "persona_profile_id", "revision", "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id", "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest", "interpolation_map_id", "interpolation_map_version", "interpolation_map_digest", "scoring_evidence", "primary_colour", "secondary_colour", "modifier", "compiled_instructions", "authored_by") VALUES
('persona-1','profile-1',1,'commander-explorer',1,'sha256:8cf1b0a5180d7e1176efe7ebc857c1c2775ff0b3cd8591d07a3a42dc3c936efe','configuration-interview-1','personal-agent-scoring',1,'sha256:dd84a619e9a465cce882e63e523946502a325dd5b0dcb56fd7d33da6fd072af9','personal-agent-interpolation',1,'sha256:3fe36e4967254849da2aa91b474510633bdc8c896a67febc24494b708a77f1d6',
 '{"orderedAnswerIds":["configuration-answer-1","configuration-answer-2","configuration-answer-3","configuration-answer-4","configuration-answer-5","configuration-answer-6","configuration-answer-7","configuration-answer-8","configuration-answer-9","configuration-answer-10"],"orderedChoiceIds":["q1-decision-speed:a","q2-response-preference:a","q3-feedback-preference:a","q4-meeting-energy:a","q5-new-ideas:a","q6-risk-appetite:a","q7-suggestion-cadence:a","q8-challenge-preference:a","q9-relationship-model:b","q10-tone-preference:a"],"colours":{"red":21,"yellow":6,"green":0,"blue":5,"total":32},"openness":{"explorer":7,"guardian":0,"total":7},"tieResolutions":[],"primary":"red","secondary":"yellow","modifier":"explorer"}'::jsonb,
 'Red','Yellow','Explorer','# Compiled','user-1');
INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES
('configuration-insight-1','persona-1','Response','Insight one','configuration-interview-1','personal-agent-onboarding',1,'q2-response-preference','configuration-answer-2'),
('configuration-insight-2','persona-1','Feedback','Insight two','configuration-interview-1','personal-agent-onboarding',1,'q3-feedback-preference','configuration-answer-3'),
('configuration-insight-3','persona-1','Challenge','Insight three','configuration-interview-1','personal-agent-onboarding',1,'q8-challenge-preference','configuration-answer-8');
UPDATE "persona_revisions" SET "state"='approved', "approved_by"='user-1', "approved_at"=clock_timestamp() WHERE "id"='persona-1';
UPDATE "persona_profiles" SET "active_revision_id"='persona-1' WHERE "id"='profile-1';
INSERT INTO "agent_services" ("id", "silo_id", "kind", "name", "workload_profile", "updated_at") VALUES ('service-1', 'silo-1', 'personal', 'Personal agent', 'personal-default', clock_timestamp());
INSERT INTO "agent_revisions" ("id", "agent_service_id", "revision", "digest", "prompt_policy_version", "persona_revision_id", "model_definition_id", "budget", "authored_by") VALUES ('agent-1', 'service-1', 1, 'sha256:' || repeat('a',64), 'prompt-v1', 'persona-1', 'personal-configuration-model', '{}', 'user-1');
UPDATE "agent_revisions" SET "state"='published', "published_at"=clock_timestamp() WHERE "id"='agent-1';
UPDATE "agent_services" SET "state"='active', "active_revision_id"='agent-1' WHERE "id"='service-1';
INSERT INTO "conversations" ("id", "silo_id", "agent_service_id", "mode", "updated_at") VALUES ('conversation-1', 'silo-1', 'service-1', 'agent_session', clock_timestamp());
INSERT INTO "conversation_participants" ("conversation_id", "user_id", "visible_from_position", "read_through_position") VALUES ('conversation-1', 'user-1', 1, 0);
INSERT INTO "agent_runs" ("id", "silo_id", "agent_service_id", "agent_revision_id", "conversation_id", "trigger", "delegated_user_id", "request_idempotency_key", "root_run_id", "effective_contract_digest", "input_snapshot_digest") VALUES ('run-1', 'silo-1', 'service-1', 'agent-1', 'conversation-1', 'interactive', 'user-1', 'request-1', 'run-1', 'sha256:' || repeat('b',64), 'sha256:' || repeat('c',64));

INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_conversation_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('change-1', 'silo-1', 'user-1', 'profile-1', 'service-1', 'conversation-1', 'run-1', '{"kind":"model_alias","modelAlias":"careful"}', 'sha256:' || repeat('d',64), 'persona-1', 'agent-1');
SELECT pg_temp.expect_failure('proposal evidence is immutable', $statement$UPDATE "personal_configuration_changes" SET "requested_patch"='{"kind":"model_alias","modelAlias":"unsafe"}' WHERE "id"='change-1'$statement$, 'proposal evidence is immutable');
SELECT pg_temp.expect_failure('proposal cannot be deleted', $statement$DELETE FROM "personal_configuration_changes" WHERE "id"='change-1'$statement$, 'cannot be deleted');
SELECT pg_temp.expect_failure('source ownership is enforced', $statement$INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_conversation_id", "source_run_id", "requested_patch", "requested_patch_digest") VALUES ('change-other-user', 'silo-1', 'user-2', 'profile-1', 'service-1', 'conversation-1', 'run-1', '{"kind":"model_alias","modelAlias":"careful"}', 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd')$statement$, 'source conversation requires the initiating participant');
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='change-1';
SELECT pg_temp.expect_failure('accepted decision evidence is immutable', $statement$UPDATE "personal_configuration_changes" SET "decided_by"='other-user' WHERE "id"='change-1'$statement$, 'decision evidence is immutable');
SELECT pg_temp.expect_failure('accepted proposal cannot return to proposed', $statement$UPDATE "personal_configuration_changes" SET "state"='proposed' WHERE "id"='change-1'$statement$, 'invalid lifecycle transition');
SELECT pg_temp.expect_failure('model alias cannot apply an unpublished or inactive revision', $statement$UPDATE "personal_configuration_changes" SET "state"='applied', "applied_agent_revision_id"='agent-1' WHERE "id"='change-1'$statement$, 'applied model_alias must activate its exact published personal AgentRevision');
SELECT pg_temp.expect_failure('unknown patch fields are rejected', $statement$INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_conversation_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('change-extra', 'silo-1', 'user-1', 'profile-1', 'service-1', 'conversation-1', 'run-1', '{"kind":"model_alias","modelAlias":"careful","budget":1}', 'sha256:' || repeat('e',64), 'persona-1', 'agent-1')$statement$, 'personal_configuration_changes_valid_check');
SELECT pg_temp.expect_failure('whitespace model alias is rejected', $statement$INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_conversation_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('change-whitespace', 'silo-1', 'user-1', 'profile-1', 'service-1', 'conversation-1', 'run-1', '{"kind":"model_alias","modelAlias":"\t"}', 'sha256:' || repeat('f',64), 'persona-1', 'agent-1')$statement$, 'personal_configuration_changes_valid_check');

SELECT pg_temp.expect_failure('refresh interview rejects a non-refresh proposal', $statement$INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "refresh_configuration_change_id", "question_set_id", "question_set_version", "scoring_policy_id", "scoring_policy_version", "interpolation_map_id", "interpolation_map_version") VALUES ('invalid-refresh-interview','profile-1','user-1','change-1','personal-agent-onboarding',1,'personal-agent-scoring',1,'personal-agent-interpolation',1)$statement$, 'PersonaInterview refresh must bind one accepted owner persona_refresh proposal');
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
INSERT INTO "personal_configuration_changes" ("id", "silo_id", "user_id", "persona_profile_id", "agent_service_id", "source_conversation_id", "source_run_id", "requested_patch", "requested_patch_digest", "expected_persona_revision_id", "expected_agent_revision_id") VALUES ('refresh-change-1', 'silo-1', 'user-1', 'profile-1', 'service-1', 'conversation-1', 'run-1', '{"kind":"persona_refresh"}', 'sha256:' || repeat('a',64), 'persona-1', 'agent-2');
UPDATE "personal_configuration_changes" SET "state"='accepted', "decided_at"=clock_timestamp(), "decided_by"='user-1' WHERE "id"='refresh-change-1';
INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "refresh_configuration_change_id", "question_set_id", "question_set_version", "scoring_policy_id", "scoring_policy_version", "interpolation_map_id", "interpolation_map_version") VALUES ('refresh-interview','profile-1','user-1','refresh-change-1','personal-agent-onboarding',1,'personal-agent-scoring',1,'personal-agent-interpolation',1);

ROLLBACK;
