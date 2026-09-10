import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Client } from "pg";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

/** Values retained by the SQL proof after the fixture transaction commits. */
export interface PersonalAgentProfileRepairSqlFixture
{
	readonly siloId: string;
	readonly principalId: string;
	readonly onboardingId: string;
	readonly agentServiceId: string;
	readonly agentRevisionId: string;
	readonly personaProfileId: string;
	readonly personaRevisionId: string;
	readonly sourceWorkloadProfile: string;
	readonly targetWorkloadProfile: string;
}

/** Seed one completed onboarding whose deterministic personal service has never admitted work. */
export async function _SeedPersonalAgentProfileRepairSqlFixture(options: { readonly agentServiceEditEffect?: "allow" | "deny" } = {}): Promise<PersonalAgentProfileRepairSqlFixture>
{
	const prefix = `profile-repair-${randomUUID()}`;
	const id = (suffix: string) => `${prefix}-${suffix}`;
	const siloId = id("silo");
	const principalId = id("principal");
	const onboardingId = id("onboarding");
	const agentRevisionId = id("agent-revision");
	const modelDefinitionId = id("model");
	const now = new Date();
	const setup = new Client({ connectionString: process.env.DATABASE_URL });
	await setup.connect();
	try
	{
		await setup.query(await readFile(new URL("../../../../../scripts/sql/authority-fixtures.sql", import.meta.url), "utf8"));
		await setup.query("BEGIN");
		await setup.query("SELECT pg_temp.seed_silo_model($1, $2)", [siloId, modelDefinitionId]);
		await setup.query("SELECT pg_temp.seed_external_user($1, $2)", [siloId, principalId]);
		await setup.query("INSERT INTO org_memberships (id, cluster_tenant, subject, role, status, updated_at) VALUES ($1, $2, $3, 'member', 'active', $4)", [id("membership"), siloId, principalId, now]);
		const persona = await _SeedApprovedPersona(setup, id, siloId, principalId, now);
		await _SeedCompletedOnboarding(setup, id, { onboardingId, siloId, principalId, persona }, now);
		await setup.query("INSERT INTO agent_services (id, silo_id, kind, name, workload_profile, updated_at) VALUES ($1, $2, 'personal', 'Profile repair assistant', 'retired-personal', $3)", [onboardingId, siloId, now]);
		await setup.query("INSERT INTO agent_revisions (id, silo_id, agent_service_id, revision, digest, prompt_policy_version, model_definition_id, budget, authored_by, persona_revision_id) VALUES ($1, $2, $3, 1, $4, 'profile-repair-v1', $5, '{}'::jsonb, $6, $7)", [agentRevisionId, siloId, onboardingId, ___DigestCanonicalJson(agentRevisionId), modelDefinitionId, principalId, persona.personaRevisionId]);
		await setup.query("UPDATE agent_revisions SET state='published', published_at=$2 WHERE id=$1", [agentRevisionId, now]);
		await setup.query("UPDATE agent_services SET state='active', active_revision_id=$2 WHERE id=$1", [onboardingId, agentRevisionId]);
		await _SeedGrant(setup, id("agent-service-edit-grant"), siloId, principalId, `personal-agent-owner-access:${principalId}`, ProductAuthorizationResourceKinds.AgentService, onboardingId, ProductAuthorizationActions.Edit, options.agentServiceEditEffect ?? "allow");
		await _SeedGrant(setup, id("conversation-create-grant"), siloId, principalId, id("conversation-grant-manager"), ProductAuthorizationResourceKinds.ConversationCollection, siloId, ProductAuthorizationActions.Create, "allow");
		await setup.query("COMMIT");
		return { siloId, principalId, onboardingId, agentServiceId: onboardingId, agentRevisionId, personaProfileId: persona.personaProfileId, personaRevisionId: persona.personaRevisionId, sourceWorkloadProfile: "retired-personal", targetWorkloadProfile: "personal-default" };
	}
	catch (error)
	{
		await setup.query("ROLLBACK");
		throw error;
	}
	finally
	{
		await setup.end();
	}
}

