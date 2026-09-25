import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** These source contracts protect the reviewed SQL; PostgreSQL execution is a separate proof. */
const _SQL = readFileSync(resolve(import.meta.dirname, "../../prisma/bootstrap/target-baseline.sql"), "utf8");
const _RESPONSE_GUARD = /CREATE FUNCTION "enforce_elicitation_response_attempt_authority"\(\) RETURNS trigger[\s\S]*?\n\$\$;/u.exec(_SQL)?.[0] ?? "";
const _REQUEST_GUARD = /CREATE FUNCTION "enforce_elicitation_request_authority"\(\) RETURNS trigger[\s\S]*?\n\$\$;/u.exec(_SQL)?.[0] ?? "";

describe("collaborative clarification baseline contract", function _suite()
{
	it("keeps protected purposes assigned-only and the exact request locked", function _purposeBoundary()
	{
		expect(_RESPONSE_GUARD).toContain('WHERE "id" = NEW."request_id" FOR UPDATE;');
		expect(_RESPONSE_GUARD).toContain('(request_row."purpose" <> \'runtime_input\' AND request_row."assigned_participant_id" IS DISTINCT FROM NEW."responding_subject_id")');
		expect(_RESPONSE_GUARD).toContain('request_row."state" <> \'requested\'');
		expect(_RESPONSE_GUARD).toContain('request_row."expires_at" <= clock_timestamp()');
		expect(_RESPONSE_GUARD).toContain('request_row."requires_step_up"');
	});

	it("requires actual active child participation and organization membership", function _currentParticipant()
	{
		expect(_RESPONSE_GUARD).toContain('WHERE "conversation_id" = request_row."conversation_id" AND "user_id" = NEW."responding_subject_id" FOR UPDATE;');
		expect(_RESPONSE_GUARD).toContain('OR NOT FOUND OR participant_ended IS NOT NULL');
		expect(_RESPONSE_GUARD).toContain('WHERE "cluster_tenant" = request_row."silo_id" AND "subject" = NEW."responding_subject_id" AND "status" = \'active\'\n          FOR SHARE;');
	});

	it("requires the same waiting run, attempt, silo and conversation on a fresh response", function _currentRun()
	{
		expect(_RESPONSE_GUARD).toContain('WHERE "id" = request_row."run_id" AND "silo_id" = request_row."silo_id"');
		expect(_RESPONSE_GUARD).toContain('AND "conversation_id" = request_row."conversation_id" AND "attempt" = request_row."attempt"');
		expect(_RESPONSE_GUARD).toContain('AND "state" = \'waiting_for_input\'\n          FOR SHARE;');
	});

	it("requires a ready child and its explicit frozen audience when a child request exists", function _childAudience()
	{
		expect(_RESPONSE_GUARD).toContain('IF request_row."purpose" = \'runtime_input\' THEN');
		expect(_RESPONSE_GUARD).toContain('WHERE "child_conversation_id" = request_row."conversation_id" FOR SHARE;');
		expect(_RESPONSE_GUARD).toContain('child_request."silo_id" IS DISTINCT FROM request_row."silo_id" OR child_request."state" <> \'ready\'');
		expect(_RESPONSE_GUARD).toContain('jsonb_typeof(child_request."participant_subject_ids") IS DISTINCT FROM \'array\'');
		expect(_RESPONSE_GUARD).toContain('OR NOT (child_request."participant_subject_ids" ? NEW."responding_subject_id")');
	});

	it("requires current access to the frozen parent source instead of parent membership alone", function _parentSource()
	{
		expect(_RESPONSE_GUARD).toContain('parent."id" = child_request."parent_conversation_id" AND parent."silo_id" = request_row."silo_id"');
		expect(_RESPONSE_GUARD).toContain('parent."mode" = \'group\' AND participant."user_id" = NEW."responding_subject_id"');
		expect(_RESPONSE_GUARD).toContain('participant."access_ended_position" IS NULL');
		expect(_RESPONSE_GUARD).toContain('participant."visible_from_position" <= child_request."parent_message_position"');
		expect(_RESPONSE_GUARD).toContain('FOR SHARE OF parent, participant;');
	});

	it("binds answered and declined clarifications to exactly one recorded winner", function _winner()
	{
		expect(_REQUEST_GUARD).toContain('NEW."purpose" = \'runtime_input\' AND NEW."state" IN (\'answered\', \'declined\')');
		expect(_REQUEST_GUARD).toContain('SELECT count(*) INTO response_count FROM "elicitation_response_attempts" WHERE "request_id" = NEW."id";');
		expect(_REQUEST_GUARD).toContain('IF response_count <> 1 THEN');
		expect(_REQUEST_GUARD).toContain('NEW."resolved_by" IS DISTINCT FROM response_row."responding_subject_id"');
		expect(_REQUEST_GUARD).toContain('NEW."resolved_at" IS DISTINCT FROM response_row."submitted_at"');
		expect(_REQUEST_GUARD).toContain('response_row."response"->>\'kind\' = \'approval\' AND response_row."response"->\'approved\' = \'false\'::jsonb');
	});

	it("keeps request coordinates, completed resolutions and response attempts immutable", function _immutability()
	{
		for (const field of ["id", "silo_id", "conversation_id", "run_id", "attempt", "assigned_participant_id", "purpose", "body", "purpose_payload", "requires_step_up", "expires_at"])
			expect(_REQUEST_GUARD).toContain(`NEW."${field}" IS DISTINCT FROM OLD."${field}"`);
		expect(_REQUEST_GUARD).toContain('IF OLD."state" <> \'requested\' OR NEW."state" = \'requested\' THEN');
		expect(_RESPONSE_GUARD).toContain("ElicitationResponseAttempt rows are immutable");
		expect(_RESPONSE_GUARD).toContain("ElicitationResponseAttempt rows cannot be deleted");
	});
});
