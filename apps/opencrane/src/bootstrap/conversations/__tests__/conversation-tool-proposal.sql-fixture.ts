import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import { Client } from "pg";

import { AgentIdentityStates, ComputerLeaseStates, ConversationComputerStates, ExecutionSubjectMembershipKinds, PROMPT_COMPILER_VERSION, ___ExecutionSubjectSchema, type ConversationToolProposal, type RunInputSnapshot } from "@opencrane/contracts";
import { PrismaPromptCompilerUnitOfWork } from "@opencrane/backend/agents/execution/inputs";
import { __DigestRunInputSnapshot } from "@opencrane/backend/agents/execution/runs";
import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { FleetMembershipDeploymentModes } from "@opencrane/backend/server/iam/membership";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _CreateConversationToolDispatchDependencies } from "../../workflows/mcp-runtime-composition";

/** Optional immutable tool input for SQL journeys that exercise another real MCP contract. */
interface _ToolFixture
{
	/** Tool arguments proposed by the synthetic model turn. */
	readonly arguments: ConversationToolProposal["arguments"];
	/** Description frozen in both the server revision and run snapshot. */
	readonly description: string;
	/** Strict JSON Schema frozen for proposal and dispatch validation. */
	readonly inputSchema: JsonValue;
	/** Name frozen by MCP discovery and the run snapshot. */
	readonly name: string;
}

/** Lifetimes and optional tool contract used by one isolated SQL fixture. */
interface _FixtureOptions
{
	/** Whether the admitted invocation pauses for human approval. */
	readonly approvalRequired?: boolean;
	/** Lifetime of the current computer lease. */
	readonly currentLeaseLifetimeMs?: number;
	/** Maximum age accepted by the current membership reader. */
	readonly currentMembershipLifetimeMs?: number;
	/** Frozen completion-token budget for original-allowance recovery proofs. */
	readonly maximumCompletionTokens?: number;
	/** Lifetime of the immutable run budget. */
	readonly runLifetimeMs?: number;
	/** Selects the existing hidden-argument fixture. */
	readonly secretArguments?: boolean;
	/** Lifetime of the frozen requester membership evidence. */
	readonly trustLifetimeMs?: number;
	/** Exact alternate tool contract for a focused integration journey. */
	readonly tool?: _ToolFixture;
}

/**
 * Commits one isolated, trigger-valid fixture before independent Prisma clients race on admission.
 *
 * Immutable rows remain in the disposable CI database until its normal teardown. This helper
 * never disables constraints, deletes product history or connects to a Kubernetes database.
 */