/** Build one approved active persona from the immutable baseline definitions. */
async function _SeedApprovedPersona(setup: Client, id: (suffix: string) => string, siloId: string, principalId: string, now: Date): Promise<{ readonly personaProfileId: string; readonly personaRevisionId: string; readonly interviewId: string }>
{
	const personaProfileId = id("persona-profile");
	const personaRevisionId = id("persona-revision");
	const interviewId = id("interview");
	const scoringDigest = "sha256:dd84a619e9a465cce882e63e523946502a325dd5b0dcb56fd7d33da6fd072af9";
	const templateDigest = "sha256:8cf1b0a5180d7e1176efe7ebc857c1c2775ff0b3cd8591d07a3a42dc3c936efe";
	const interpolationDigest = "sha256:3fe36e4967254849da2aa91b474510633bdc8c896a67febc24494b708a77f1d6";
	const questions = ["q1-decision-speed", "q2-response-preference", "q3-feedback-preference", "q4-meeting-energy", "q5-new-ideas", "q6-risk-appetite", "q7-suggestion-cadence", "q8-challenge-preference", "q9-relationship-model", "q10-tone-preference"];
	const answerIds = questions.map((_question, index) => id(`persona-answer-${index + 1}`));
	const choiceIds = questions.map((question, index) => `${question}:${index === 8 ? "b" : "a"}`);
	await setup.query("INSERT INTO persona_profiles (id, silo_id, user_id, updated_at) VALUES ($1, $2, $3, $4)", [personaProfileId, siloId, principalId, now]);
	await setup.query("INSERT INTO persona_interviews (id, persona_profile_id, user_id, question_set_id, question_set_version, scoring_policy_id, scoring_policy_version, interpolation_map_id, interpolation_map_version) VALUES ($1, $2, $3, 'personal-agent-onboarding', 1, 'personal-agent-scoring', 1, 'personal-agent-interpolation', 1)", [interviewId, personaProfileId, principalId]);
	for (const [index, question] of questions.entries())
		await setup.query("INSERT INTO persona_interview_answers (id, interview_id, question_set_id, question_set_version, question_id, choice_id) VALUES ($1, $2, 'personal-agent-onboarding', 1, $3, $4)", [answerIds[index], interviewId, question, index === 8 ? "b" : "a"]);
	await setup.query("UPDATE persona_interviews SET state='completed', completed_at=$2 WHERE id=$1", [interviewId, now]);
	await setup.query("INSERT INTO persona_interview_scores (interview_id, scoring_policy_id, scoring_policy_version, scoring_policy_digest, ordered_answer_ids, ordered_choice_ids, red, yellow, green, blue, colour_total, explorer, guardian, openness_total, primary_candidates, secondary_candidates, modifier_candidates) VALUES ($1, 'personal-agent-scoring', 1, $2, $3::text[], $4::text[], 21, 6, 0, 5, 32, 7, 0, 7, ARRAY['Red']::\"PersonaColour\"[], ARRAY['Yellow']::\"PersonaColour\"[], ARRAY['Explorer']::\"PersonaOpennessModifier\"[])", [interviewId, scoringDigest, answerIds, choiceIds]);
	const evidence = { orderedAnswerIds: answerIds, orderedChoiceIds: choiceIds, colours: { red: 21, yellow: 6, green: 0, blue: 5, total: 32 }, openness: { explorer: 7, guardian: 0, total: 7 }, tieResolutions: [], primary: "red", secondary: "yellow", modifier: "explorer" };
	await setup.query("INSERT INTO persona_revisions (id, persona_profile_id, revision, soul_template_id, soul_template_version, soul_template_digest, interview_id, scoring_policy_id, scoring_policy_version, scoring_policy_digest, interpolation_map_id, interpolation_map_version, interpolation_map_digest, scoring_evidence, primary_colour, secondary_colour, modifier, compiled_instructions, authored_by) VALUES ($1, $2, 1, 'commander-explorer', 1, $3, $4, 'personal-agent-scoring', 1, $5, 'personal-agent-interpolation', 1, $6, $7::jsonb, 'Red', 'Yellow', 'Explorer', '# Compiled profile repair persona', $8)", [personaRevisionId, personaProfileId, templateDigest, interviewId, scoringDigest, interpolationDigest, JSON.stringify(evidence), principalId]);
	for (const [index, category] of [[1, "Response"], [2, "Feedback"], [7, "Challenge"]] as const)
		await setup.query("INSERT INTO persona_insights (id, persona_revision_id, category, statement, interview_id, question_set_id, question_set_version, question_id, answer_id) VALUES ($1, $2, $3, 'Profile repair fixture preference', $4, 'personal-agent-onboarding', 1, $5, $6)", [id(`persona-insight-${index}`), personaRevisionId, category, interviewId, questions[index], answerIds[index]]);
	await setup.query("UPDATE persona_revisions SET state='approved', approved_by=$2, approved_at=$3 WHERE id=$1", [personaRevisionId, principalId, now]);
	await setup.query("UPDATE persona_profiles SET active_revision_id=$2 WHERE id=$1", [personaProfileId, personaRevisionId]);
	return { personaProfileId, personaRevisionId, interviewId };
}

