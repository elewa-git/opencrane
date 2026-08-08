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

CREATE FUNCTION pg_temp.assert_true(condition BOOLEAN, message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', message; END IF;
END;
$$;

SELECT pg_temp.assert_true((SELECT count(*) = 10 FROM "persona_questions" WHERE "question_set_id" = 'personal-agent-onboarding' AND "question_set_version" = 1), 'clean baseline seeds all ten onboarding questions');
SELECT pg_temp.assert_true((SELECT count(*) = 37 FROM "persona_question_choices" WHERE "question_set_id" = 'personal-agent-onboarding' AND "question_set_version" = 1), 'clean baseline seeds every reviewed answer choice');
SELECT pg_temp.assert_true((SELECT count(*) = 37 FROM "persona_scoring_weights" WHERE "scoring_policy_id" = 'personal-agent-scoring' AND "scoring_policy_version" = 1), 'clean baseline seeds every reviewed scoring weight');
SELECT pg_temp.assert_true((SELECT "state" = 'reviewed' AND "reviewed_by" = 'opencrane-clean-build' FROM "persona_question_sets" WHERE "question_set_id" = 'personal-agent-onboarding' AND "version" = 1), 'clean baseline freezes the onboarding question set as reviewed');
SELECT pg_temp.assert_true((SELECT count(*) = 8 FROM "persona_soul_templates" WHERE "version" = 1), 'clean baseline seeds all eight colour and modifier SOUL templates');

SELECT pg_temp.expect_failure('reviewed question set cannot gain questions', $statement$
    INSERT INTO "persona_questions" ("question_set_id", "question_set_version", "question_id", "category", "prompt", "ordinal")
    VALUES ('personal-agent-onboarding',1,'late-question','Tone','Late?',11)
$statement$, 'only while PersonaQuestionSet is Draft');
SELECT pg_temp.expect_failure('template source requires exact placeholders', $statement$
    INSERT INTO "persona_soul_templates" ("template_id", "version", "digest", "display_name", "primary_colour", "modifier", "content", "reviewed_by", "reviewed_at")
    VALUES ('invalid-template',2,'sha256:'||repeat('a',64),'Invalid','Red','Explorer','# Missing variables','reviewer-1',clock_timestamp())
$statement$, 'each reviewed runtime placeholder exactly once');

INSERT INTO "persona_profiles" ("id", "silo_id", "user_id", "updated_at") VALUES
    ('profile-1', 'silo-persona', 'user-1', clock_timestamp()),
    ('profile-foreign-silo', 'silo-foreign', 'user-1', clock_timestamp()),
    ('profile-wrong-subject', 'silo-persona', 'user-2', clock_timestamp());
INSERT INTO "persona_interviews" (
    "id", "persona_profile_id", "user_id", "question_set_id", "question_set_version",
    "scoring_policy_id", "scoring_policy_version", "interpolation_map_id", "interpolation_map_version"
) VALUES
    ('interview-1', 'profile-1', 'user-1', 'personal-agent-onboarding', 1,
        'personal-agent-scoring', 1, 'personal-agent-interpolation', 1),
    ('interview-2', 'profile-1', 'user-1', 'personal-agent-onboarding', 1,
        'personal-agent-scoring', 1, 'personal-agent-interpolation', 1),
    ('interview-foreign-silo', 'profile-foreign-silo', 'user-1', 'personal-agent-onboarding', 1,
        'personal-agent-scoring', 1, 'personal-agent-interpolation', 1),
    ('interview-wrong-subject', 'profile-wrong-subject', 'user-2', 'personal-agent-onboarding', 1,
        'personal-agent-scoring', 1, 'personal-agent-interpolation', 1);
SELECT pg_temp.expect_failure('interview reviewed sources cannot be rewritten', $statement$
    UPDATE "persona_interviews" SET "scoring_policy_version" = 2 WHERE "id" = 'interview-1'
$statement$, 'owner and reviewed source evidence are immutable');

INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "choice_id")
SELECT 'answer-' || question."ordinal", 'interview-1', 'personal-agent-onboarding', 1, question."question_id", 'a'
FROM "persona_questions" question
WHERE question."question_set_id" = 'personal-agent-onboarding' AND question."question_set_version" = 1;
SELECT pg_temp.expect_failure('answer must bind an exact reviewed choice', $statement$
    INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "choice_id")
    VALUES ('invalid-choice','interview-1','personal-agent-onboarding',1,'q1-decision-speed','missing')
