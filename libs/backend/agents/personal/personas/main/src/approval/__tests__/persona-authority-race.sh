#!/usr/bin/env bash

set -euo pipefail

if command -v psql >/dev/null 2>&1; then
  : "${DATABASE_URL:?DATABASE_URL is required when authority races use the local psql client}"
  run_psql() {
    psql "$DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 "$@"
  }
elif [[ -n "${POSTGRES_TEST_CONTAINER:-}" ]] && command -v docker >/dev/null 2>&1; then
  run_psql() {
    docker exec --interactive "$POSTGRES_TEST_CONTAINER" psql \
      --username="${POSTGRES_TEST_USER:-postgres}" \
      --dbname="${POSTGRES_TEST_DATABASE:-opencrane}" \
      --no-psqlrc \
      --set=ON_ERROR_STOP=1 \
      "$@"
  }
else
  echo "psql or POSTGRES_TEST_CONTAINER plus docker is required for PostgreSQL authority races" >&2
  exit 2
fi

race_output_dir="$(mktemp -d)"
race_background_pids=()

cleanup_database() {
  run_psql >/dev/null <<'SQL'
SET session_replication_role = replica;
DELETE FROM "persona_insights" WHERE "persona_revision_id" = 'persona-race-revision-a';
DELETE FROM "persona_revisions" WHERE "id" = 'persona-race-revision-a';
DELETE FROM "persona_interview_scores" WHERE "interview_id" = 'persona-race-interview-a';
DELETE FROM "persona_interview_answers" WHERE "interview_id" = 'persona-race-interview-a';
DELETE FROM "user_onboardings" WHERE "id" = 'persona-race-onboarding';
DELETE FROM "persona_interviews" WHERE "id" IN ('persona-race-interview-a', 'persona-race-interview-b');
DELETE FROM "persona_profiles" WHERE "id" = 'persona-race-profile';
SET session_replication_role = origin;
SQL
}

cleanup() {
  set +e
  run_psql >/dev/null 2>&1 --command="
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE application_name IN ('persona-race-replace-first', 'persona-race-approve-second', 'persona-race-approve-first', 'persona-race-replace-second')
      AND pid <> pg_backend_pid();
  "
  for race_pid in "${race_background_pids[@]}"; do
    if kill -0 "$race_pid" >/dev/null 2>&1; then kill "$race_pid" >/dev/null 2>&1; fi
    wait "$race_pid" >/dev/null 2>&1
  done
  cleanup_database
  rm -rf "$race_output_dir"
}

trap cleanup EXIT
cleanup_database

wait_for_session_state() {
  local application_name="$1"
  local state_query="$2"
  local attempt
  local observed
  for attempt in $(seq 1 50); do
    observed="$(run_psql --tuples-only --no-align --command="
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE application_name = '$application_name' AND ($state_query)
      );
    ")"
    if [[ "$observed" == "t" ]]; then return 0; fi
    sleep 0.1
  done
  echo "FAIL: $application_name did not reach the expected transaction state" >&2
  return 1
}

run_psql <<'SQL'
INSERT INTO "persona_profiles" ("id", "silo_id", "user_id", "updated_at")
VALUES ('persona-race-profile', 'persona-race-silo', 'persona-race-user', clock_timestamp());
INSERT INTO "persona_interviews" (
  "id", "persona_profile_id", "user_id", "question_set_id", "question_set_version",
  "scoring_policy_id", "scoring_policy_version", "interpolation_map_id", "interpolation_map_version"
) VALUES
  ('persona-race-interview-a', 'persona-race-profile', 'persona-race-user', 'personal-agent-onboarding', 1, 'personal-agent-scoring', 1, 'personal-agent-interpolation', 1),
  ('persona-race-interview-b', 'persona-race-profile', 'persona-race-user', 'personal-agent-onboarding', 1, 'personal-agent-scoring', 1, 'personal-agent-interpolation', 1);