/** Advance one trigger-valid onboarding through its exact three-answer completion sequence. */
async function _SeedCompletedOnboarding(setup: Client, id: (suffix: string) => string, fixture: { readonly onboardingId: string; readonly siloId: string; readonly principalId: string; readonly persona: { readonly personaRevisionId: string; readonly interviewId: string } }, now: Date): Promise<void>
{
	const content = await setup.query<{ readonly id: string; readonly digest: string }>("SELECT id, digest FROM user_onboarding_bootstrap_content_revisions WHERE id='bootstrap-commander-v1'");
	const revision = content.rows[0];
	if (content.rows.length !== 1 || revision === undefined)
		throw new Error("Profile repair fixture requires the commander onboarding content revision");
	const conversationId = id("bootstrap-conversation");
	await setup.query("INSERT INTO user_onboardings (id, silo_id, user_id, workflow_version, updated_at) VALUES ($1, $2, $3, 1, $4)", [fixture.onboardingId, fixture.siloId, fixture.principalId, now]);
	await setup.query("UPDATE user_onboardings SET state='survey_in_progress', persona_interview_id=$2, survey_started_at=$3 WHERE id=$1", [fixture.onboardingId, fixture.persona.interviewId, now]);
	await setup.query("UPDATE user_onboardings SET state='bootstrap_chat_pending', persona_revision_id=$2 WHERE id=$1", [fixture.onboardingId, fixture.persona.personaRevisionId]);
	await setup.query("INSERT INTO user_onboarding_bootstrap_conversations (id, onboarding_id, silo_id, user_id, persona_revision_id, persona_display_name, persona_archetype, content_revision_id, content_digest, started_at) VALUES ($1, $2, $3, $4, $5, 'Profile repair assistant', 'commander', $6, $7, $8)", [conversationId, fixture.onboardingId, fixture.siloId, fixture.principalId, fixture.persona.personaRevisionId, revision.id, revision.digest, now]);
	await setup.query("UPDATE user_onboardings SET state='bootstrap_chat_in_progress', bootstrap_conversation_id=$2, bootstrap_content_revision_id=$3, bootstrap_content_digest=$4 WHERE id=$1", [fixture.onboardingId, conversationId, revision.id, revision.digest]);
	for (const ordinal of [1, 2, 3])
		await setup.query("INSERT INTO user_onboarding_bootstrap_answers (id, conversation_id, ordinal, question_ordinal, text, idempotency_key, answered_at) VALUES ($1, $2, $3, $3, $4, $5, $6)", [id(`bootstrap-answer-${ordinal}`), conversationId, ordinal, `Answer ${ordinal}`, id(`bootstrap-answer-key-${ordinal}`), now]);
	await setup.query("UPDATE user_onboardings SET state='completed', completion_provenance='bootstrap_concluded', completed_at=$2 WHERE id=$1", [fixture.onboardingId, now]);
}

/** Give the fixture owner one exact product capability through the real catalogue revision. */
async function _SeedGrant(setup: Client, grantId: string, siloId: string, principalId: string, managerId: string, resourceKind: ProductAuthorizationResourceKinds, resourceId: string, action: ProductAuthorizationActions, effect: "allow" | "deny"): Promise<void>
{
	const capability = __ProductAuthorizationCapability(resourceKind, action);
	if (capability === null)
		throw new Error(`Profile repair fixture lacks ${resourceKind}:${action}`);
	await setup.query("INSERT INTO authorization_grants (id, silo_id, subject_kind, subject_principal_id, boundary_kind, boundary_principal_id, boundary_coverage, manager_id, catalog_id, catalog_revision, catalog_digest, capability_id, resource_kind, resource_id, effect, priority, created_by) SELECT $1, $2, 'principal', $3, 'personal', $3, 'exact', $4, catalog_id, revision, digest, $5, $6, $7, $8, 0, $3 FROM capability_catalog_revisions WHERE catalog_id=$9 AND revision=$10", [grantId, siloId, principalId, managerId, capability.capabilityId, resourceKind, resourceId, effect, capability.catalog.catalogId, capability.catalog.revision]);
}