$statement$, 'persona_interview_answers_question_set_id_question_set_ver_fkey');
UPDATE "persona_interviews" SET "state" = 'completed', "completed_at" = clock_timestamp() WHERE "id" = 'interview-1';
SELECT pg_temp.expect_failure('completed interview cannot gain answers', $statement$
    INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "choice_id")
    VALUES ('late-answer','interview-1','personal-agent-onboarding',1,'q1-decision-speed','a')
$statement$, 'only while PersonaInterview is InProgress');

INSERT INTO "persona_interview_scores" (
    "interview_id", "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest",
    "ordered_answer_ids", "ordered_choice_ids", "red", "yellow", "green", "blue", "colour_total",
    "explorer", "guardian", "openness_total", "primary_candidates", "secondary_candidates", "modifier_candidates"
)
SELECT 'interview-1', 'personal-agent-scoring', 1, 'sha256:dd84a619e9a465cce882e63e523946502a325dd5b0dcb56fd7d33da6fd072af9',
    array_agg(answer."id" ORDER BY question."ordinal"), array_agg(answer."question_id" || ':' || answer."choice_id" ORDER BY question."ordinal"),
    23, 3, 0, 7, 33, 6, 0, 6, ARRAY['Red']::"PersonaColour"[], ARRAY['Blue']::"PersonaColour"[], ARRAY['Explorer']::"PersonaOpennessModifier"[]
FROM "persona_interview_answers" answer
JOIN "persona_questions" question ON question."question_set_id" = answer."question_set_id" AND question."question_set_version" = answer."question_set_version" AND question."question_id" = answer."question_id"
WHERE answer."interview_id" = 'interview-1';
SELECT pg_temp.expect_failure('tie resolution actor must own the interview', $statement$
    INSERT INTO "persona_tie_resolutions" (
        "id", "interview_id", "scoring_policy_id", "scoring_policy_version", "kind",
        "candidates", "selected_value", "resolved_by", "resolved_at"
    ) VALUES (
        'forged-resolution', 'interview-1', 'personal-agent-scoring', 1, 'Primary',
        ARRAY['red','blue'], 'red', 'attacker', clock_timestamp()
    )
$statement$, 'resolver must equal the interview owner');

INSERT INTO "persona_revisions" (
    "id", "persona_profile_id", "revision", "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id",
    "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest", "interpolation_map_id", "interpolation_map_version", "interpolation_map_digest",
    "scoring_evidence", "primary_colour", "secondary_colour", "modifier", "compiled_instructions", "authored_by"
)
SELECT 'persona-1', 'profile-1', 1, 'commander-explorer', 1, 'sha256:8cf1b0a5180d7e1176efe7ebc857c1c2775ff0b3cd8591d07a3a42dc3c936efe', 'interview-1',
    'personal-agent-scoring', 1, 'sha256:dd84a619e9a465cce882e63e523946502a325dd5b0dcb56fd7d33da6fd072af9',
    'personal-agent-interpolation', 1, 'sha256:3fe36e4967254849da2aa91b474510633bdc8c896a67febc24494b708a77f1d6',
    jsonb_build_object(
        'orderedAnswerIds', score."ordered_answer_ids", 'orderedChoiceIds', score."ordered_choice_ids",
        'colours', jsonb_build_object('red',23,'yellow',3,'green',0,'blue',7,'total',33),
        'openness', jsonb_build_object('explorer',6,'guardian',0,'total',6),
        'primary','red','secondary','blue','modifier','explorer'
    ), 'Red', 'Blue', 'Explorer', '# Compiled instructions', 'user-1'