export async function _SeedConversationToolProposalSqlFixture(options: _FixtureOptions = {})
{
	const prefix = `tool-proof-${randomUUID()}`;
	const id = (suffix: string) => `${prefix}-${suffix}`;
	const siloId = id("silo");
	const principalId = id("person");
	const conversationId = id("conversation");
	const computerId = `computer-${conversationId}`;
	const agentIdentityId = `identity-${conversationId}`;
	const agentServiceId = id("service");
	const agentRevisionId = id("revision");
	const modelId = id("model");
	const runId = id("run");
	const now = new Date();
	const trustedUntil = new Date(now.getTime() + (options.trustLifetimeMs ?? 300_000)).toISOString();
	const leaseExpiresAt = new Date(now.getTime() + (options.currentLeaseLifetimeMs ?? 300_000)).toISOString();
	const lease = { leaseId: id("lease"), leaseGeneration: 1, sandboxClaimId: `${computerId}-g1` };
	const membership = { kind: ExecutionSubjectMembershipKinds.Standalone, principalId, siloId, issuer: "https://identity.example.test", subjectId: principalId, membershipId: id("membership"), membershipUpdatedAt: now.toISOString(), observedAt: now.toISOString(), trustedUntil };
	const subject = ___ExecutionSubjectSchema.parse({ schemaVersion: 1, siloId, agentIdentityId, principalId,
		identity: { agentIdentityId, principalId, siloId, headRevision: "0", headDigest: ___DigestCanonicalJson(id("identity-head")), decisionEvidenceId: id("identity-evidence"), verifiedAt: now.toISOString() },
		membership,
		capability: { agentIdentityId, computerId, capabilitySetDigest: ___DigestCanonicalJson(id("capability")), effectiveContractDigest: ___DigestCanonicalJson(id("contract")), decisionEvidenceId: id("capability-evidence"), decidedAt: now.toISOString() },
		runScope: { siloId, runId, attempt: 1, agentServiceId, agentRevisionId }, computerScope: { siloId, computerId, leaseId: lease.leaseId, leaseGeneration: 1 },
		requester: { membership, siloId, requesterPrincipalId: principalId, requestIdempotencyKey: id("request"), authenticatedAt: now.toISOString() },
		admission: { authorizingPrincipalId: principalId, decisionEvidenceId: id("admission-evidence"), admittedAt: now.toISOString() } });
	const schema: JsonValue = options.tool?.inputSchema ?? (options.secretArguments === true
		? { type: "object", required: ["token"], properties: { token: { type: "string", writeOnly: true } }, additionalProperties: false }
		: { type: "object", required: ["query"], properties: { query: { type: "string" } }, additionalProperties: false });
	const toolRevisionId = id("tool");
	const toolName = options.tool?.name ?? "records.read";
	const toolDescription = options.tool?.description ?? "Read a dedicated test record";
	const toolSchemaDigest = ___DigestCanonicalJson(schema);
	const serverName = "Records SQL proof";
	const budgetPolicy = { maxModelTurns: 2, maxCompletionTokens: options.maximumCompletionTokens ?? 1_024, maxToolInvocations: 1, wallClockDeadlineEpochMs: now.getTime() + (options.runLifetimeMs ?? 240_000) };
	const snapshot: RunInputSnapshot = { runId, attempt: 1, siloId, agentServiceId, agentRevisionId, snapshotVersion: 1, conversationId, messageIds: [], personaRevisionId: id("persona"), preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [{ toolRevisionId, name: toolName, description: toolDescription, inputSchema: schema, inputSchemaDigest: toolSchemaDigest }], modelRoute: { alias: modelId, modelDefinitionId: modelId, litellmModelId: `litellm-${modelId}`, maxOutputTokens: 512, generatedOutputCapabilities: [] }, budgetPolicy, executionSubject: subject, promptCompilerVersion: PROMPT_COMPILER_VERSION, digest: "", compiledAt: now.toISOString() };
	const snapshotDigest = __DigestRunInputSnapshot(snapshot);
	const setup = new Client({ connectionString: process.env.DATABASE_URL });
	await setup.connect();
	try
	{
		await setup.query(await readFile(new URL("../../../../../../scripts/sql/authority-fixtures.sql", import.meta.url), "utf8"));
		await setup.query("BEGIN");
		await setup.query("SELECT pg_temp.seed_silo_model($1, $2)", [siloId, modelId]);
		await setup.query("SELECT pg_temp.seed_external_user($1, $2)", [siloId, principalId]);
		// This column has no time zone; an explicit UTC string keeps it aligned with the saved subject.
		await setup.query("INSERT INTO org_memberships (id, cluster_tenant, subject, role, status, updated_at) VALUES ($1, $2, $3, 'member', 'active', $4)", [membership.membershipId, siloId, principalId, now.toISOString()]);
		await _SeedApprovedPersona(setup, id, siloId, principalId, now);
		await setup.query("INSERT INTO agent_services (id, silo_id, kind, name, workload_profile, updated_at) VALUES ($1, $2, 'personal', 'SQL assistant', 'personal-default', $3)", [agentServiceId, siloId, now]);
		await setup.query("INSERT INTO agent_revisions (id, silo_id, agent_service_id, revision, digest, prompt_policy_version, model_definition_id, budget, authored_by, persona_revision_id) VALUES ($1, $2, $3, 1, $4, $5, $6, $7::jsonb, $8, $9)", [agentRevisionId, siloId, agentServiceId, ___DigestCanonicalJson(agentRevisionId), PROMPT_COMPILER_VERSION, modelId, JSON.stringify(budgetPolicy), principalId, id("persona")]);
		const digest = ___DigestCanonicalJson(id("image"));
		const image = `registry.example.test/proof/image@${digest}`;
		await setup.query("INSERT INTO mcp_servers (id, silo_id, name, endpoint, transport, status, approval_status, credential_requirement, requires_approval, updated_at) VALUES ($1, $2, $3, $4, 'oci-image', 'active', 'published', 'credentialless', $5, $6)", [id("server"), siloId, serverName, image, options.approvalRequired === true, now]);
		await setup.query("INSERT INTO oci_image_validations (id, silo_id, artifact_id, artifact_revision_id, content_address, byte_length, media_type, submission_key_digest, submission_digest, state, index_digest, image_manifest_digest, config_digest, registry_reference, created_by_principal_id, completed_at, updated_at) VALUES ($1, $2, $3, $4, $5, 1, 'application/vnd.oci.image.layout.v1+tar', $5, $5, 'imported', $5, $5, $5, $6, $7, $8, $8)", [id("validation"), siloId, id("artifact"), id("artifact-revision"), digest, image, principalId, now]);
		await setup.query("INSERT INTO mcp_server_revisions (id, silo_id, mcp_server_id, oci_image_validation_id, revision, registry_reference, updated_at) VALUES ($1, $2, $3, $4, 1, $5, $6)", [id("server-revision"), siloId, id("server"), id("validation"), image, now]);
		await setup.query("INSERT INTO mcp_tool_revisions (id, silo_id, server_revision_id, name, description, input_schema, input_schema_digest) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)", [toolRevisionId, siloId, id("server-revision"), toolName, toolDescription, JSON.stringify(schema), toolSchemaDigest]);
		await setup.query("UPDATE mcp_server_revisions SET state='ready', protocol_version='2026-07-28', completed_at=$2 WHERE id=$1", [id("server-revision"), now]);
		await setup.query("INSERT INTO mcp_server_installs (id, mcp_server_id, principal_id, connection_status, updated_at) VALUES ($1, $2, $3, 'credentialless', $4)", [id("server-install"), id("server"), principalId, now]);
		await setup.query("INSERT INTO agent_revision_mcp_tool_assignments (agent_revision_id, agent_service_id, tool_revision_id, silo_id) VALUES ($1, $2, $3, $4)", [agentRevisionId, agentServiceId, toolRevisionId, siloId]);
		await setup.query("UPDATE agent_revisions SET state='published', published_at=$2 WHERE id=$1", [agentRevisionId, now]);
		await setup.query("UPDATE agent_services SET state='active', active_revision_id=$2 WHERE id=$1", [agentServiceId, agentRevisionId]);
		await setup.query("SELECT pg_temp.seed_agent_conversation($1, $2, $3)", [conversationId, siloId, agentServiceId]);
		await setup.query("SELECT pg_temp.seed_participant($1, $2)", [conversationId, principalId]);
		await setup.query("INSERT INTO conversation_computer_active_leases (computer_id, silo_id, conversation_id, agent_identity_id, lease_id, lease_generation, expires_at, updated_at) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)", [computerId, siloId, conversationId, agentIdentityId, lease.leaseId, leaseExpiresAt, now]);
		await setup.query("INSERT INTO agent_runs (id, silo_id, agent_service_id, agent_revision_id, conversation_id, trigger, agent_identity_id, principal_id, execution_subject, request_idempotency_key, input_snapshot_digest) VALUES ($1, $2, $3, $4, $5, 'interactive', $6, $7, $8::jsonb, $9, $10)", [runId, siloId, agentServiceId, agentRevisionId, conversationId, agentIdentityId, principalId, JSON.stringify(subject), id("request"), snapshotDigest]);
		await setup.query("INSERT INTO run_input_snapshots (id, run_id, attempt, snapshot_version, silo_id, agent_service_id, agent_revision_id, agent_identity_id, principal_id, execution_subject, conversation_id, model_route, mcp_tools, memory_query_policy, budget_policy, prompt_compiler_version, input_digest, created_at, persona_revision_id) VALUES ($1, $2, 1, 1, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11::jsonb, '{}'::jsonb, $12::jsonb, $13, $14, $15, $16)", [id("snapshot"), runId, siloId, agentServiceId, agentRevisionId, agentIdentityId, principalId, JSON.stringify(subject), conversationId, JSON.stringify(snapshot.modelRoute), JSON.stringify(snapshot.mcpTools), JSON.stringify(budgetPolicy), PROMPT_COMPILER_VERSION, snapshotDigest, now, id("persona")]);
		await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
		await setup.query("UPDATE agent_runs SET state='running', started_at=$2 WHERE id=$1", [runId, now]);
		for (const [kind, resourceId] of [[ProductAuthorizationResourceKinds.AgentService, agentServiceId], [ProductAuthorizationResourceKinds.Conversation, conversationId], [ProductAuthorizationResourceKinds.McpToolRevision, toolRevisionId]] as const)
		{
			const action = kind === ProductAuthorizationResourceKinds.Conversation ? ProductAuthorizationActions.Use : ProductAuthorizationActions.Invoke;
			const capability = __ProductAuthorizationCapability(kind, action)!;
			await setup.query("INSERT INTO authorization_grants (id, silo_id, subject_kind, subject_principal_id, boundary_kind, boundary_principal_id, boundary_coverage, manager_id, catalog_id, catalog_revision, catalog_digest, capability_id, resource_kind, resource_id, effect, priority, created_by) SELECT $1, $2, 'principal', $3, 'personal', $3, 'exact', $4, catalog_id, revision, digest, $5, $6, $7, 'allow', 0, $3 FROM capability_catalog_revisions WHERE catalog_id=$8 AND revision=$9", [id(`grant-${kind}`), siloId, principalId, id("manager"), capability.capabilityId, kind, resourceId, capability.catalog.catalogId, capability.catalog.revision]);
		}
		const readConversation = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.Conversation, ProductAuthorizationActions.Read)!;
		await setup.query("INSERT INTO authorization_grants (id, silo_id, subject_kind, subject_principal_id, boundary_kind, boundary_principal_id, boundary_coverage, manager_id, catalog_id, catalog_revision, catalog_digest, capability_id, resource_kind, resource_id, effect, priority, created_by) SELECT $1, $2, 'principal', $3, 'personal', $3, 'exact', $4, catalog_id, revision, digest, $5, $6, $7, 'allow', 0, $3 FROM capability_catalog_revisions WHERE catalog_id=$8 AND revision=$9", [id("grant-conversation-read"), siloId, principalId, id("manager"), readConversation.capabilityId, ProductAuthorizationResourceKinds.Conversation, conversationId, readConversation.catalog.catalogId, readConversation.catalog.revision]);
		await setup.query("COMMIT");
	}
	catch (error)
	{
		await setup.query("ROLLBACK");
		throw error;
	}
	finally { await setup.end(); }
	const recompile = async function _Recompile()
	{
		const prisma = new PrismaClient();
		try
		{
			return await new PrismaPromptCompilerUnitOfWork(prisma, function _NoMessages()
			{
				return { loadMessages: async function _LoadMessages(messageIds: readonly string[])
				{
					if (messageIds.length !== 0)
						throw new Error("SQL fixture compiler expected empty conversation history");
					return [];
				} };
			}).compile({ ...snapshot, digest: snapshotDigest }, 1);
		}
		finally { await prisma.$disconnect(); }
	};
	const compiledInput = await recompile();
	const tool = compiledInput.tools.find(definition => definition.toolRevisionId === toolRevisionId);
	if (tool === undefined)
		throw new Error("SQL fixture compiler omitted its exact MCP tool revision");
	const identity = { schemaVersion: 1, id: agentIdentityId, siloId, agentServiceId, name: "SQL assistant", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: principalId, createdAt: now.toISOString(), kind: "proxied", proxiedPrincipalId: principalId, delegationPolicyId: "personal-agent-session-v1" } as const;
	const dependencies = { ..._CreateConversationToolDispatchDependencies({} as never, { mode: FleetMembershipDeploymentModes.Standalone, siloId, trustedOidcIssuer: membership.issuer, maximumStalenessMs: options.currentMembershipLifetimeMs ?? 300_000 }),
		identities: { load: async function _Identity() { return { identity, revision: 0n, headDigest: subject.identity.headDigest, headEventId: id("identity-event"), streamName: id("identity-stream") }; } },
		computers: { load: async function _Computer() { return { computer: { state: ConversationComputerStates.Warm, leaseGeneration: 1 }, lease: { state: ComputerLeaseStates.Active, id: lease.leaseId, generation: 1, computerId, sandboxId: id("sandbox"), expiresAt: leaseExpiresAt } } as never; } } };
	const binding = { siloId, conversationId, computerId, leaseGeneration: 1, agentIdentityId, agentServiceId, agentName: "SQL assistant", agentAvatarArtifactRevisionId: null, runId, expectedRevision: 0n, maximumEntryBytes: 65_536 };
	const turn: FrozenConversationComputerTurn = { bootstrapId: randomUUID(), siloId, computerId, lease, binding, latestPendingEntryId: id("message"), latestPendingEntryPosition: "1", modelAlias: modelId, maximumBudgetUsd: 1, credentialLifetimeSeconds: 120, compile: { runId, attempt: 1, promptCompilerVersion: compiledInput.promptCompilerVersion, digest: compiledInput.digest }, outputSourceCommandId: null, outputReceipt: null, cancellationReceipt: null, toolSelection: null, continuationReservation: null, modelReservation: null };
	const candidate: ConversationComputerTurnCandidate = { ...turn, compiledInput, credentialExpiresAt: trustedUntil };
	const argumentsValue: ConversationToolProposal["arguments"] = options.tool?.arguments ?? (options.secretArguments === true ? { token: "sql-secret-never-visible" } : { query: "dedicated record" });
	const proposal: ConversationToolProposal = { bootstrapId: turn.bootstrapId, toolRevisionId: tool.toolRevisionId, arguments: argumentsValue };
	return { siloId, runId, principalId, subject, turn, candidate, dependencies, leaseExpiresAt, tool, serverName, proposal, recompile, toolGrantId: id(`grant-${ProductAuthorizationResourceKinds.McpToolRevision}`) };
}