INSERT INTO "persona_interview_answers" ("id", "interview_id", "question_set_id", "question_set_version", "question_id", "choice_id")
SELECT 'persona-race-answer-' || question."ordinal", 'persona-race-interview-a', 'personal-agent-onboarding', 1, question."question_id", 'a'
FROM "persona_questions" question
WHERE question."question_set_id" = 'personal-agent-onboarding' AND question."question_set_version" = 1;
UPDATE "persona_interviews" SET "state" = 'completed', "completed_at" = clock_timestamp()
WHERE "id" = 'persona-race-interview-a';
INSERT INTO "persona_interview_scores" (
  "interview_id", "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest",
  "ordered_answer_ids", "ordered_choice_ids", "red", "yellow", "green", "blue", "colour_total",
  "explorer", "guardian", "openness_total", "primary_candidates", "secondary_candidates", "modifier_candidates"
)
SELECT 'persona-race-interview-a', 'personal-agent-scoring', 1, 'sha256:dd84a619e9a465cce882e63e523946502a325dd5b0dcb56fd7d33da6fd072af9',
  array_agg(answer."id" ORDER BY question."ordinal"), array_agg(answer."question_id" || ':' || answer."choice_id" ORDER BY question."ordinal"),
  23, 3, 0, 7, 33, 6, 0, 6, ARRAY['Red']::"PersonaColour"[], ARRAY['Blue']::"PersonaColour"[], ARRAY['Explorer']::"PersonaOpennessModifier"[]
FROM "persona_interview_answers" answer
JOIN "persona_questions" question ON question."question_set_id" = answer."question_set_id" AND question."question_set_version" = answer."question_set_version" AND question."question_id" = answer."question_id"
WHERE answer."interview_id" = 'persona-race-interview-a';
INSERT INTO "persona_revisions" (
  "id", "persona_profile_id", "revision", "soul_template_id", "soul_template_version", "soul_template_digest", "interview_id",
  "scoring_policy_id", "scoring_policy_version", "scoring_policy_digest", "interpolation_map_id", "interpolation_map_version", "interpolation_map_digest",
  "scoring_evidence", "primary_colour", "secondary_colour", "modifier", "compiled_instructions", "authored_by"
)
SELECT 'persona-race-revision-a', 'persona-race-profile', 1, 'commander-explorer', 1, 'sha256:8cf1b0a5180d7e1176efe7ebc857c1c2775ff0b3cd8591d07a3a42dc3c936efe', 'persona-race-interview-a',
  'personal-agent-scoring', 1, 'sha256:dd84a619e9a465cce882e63e523946502a325dd5b0dcb56fd7d33da6fd072af9',
  'personal-agent-interpolation', 1, 'sha256:3fe36e4967254849da2aa91b474510633bdc8c896a67febc24494b708a77f1d6',
  jsonb_build_object(
    'orderedAnswerIds', score."ordered_answer_ids", 'orderedChoiceIds', score."ordered_choice_ids",
    'colours', jsonb_build_object('red',23,'yellow',3,'green',0,'blue',7,'total',33),
        'openness', jsonb_build_object('explorer',6,'guardian',0,'total',6), 'tieResolutions', jsonb_build_array(),
    'primary','red','secondary','blue','modifier','explorer'
  ), 'Red', 'Blue', 'Explorer', '# Compiled race instructions', 'persona-race-user'
FROM "persona_interview_scores" score WHERE score."interview_id" = 'persona-race-interview-a';
INSERT INTO "persona_insights" ("id", "persona_revision_id", "category", "statement", "interview_id", "question_set_id", "question_set_version", "question_id", "answer_id") VALUES
  ('persona-race-insight-1','persona-race-revision-a','Response','Response evidence','persona-race-interview-a','personal-agent-onboarding',1,'q2-response-preference','persona-race-answer-2'),
  ('persona-race-insight-2','persona-race-revision-a','Feedback','Feedback evidence','persona-race-interview-a','personal-agent-onboarding',1,'q3-feedback-preference','persona-race-answer-3'),
  ('persona-race-insight-3','persona-race-revision-a','Challenge','Challenge evidence','persona-race-interview-a','personal-agent-onboarding',1,'q8-challenge-preference','persona-race-answer-8');
INSERT INTO "user_onboardings" ("id", "silo_id", "user_id", "workflow_version", "updated_at")
VALUES ('persona-race-onboarding', 'persona-race-silo', 'persona-race-user', 1, clock_timestamp());
UPDATE "user_onboardings"
SET "state" = 'survey_in_progress', "persona_interview_id" = 'persona-race-interview-a', "survey_started_at" = clock_timestamp(), "updated_at" = clock_timestamp()
WHERE "id" = 'persona-race-onboarding';
SQL