FROM "persona_interview_scores" score WHERE score."interview_id" = 'interview-1';
SELECT pg_temp.expect_failure('persona revision author must own the profile and interview', $statement$
    INSERT INTO "persona_revisions" (
        "id", "persona_profile_id", "revision", "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id",
        "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest", "interpolation_map_id", "interpolation_map_version", "interpolation_map_digest",
        "scoring_evidence", "primary_colour", "secondary_colour", "modifier", "compiled_instructions", "authored_by"
    )
    SELECT 'persona-forged-author', "persona_profile_id", 2, "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id",
        "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest", "interpolation_map_id", "interpolation_map_version", "interpolation_map_digest",
        "scoring_evidence", "primary_colour", "secondary_colour", "modifier", "compiled_instructions", 'attacker'
    FROM "persona_revisions" WHERE "id" = 'persona-1'
$statement$, 'author must equal the profile and interview owner');
INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES
    ('insight-1','persona-1','Response','Response evidence','interview-1','personal-agent-onboarding',1,'q2-response-preference','answer-2'),
    ('insight-2','persona-1','Feedback','Feedback evidence','interview-1','personal-agent-onboarding',1,'q3-feedback-preference','answer-3'),
    ('insight-3','persona-1','Challenge','Challenge evidence','interview-1','personal-agent-onboarding',1,'q8-challenge-preference','answer-8'),
    ('insight-4','persona-1','Relationship','Relationship evidence','interview-1','personal-agent-onboarding',1,'q9-relationship-model','answer-9');
UPDATE "persona_revisions" SET "state" = 'approved', "approved_by" = 'user-1', "approved_at" = clock_timestamp() WHERE "id" = 'persona-1';
INSERT INTO "persona_revisions" (
    "id", "persona_profile_id", "revision", "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id",
    "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest", "interpolation_map_id", "interpolation_map_version", "interpolation_map_digest",
    "scoring_evidence", "primary_colour", "secondary_colour", "modifier", "compiled_instructions", "previous_revision_id", "authored_by"
)
SELECT 'persona-pending-approval', "persona_profile_id", 2, "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id",
    "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest", "interpolation_map_id", "interpolation_map_version", "interpolation_map_digest",
    "scoring_evidence", "primary_colour", "secondary_colour", "modifier", "compiled_instructions", 'persona-1', 'user-1'
FROM "persona_revisions" WHERE "id" = 'persona-1';
INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES
    ('pending-insight-1','persona-pending-approval','Response','Response evidence','interview-1','personal-agent-onboarding',1,'q2-response-preference','answer-2'),
    ('pending-insight-2','persona-pending-approval','Feedback','Feedback evidence','interview-1','personal-agent-onboarding',1,'q3-feedback-preference','answer-3'),
    ('pending-insight-3','persona-pending-approval','Challenge','Challenge evidence','interview-1','personal-agent-onboarding',1,'q8-challenge-preference','answer-8');
SELECT pg_temp.expect_failure('persona revision approver must own the profile and interview', $statement$
    UPDATE "persona_revisions" SET "state" = 'approved', "approved_by" = 'attacker', "approved_at" = clock_timestamp()
    WHERE "id" = 'persona-pending-approval'
$statement$, 'approval actor must equal the profile and interview owner');
UPDATE "persona_profiles" SET "active_revision_id" = 'persona-1' WHERE "id" = 'profile-1';
SELECT pg_temp.expect_failure('approved persona content is immutable', $statement$
    UPDATE "persona_revisions" SET "compiled_instructions" = 'changed' WHERE "id" = 'persona-1'
$statement$, 'approved PersonaRevision is immutable');