/** Reuses the approved-persona sequence proved by personal-configuration-authority.sql. */
async function _SeedApprovedPersona(setup: Client, id: (suffix: string) => string, siloId: string, principalId: string, now: Date): Promise<void>
{
	const scoringDigest = "sha256:dd84a619e9a465cce882e63e523946502a325dd5b0dcb56fd7d33da6fd072af9";
	const templateDigest = "sha256:8cf1b0a5180d7e1176efe7ebc857c1c2775ff0b3cd8591d07a3a42dc3c936efe";
	const interpolationDigest = "sha256:3fe36e4967254849da2aa91b474510633bdc8c896a67febc24494b708a77f1d6";
	const questions = ["q1-decision-speed", "q2-response-preference", "q3-feedback-preference", "q4-meeting-energy", "q5-new-ideas", "q6-risk-appetite", "q7-suggestion-cadence", "q8-challenge-preference", "q9-relationship-model", "q10-tone-preference"];
	const orderedAnswerIds = questions.map((_question, index) => id(`answer-${index + 1}`));
	const orderedChoiceIds = questions.map((question, index) => `${question}:${index === 8 ? "b" : "a"}`);
	await setup.query("INSERT INTO persona_profiles (id, silo_id, user_id, updated_at) VALUES ($1, $2, $3, $4)", [id("persona-profile"), siloId, principalId, now]);
	await setup.query("INSERT INTO persona_interviews (id, persona_profile_id, user_id, question_set_id, question_set_version, scoring_policy_id, scoring_policy_version, interpolation_map_id, interpolation_map_version) VALUES ($1, $2, $3, 'personal-agent-onboarding', 1, 'personal-agent-scoring', 1, 'personal-agent-interpolation', 1)", [id("interview"), id("persona-profile"), principalId]);
	for (const [index, question] of questions.entries())
		await setup.query("INSERT INTO persona_interview_answers (id, interview_id, question_set_id, question_set_version, question_id, choice_id) VALUES ($1, $2, 'personal-agent-onboarding', 1, $3, $4)", [orderedAnswerIds[index], id("interview"), question, index === 8 ? "b" : "a"]);
	await setup.query("UPDATE persona_interviews SET state='completed', completed_at=$2 WHERE id=$1", [id("interview"), now]);
	await setup.query("INSERT INTO persona_interview_scores (interview_id, scoring_policy_id, scoring_policy_version, scoring_policy_digest, ordered_answer_ids, ordered_choice_ids, red, yellow, green, blue, colour_total, explorer, guardian, openness_total, primary_candidates, secondary_candidates, modifier_candidates) VALUES ($1, 'personal-agent-scoring', 1, $2, $3::text[], $4::text[], 21, 6, 0, 5, 32, 7, 0, 7, ARRAY['Red']::\"PersonaColour\"[], ARRAY['Yellow']::\"PersonaColour\"[], ARRAY['Explorer']::\"PersonaOpennessModifier\"[])", [id("interview"), scoringDigest, orderedAnswerIds, orderedChoiceIds]);
	const evidence = { orderedAnswerIds, orderedChoiceIds, colours: { red: 21, yellow: 6, green: 0, blue: 5, total: 32 }, openness: { explorer: 7, guardian: 0, total: 7 }, tieResolutions: [], primary: "red", secondary: "yellow", modifier: "explorer" };
	await setup.query("INSERT INTO persona_revisions (id, persona_profile_id, revision, soul_template_id, soul_template_version, soul_template_digest, interview_id, scoring_policy_id, scoring_policy_version, scoring_policy_digest, interpolation_map_id, interpolation_map_version, interpolation_map_digest, scoring_evidence, primary_colour, secondary_colour, modifier, compiled_instructions, authored_by) VALUES ($1, $2, 1, 'commander-explorer', 1, $3, $4, 'personal-agent-scoring', 1, $5, 'personal-agent-interpolation', 1, $6, $7::jsonb, 'Red', 'Yellow', 'Explorer', '# Compiled', $8)", [id("persona"), id("persona-profile"), templateDigest, id("interview"), scoringDigest, interpolationDigest, JSON.stringify(evidence), principalId]);
	for (const [index, category] of [[1, "Response"], [2, "Feedback"], [7, "Challenge"]] as const)
		await setup.query("INSERT INTO persona_insights (id, persona_revision_id, category, statement, interview_id, question_set_id, question_set_version, question_id, answer_id) VALUES ($1, $2, $3, 'Dedicated fixture preference', $4, 'personal-agent-onboarding', 1, $5, $6)", [id(`insight-${index}`), id("persona"), category, id("interview"), questions[index], orderedAnswerIds[index]]);
	await setup.query("UPDATE persona_revisions SET state='approved', approved_by=$2, approved_at=$3 WHERE id=$1", [id("persona"), principalId, now]);
	await setup.query("UPDATE persona_profiles SET active_revision_id=$2 WHERE id=$1", [id("persona-profile"), id("persona")]);
}