# Replacement owns the onboarding row first; approval must wait and then reject the stale draft.
(
  set +e
  run_psql >"$race_output_dir/replace-first.out" 2>&1 <<'SQL'
SET application_name = 'persona-race-replace-first';
BEGIN;
UPDATE "user_onboardings" SET "persona_interview_id" = 'persona-race-interview-b', "updated_at" = clock_timestamp()
WHERE "id" = 'persona-race-onboarding';
SELECT pg_sleep(2);
COMMIT;
SQL
  echo "$?" >"$race_output_dir/replace-first.status"
) &
replace_first_pid=$!
race_background_pids+=("$replace_first_pid")
wait_for_session_state 'persona-race-replace-first' "state = 'active' AND wait_event_type = 'Timeout' AND wait_event = 'PgSleep'"
(
  set +e
  run_psql >"$race_output_dir/approve-second.out" 2>&1 <<'SQL'
SET application_name = 'persona-race-approve-second';
UPDATE "persona_revisions" SET "state" = 'approved', "approved_by" = 'persona-race-user', "approved_at" = clock_timestamp()
WHERE "id" = 'persona-race-revision-a';
SQL
  echo "$?" >"$race_output_dir/approve-second.status"
) &
approve_second_pid=$!
race_background_pids+=("$approve_second_pid")
wait_for_session_state 'persona-race-approve-second' "cardinality(pg_blocking_pids(pid)) > 0"
wait "$replace_first_pid"
wait "$approve_second_pid"
if [[ "$(<"$race_output_dir/replace-first.status")" != "0" ]]; then cat "$race_output_dir/replace-first.out" >&2; exit 1; fi
if [[ "$(<"$race_output_dir/approve-second.status")" == "0" ]] || ! grep -q 'approval requires the current initial-survey interview' "$race_output_dir/approve-second.out"; then
  cat "$race_output_dir/approve-second.out" >&2
  echo 'FAIL: replacement-first race did not reject the stale persona approval' >&2
  exit 1
fi

run_psql --command="UPDATE \"user_onboardings\" SET \"persona_interview_id\" = 'persona-race-interview-a', \"updated_at\" = clock_timestamp() WHERE \"id\" = 'persona-race-onboarding';"

# Approval owns the same onboarding row first; replacement must wait and then reject active evidence.
(
  set +e
  run_psql >"$race_output_dir/approve-first.out" 2>&1 <<'SQL'
SET application_name = 'persona-race-approve-first';
BEGIN;
UPDATE "persona_revisions" SET "state" = 'approved', "approved_by" = 'persona-race-user', "approved_at" = clock_timestamp()
WHERE "id" = 'persona-race-revision-a';
UPDATE "persona_profiles" SET "active_revision_id" = 'persona-race-revision-a' WHERE "id" = 'persona-race-profile';
SELECT pg_sleep(2);
COMMIT;
SQL
  echo "$?" >"$race_output_dir/approve-first.status"
) &
approve_first_pid=$!
race_background_pids+=("$approve_first_pid")
wait_for_session_state 'persona-race-approve-first' "state = 'active' AND wait_event_type = 'Timeout' AND wait_event = 'PgSleep'"
(
  set +e
  run_psql >"$race_output_dir/replace-second.out" 2>&1 <<'SQL'
SET application_name = 'persona-race-replace-second';
UPDATE "user_onboardings" SET "persona_interview_id" = 'persona-race-interview-b', "updated_at" = clock_timestamp()
WHERE "id" = 'persona-race-onboarding';
SQL
  echo "$?" >"$race_output_dir/replace-second.status"
) &
replace_second_pid=$!
race_background_pids+=("$replace_second_pid")
wait_for_session_state 'persona-race-replace-second' "cardinality(pg_blocking_pids(pid)) > 0"
wait "$approve_first_pid"
wait "$replace_second_pid"
if [[ "$(<"$race_output_dir/approve-first.status")" != "0" ]]; then cat "$race_output_dir/approve-first.out" >&2; exit 1; fi
if [[ "$(<"$race_output_dir/replace-second.status")" == "0" ]] || ! grep -q 'cannot replace an interview after its persona became active' "$race_output_dir/replace-second.out"; then
  cat "$race_output_dir/replace-second.out" >&2
  echo 'FAIL: approval-first race did not preserve active persona provenance' >&2
  exit 1
fi

winner="$(run_psql --tuples-only --no-align --command="
  SELECT onboarding.persona_interview_id || ':' || profile.active_revision_id
  FROM user_onboardings onboarding
  JOIN persona_profiles profile ON profile.silo_id = onboarding.silo_id AND profile.user_id = onboarding.user_id
  WHERE onboarding.id = 'persona-race-onboarding';
")"
if [[ "$winner" != 'persona-race-interview-a:persona-race-revision-a' ]]; then
  echo "FAIL: approval-first race persisted unexpected winner $winner" >&2
  exit 1
fi

echo 'PASS: persona approval and onboarding replacement races preserve one deadlock-free winner'
