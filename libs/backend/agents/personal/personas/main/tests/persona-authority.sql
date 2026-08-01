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

SELECT pg_temp.assert_true((SELECT count(*) = 8 FROM "persona_questions" WHERE "question_set_id" = 'personal-agent-onboarding' AND "question_set_version" = 1), 'clean baseline seeds all eight onboarding questions');
SELECT pg_temp.assert_true((SELECT "state" = 'reviewed' AND "reviewed_by" = 'opencrane-clean-build' FROM "persona_question_sets" WHERE "question_set_id" = 'personal-agent-onboarding' AND "version" = 1), 'clean baseline freezes the onboarding question set as reviewed');
SELECT pg_temp.assert_true((SELECT count(*) = 2 AND bool_and("digest" = 'sha256:ffe3cf4b656e733d0eaf0a8d65d6e330c1e3bc2710f90e026ed30662022b2354') FROM "persona_soul_templates" WHERE "template_id" IN ('direct-partner', 'supportive-partner') AND "version" = 1), 'clean baseline seeds two content-addressed SOUL templates');

INSERT INTO "persona_question_sets" ("question_set_id", "version") VALUES ('onboarding', 1);
INSERT INTO "persona_questions" ("question_set_id", "question_set_version", "question_id", "category", "prompt", "ordinal") VALUES
('onboarding',1,'q1','relationship_role','Role?',1), ('onboarding',1,'q2','tone_language','Tone?',2),
('onboarding',1,'q3','answer_structure','Structure?',3), ('onboarding',1,'q4','challenge_support','Challenge?',4),
('onboarding',1,'q5','initiative','Initiative?',5), ('onboarding',1,'q6','approval_risk','Risk?',6),
('onboarding',1,'q7','working_habits','Habits?',7), ('onboarding',1,'q8','memory_boundaries','Memory?',8);
UPDATE "persona_question_sets" SET "state"='reviewed', "reviewed_by"='reviewer-1', "reviewed_at"=clock_timestamp() WHERE "question_set_id"='onboarding' AND "version"=1;
SELECT pg_temp.expect_failure('reviewed question set cannot gain questions', $statement$INSERT INTO "persona_questions" ("question_set_id", "question_set_version", "question_id", "category", "prompt", "ordinal") VALUES ('onboarding',1,'q9','memory_boundaries','Late?',9)$statement$, 'only while PersonaQuestionSet is Draft');
INSERT INTO "persona_profiles" ("id", "silo_id", "user_id", "updated_at") VALUES ('profile-1', 'silo-persona', 'user-1', clock_timestamp());
INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "question_set_id", "question_set_version") VALUES ('interview-1','profile-1','user-1','onboarding',1);
SELECT pg_temp.expect_failure('interview start evidence cannot be rewritten', $statement$UPDATE "persona_interviews" SET "started_at" = clock_timestamp() + interval '1 second' WHERE "id"='interview-1'$statement$, 'owner, question set, and start evidence are immutable');
INSERT INTO "persona_interviews" ("id", "persona_profile_id", "user_id", "question_set_id", "question_set_version") VALUES ('interview-retake','profile-1','user-1','onboarding',1);
SELECT pg_temp.assert_true((SELECT "state" = 'in_progress' FROM "persona_interviews" WHERE "id" = 'interview-retake'), 'persona retake is a new in-progress interview');
INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "value")
SELECT 'answer-' || "ordinal", 'interview-1', 'onboarding', 1, "question_id", 'answer' FROM "persona_questions" WHERE "question_set_id"='onboarding' AND "question_set_version"=1;
SELECT pg_temp.expect_failure('answer must bind a declared question', $statement$INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "value") VALUES ('missing-question-answer','interview-1','onboarding',1,'missing-question','answer')$statement$, 'persona_interview_answers_question_fkey');
UPDATE "persona_interviews" SET "state"='completed', "completed_at"=clock_timestamp() WHERE "id"='interview-1';
SELECT pg_temp.expect_failure('completed interview cannot gain answers', $statement$INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "value") VALUES ('late-answer','interview-1','onboarding',1,'q1','changed')$statement$, 'only while PersonaInterview is InProgress');
INSERT INTO "persona_soul_templates" ("template_id", "version", "digest", "content", "selection_rules", "reviewed_by", "reviewed_at") VALUES ('collaborator',1,'sha256:'||repeat('d',64),'# Soul','[{"id":"collaborator-rule","priority":10,"answers":{"q1":"answer"}}]','reviewer-1',clock_timestamp());
INSERT INTO "persona_revisions" ("id", "persona_profile_id", "revision", "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id", "selection_rule_id", "selection_answer_ids", "compiled_instructions", "authored_by") VALUES ('persona-1','profile-1',1,'collaborator',1,'sha256:'||repeat('d',64),'interview-1','collaborator-rule',ARRAY['answer-1'],'# Compiled','user-1');
INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES
('insight-1','persona-1','relationship_role','Insight one','interview-1','onboarding',1,'q1','answer-1'),
('insight-2','persona-1','tone_language','Insight two','interview-1','onboarding',1,'q2','answer-2'),
('insight-3','persona-1','answer_structure','Insight three','interview-1','onboarding',1,'q3','answer-3');
SELECT pg_temp.expect_failure('insight must bind its exact interview answer', $statement$INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES ('missing-answer-insight','persona-1','relationship_role','missing answer','interview-1','onboarding',1,'q1','missing-answer')$statement$, 'persona_insights_answer_provenance_fkey');
SELECT pg_temp.expect_failure('insight category must match question', $statement$INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES ('bad-insight','persona-1','initiative','wrong','interview-1','onboarding',1,'q4','answer-4')$statement$, 'exact question category');
UPDATE "persona_revisions" SET "state"='approved', "approved_by"='user-1', "approved_at"=clock_timestamp() WHERE "id"='persona-1';
UPDATE "persona_profiles" SET "active_revision_id"='persona-1' WHERE "id"='profile-1';
SELECT pg_temp.expect_failure('approved persona content is immutable', $statement$UPDATE "persona_revisions" SET "compiled_instructions"='changed' WHERE "id"='persona-1'$statement$, 'approved PersonaRevision is immutable');
SELECT pg_temp.expect_failure('approved persona cannot gain insights', $statement$INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES ('late-insight','persona-1','challenge_support','late','interview-1','onboarding',1,'q4','answer-4')$statement$, 'only while PersonaRevision is Draft');

ROLLBACK;