INSERT INTO "user_onboardings" ("id", "silo_id", "user_id", "workflow_version", "updated_at")
VALUES ('onboarding-1', 'silo-persona', 'user-1', 1, clock_timestamp());
SELECT pg_temp.expect_failure('survey pending cannot jump to migrated completion', $statement$
    UPDATE "user_onboardings" SET "state" = 'completed', "completion_provenance" = 'existing_user_migration',
        "completion_migration_revision" = 'migration-v1', "completion_migration_batch" = 'batch-1',
        "completed_at" = clock_timestamp(), "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1'
$statement$, 'invalid UserOnboarding state transition');
UPDATE "user_onboardings" SET "state" = 'survey_in_progress', "persona_interview_id" = 'interview-1', "survey_started_at" = clock_timestamp(), "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1';
SELECT pg_temp.expect_failure('onboarding rejects a foreign-silo interview', $statement$
    UPDATE "user_onboardings" SET "persona_interview_id" = 'interview-foreign-silo', "updated_at" = clock_timestamp()
    WHERE "id" = 'onboarding-1'
$statement$, 'interview must exist and belong to the same silo and subject');
SELECT pg_temp.expect_failure('onboarding rejects another subjects interview', $statement$
    UPDATE "user_onboardings" SET "persona_interview_id" = 'interview-wrong-subject', "updated_at" = clock_timestamp()
    WHERE "id" = 'onboarding-1'
$statement$, 'interview must exist and belong to the same silo and subject');
SELECT pg_temp.expect_failure('onboarding rejects a nonexistent interview', $statement$
    UPDATE "user_onboardings" SET "persona_interview_id" = 'interview-missing', "updated_at" = clock_timestamp()
    WHERE "id" = 'onboarding-1'
$statement$, 'interview must exist and belong to the same silo and subject');
UPDATE "user_onboardings" SET "persona_interview_id" = 'interview-2', "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1';
DO $$
BEGIN
    IF (SELECT "persona_interview_id" FROM "user_onboardings" WHERE "id" = 'onboarding-1') IS DISTINCT FROM 'interview-2' THEN
        RAISE EXCEPTION 'initial survey interview replacement did not persist';
    END IF;
END;
$$;
SELECT pg_temp.expect_failure('onboarding revision must derive from the pinned interview', $statement$
    UPDATE "user_onboardings" SET "state" = 'bootstrap_chat_pending', "persona_revision_id" = 'persona-1', "updated_at" = clock_timestamp()
    WHERE "id" = 'onboarding-1'
$statement$, 'revision must be approved, owned by the interview profile, and derived from the pinned interview');
UPDATE "user_onboardings" SET "persona_interview_id" = 'interview-1', "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1';
SELECT pg_temp.expect_failure('onboarding rejects an unapproved persona revision', $statement$
    UPDATE "user_onboardings" SET "state" = 'bootstrap_chat_pending', "persona_revision_id" = 'persona-pending-approval', "updated_at" = clock_timestamp()
    WHERE "id" = 'onboarding-1'
$statement$, 'revision must be approved, owned by the interview profile, and derived from the pinned interview');
UPDATE "user_onboardings" SET "state" = 'bootstrap_chat_pending', "persona_revision_id" = 'persona-1', "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1';
SELECT pg_temp.expect_failure('interview provenance freezes after the initial survey', $statement$
    UPDATE "user_onboardings" SET "persona_interview_id" = 'interview-2', "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1'
$statement$, 'interview provenance is immutable outside the initial survey');
SELECT pg_temp.expect_failure('onboarding provenance cannot be rewritten', $statement$
    UPDATE "user_onboardings" SET "persona_revision_id" = 'different', "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1'
$statement$, 'provenance is immutable once pinned');
SELECT pg_temp.expect_failure('bootstrap start requires retrievable content and digest evidence', $statement$
    UPDATE "user_onboardings" SET "state" = 'bootstrap_chat_in_progress', "bootstrap_conversation_id" = 'conversation-1',
        "bootstrap_content_revision_id" = 'bootstrap-v1', "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1'
$statement$, 'user_onboardings_valid_check');
UPDATE "user_onboardings" SET "state" = 'bootstrap_chat_in_progress', "bootstrap_conversation_id" = 'conversation-1',
    "bootstrap_content_revision_id" = 'bootstrap-v1', "bootstrap_content_digest" = 'sha256:' || repeat('a',64),
    "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1';
SELECT pg_temp.expect_failure('bootstrap completion requires an exact completed timestamp', $statement$
    UPDATE "user_onboardings" SET "state" = 'completed', "completion_provenance" = 'bootstrap_concluded',
        "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1'
$statement$, 'user_onboardings_valid_check');
UPDATE "user_onboardings" SET "state" = 'completed', "completion_provenance" = 'bootstrap_concluded',
    "completed_at" = clock_timestamp(), "updated_at" = clock_timestamp() WHERE "id" = 'onboarding-1';

ROLLBACK;
