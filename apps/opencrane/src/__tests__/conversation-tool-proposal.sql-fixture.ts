import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Client } from "pg";

import { AgentIdentityStates, ComputerLeaseStates, ConversationComputerStates, ExecutionSubjectMembershipKinds, ___ExecutionSubjectSchema, type RunInputSnapshot } from "@opencrane/contracts";
import { __DigestRunInputSnapshot } from "@opencrane/backend/agents/execution/runs";
import type { ConversationComputerTurnCandidate, FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { FleetMembershipDeploymentModes } from "@opencrane/backend/server/iam/membership";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _CreateConversationToolDispatchDependencies } from "../app/mcp-runtime-composition";

/**
 * Commits one isolated, trigger-valid fixture before independent Prisma clients race on admission.
 *
 * Immutable rows remain in the disposable CI database until its normal teardown. This helper
 * never disables constraints, deletes product history or connects to a Kubernetes database.
 */
export async function _SeedConversationToolProposalSqlFixture()
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
	const trustedUntil = new Date(now.getTime() + 300_000).toISOString();
	const lease = { leaseId: id("lease"), leaseGeneration: 1, sandboxClaimId: `${computerId}-g1` };
	const membership = { kind: ExecutionSubjectMembershipKinds.Standalone, principalId, siloId, issuer: "https://identity.example.test", subjectId: principalId, membershipId: id("membership"), membershipUpdatedAt: now.toISOString(), observedAt: now.toISOString(), trustedUntil };
	const subject = ___ExecutionSubjectSchema.parse({ schemaVersion: 1, siloId, agentIdentityId, principalId,
		identity: { agentIdentityId, principalId, siloId, headRevision: "0", headDigest: ___DigestCanonicalJson(id("identity-head")), decisionEvidenceId: id("identity-evidence"), verifiedAt: now.toISOString() },
		membership,
		capability: { agentIdentityId, computerId, capabilitySetDigest: ___DigestCanonicalJson(id("capability")), effectiveContractDigest: ___DigestCanonicalJson(id("contract")), decisionEvidenceId: id("capability-evidence"), decidedAt: now.toISOString() },
		runScope: { siloId, runId, attempt: 1, agentServiceId, agentRevisionId }, computerScope: { siloId, computerId, leaseId: lease.leaseId, leaseGeneration: 1 },
		requester: { membership, siloId, requesterPrincipalId: principalId, requestIdempotencyKey: id("request"), authenticatedAt: now.toISOString() },
		admission: { authorizingPrincipalId: principalId, decisionEvidenceId: id("admission-evidence"), admittedAt: now.toISOString() } });
	const schema = { type: "object", required: ["query"], properties: { query: { type: "string" } }, additionalProperties: false };
	const tool = { name: "records.read", toolRevisionId: id("tool"), description: "Read a dedicated test record", requiresApproval: false, parametersSchema: schema, parametersSchemaDigest: ___DigestCanonicalJson(schema) };
	const budgetPolicy = { maxModelTurns: 2, maxCompletionTokens: 1_024, maxToolInvocations: 1, wallClockDeadlineEpochMs: now.getTime() + 240_000 };
	const snapshot: RunInputSnapshot = { runId, attempt: 1, siloId, agentServiceId, agentRevisionId, snapshotVersion: 1, conversationId, messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryQueryPolicy: {}, mcpTools: [{ toolRevisionId: tool.toolRevisionId, name: tool.name, description: tool.description, inputSchema: schema, inputSchemaDigest: tool.parametersSchemaDigest }], modelRoute: { alias: modelId, modelDefinitionId: modelId, litellmModelId: `litellm-${modelId}`, maxOutputTokens: 512, generatedOutputCapabilities: [] }, budgetPolicy, executionSubject: subject, promptCompilerVersion: "tool-proof-v1", digest: "", compiledAt: now.toISOString() };
	const snapshotDigest = __DigestRunInputSnapshot(snapshot);
	const setup = new Client({ connectionString: process.env.DATABASE_URL });
	await setup.connect();
	try
	{
		await setup.query(await readFile(new URL("../../../../scripts/sql/authority-fixtures.sql", import.meta.url), "utf8"));
		await setup.query("BEGIN");
		await setup.query("SELECT pg_temp.seed_silo_model($1, $2)", [siloId, modelId]);
		await setup.query("SELECT pg_temp.seed_external_user($1, $2)", [siloId, principalId]);
		await setup.query("INSERT INTO org_memberships (id, cluster_tenant, subject, role, status, updated_at) VALUES ($1, $2, $3, 'member', 'active', $4)", [membership.membershipId, siloId, principalId, now]);
		await setup.query("INSERT INTO agent_services (id, silo_id, kind, name, workload_profile, updated_at) VALUES ($1, $2, 'personal', 'SQL assistant', 'personal-default', $3)", [agentServiceId, siloId, now]);
		await setup.query("INSERT INTO agent_revisions (id, silo_id, agent_service_id, revision, digest, prompt_policy_version, model_definition_id, budget, authored_by) VALUES ($1, $2, $3, 1, $4, 'tool-proof-v1', $5, $6::jsonb, $7)", [agentRevisionId, siloId, agentServiceId, ___DigestCanonicalJson(agentRevisionId), modelId, JSON.stringify(budgetPolicy), principalId]);
		const digest = ___DigestCanonicalJson(id("image"));
		const image = `registry.example.test/proof/image@${digest}`;
		await setup.query("INSERT INTO mcp_servers (id, silo_id, name, endpoint, transport, status, approval_status, updated_at) VALUES ($1, $2, $3, $4, 'oci-image', 'active', 'published', $5)", [id("server"), siloId, id("mcp-name"), image, now]);
		await setup.query("INSERT INTO oci_image_validations (id, silo_id, artifact_id, artifact_revision_id, content_address, byte_length, media_type, submission_key_digest, submission_digest, state, index_digest, image_manifest_digest, config_digest, registry_reference, created_by_principal_id, completed_at, updated_at) VALUES ($1, $2, $3, $4, $5, 1, 'application/vnd.oci.image.layout.v1+tar', $5, $5, 'imported', $5, $5, $5, $6, $7, $8, $8)", [id("validation"), siloId, id("artifact"), id("artifact-revision"), digest, image, principalId, now]);
		await setup.query("INSERT INTO mcp_server_revisions (id, silo_id, mcp_server_id, oci_image_validation_id, revision, registry_reference, updated_at) VALUES ($1, $2, $3, $4, 1, $5, $6)", [id("server-revision"), siloId, id("server"), id("validation"), image, now]);
		await setup.query("INSERT INTO mcp_tool_revisions (id, silo_id, server_revision_id, name, description, input_schema, input_schema_digest) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)", [tool.toolRevisionId, siloId, id("server-revision"), tool.name, tool.description, JSON.stringify(schema), tool.parametersSchemaDigest]);
		await setup.query("UPDATE mcp_server_revisions SET state='ready', protocol_version='2026-07-28', completed_at=$2 WHERE id=$1", [id("server-revision"), now]);
		await setup.query("INSERT INTO agent_revision_mcp_tool_assignments (agent_revision_id, agent_service_id, tool_revision_id, silo_id) VALUES ($1, $2, $3, $4)", [agentRevisionId, agentServiceId, tool.toolRevisionId, siloId]);
		await setup.query("UPDATE agent_revisions SET state='published', published_at=$2 WHERE id=$1", [agentRevisionId, now]);
		await setup.query("UPDATE agent_services SET state='active', active_revision_id=$2 WHERE id=$1", [agentServiceId, agentRevisionId]);
		await setup.query("SELECT pg_temp.seed_agent_conversation($1, $2, $3)", [conversationId, siloId, agentServiceId]);
		await setup.query("SELECT pg_temp.seed_participant($1, $2)", [conversationId, principalId]);
		await setup.query("INSERT INTO agent_runs (id, silo_id, agent_service_id, agent_revision_id, conversation_id, trigger, agent_identity_id, principal_id, execution_subject, request_idempotency_key, input_snapshot_digest) VALUES ($1, $2, $3, $4, $5, 'interactive', $6, $7, $8::jsonb, $9, $10)", [runId, siloId, agentServiceId, agentRevisionId, conversationId, agentIdentityId, principalId, JSON.stringify(subject), id("request"), snapshotDigest]);
		await setup.query("INSERT INTO run_input_snapshots (id, run_id, attempt, snapshot_version, silo_id, agent_service_id, agent_revision_id, agent_identity_id, principal_id, execution_subject, conversation_id, model_route, mcp_tools, memory_query_policy, budget_policy, prompt_compiler_version, input_digest, created_at) VALUES ($1, $2, 1, 1, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11::jsonb, '{}'::jsonb, $12::jsonb, 'tool-proof-v1', $13, $14)", [id("snapshot"), runId, siloId, agentServiceId, agentRevisionId, agentIdentityId, principalId, JSON.stringify(subject), conversationId, JSON.stringify(snapshot.modelRoute), JSON.stringify(snapshot.mcpTools), JSON.stringify(budgetPolicy), snapshotDigest, now]);
		await setup.query("SET CONSTRAINTS ALL IMMEDIATE");
		await setup.query("UPDATE agent_runs SET state='running', started_at=$2 WHERE id=$1", [runId, now]);
		for (const [kind, resourceId] of [[ProductAuthorizationResourceKinds.AgentService, agentServiceId], [ProductAuthorizationResourceKinds.Conversation, conversationId], [ProductAuthorizationResourceKinds.McpToolRevision, tool.toolRevisionId]] as const)
		{
			const action = kind === ProductAuthorizationResourceKinds.Conversation ? ProductAuthorizationActions.Use : ProductAuthorizationActions.Invoke;
			const capability = __ProductAuthorizationCapability(kind, action)!;
			await setup.query("INSERT INTO authorization_grants (id, silo_id, subject_kind, subject_principal_id, boundary_kind, boundary_principal_id, boundary_coverage, manager_id, catalog_id, catalog_revision, catalog_digest, capability_id, resource_kind, resource_id, effect, priority, created_by) SELECT $1, $2, 'principal', $3, 'personal', $3, 'exact', $4, catalog_id, revision, digest, $5, $6, $7, 'allow', 0, $3 FROM capability_catalog_revisions WHERE catalog_id=$8 AND revision=$9", [id(`grant-${kind}`), siloId, principalId, id("manager"), capability.capabilityId, kind, resourceId, capability.catalog.catalogId, capability.catalog.revision]);
		}
		await setup.query("COMMIT");
	}
	catch (error)
	{
		await setup.query("ROLLBACK");
		throw error;
	}
	finally { await setup.end(); }
	const identity = { schemaVersion: 1, id: agentIdentityId, siloId, agentServiceId, name: "SQL assistant", avatarArtifactRevisionId: null, state: AgentIdentityStates.Active, createdByPrincipalId: principalId, createdAt: now.toISOString(), kind: "proxied", proxiedPrincipalId: principalId, delegationPolicyId: "personal-agent-session-v1" } as const;
	const dependencies = { ..._CreateConversationToolDispatchDependencies({} as never, { mode: FleetMembershipDeploymentModes.Standalone, siloId, trustedOidcIssuer: membership.issuer, maximumStalenessMs: 300_000 }),
		identities: { load: async function _Identity() { return { identity, revision: 0n, headDigest: subject.identity.headDigest, headEventId: id("identity-event"), streamName: id("identity-stream") }; } },
		computers: { load: async function _Computer() { return { computer: { state: ConversationComputerStates.Warm, leaseGeneration: 1 }, lease: { state: ComputerLeaseStates.Active, id: lease.leaseId, generation: 1, computerId, sandboxId: id("sandbox"), expiresAt: trustedUntil } } as never; } } };
	const binding = { siloId, conversationId, computerId, leaseGeneration: 1, agentIdentityId, agentServiceId, agentName: "SQL assistant", agentAvatarArtifactRevisionId: null, runId, expectedRevision: 0n, maximumEntryBytes: 65_536 };
	const compiledInput = { promptCompilerVersion: "tool-proof-v1", runId, attempt: 1, instructions: "Read the requested test record.", messages: [], tools: [tool], model: { modelAlias: modelId, maxOutputTokens: 512, generatedOutputCapabilities: [] }, budget: { ...budgetPolicy, maxCostUsdMicros: null }, digest: ___DigestCanonicalJson(id("compiled-input")) };
	const turn: FrozenConversationComputerTurn = { bootstrapId: randomUUID(), siloId, computerId, lease, binding, latestPendingEntryId: id("message"), modelAlias: modelId, maximumBudgetUsd: 1, credentialLifetimeSeconds: 120, compile: { runId, attempt: 1, promptCompilerVersion: compiledInput.promptCompilerVersion, digest: compiledInput.digest }, outputSourceCommandId: null, outputReceipt: null };
	const candidate: ConversationComputerTurnCandidate = { ...turn, compiledInput, credentialExpiresAt: trustedUntil };
	return { siloId, runId, principalId, subject, turn, candidate, dependencies, proposal: { bootstrapId: turn.bootstrapId, toolRevisionId: tool.toolRevisionId, arguments: { query: "dedicated record" } }, toolGrantId: id(`grant-${ProductAuthorizationResourceKinds.McpToolRevision}`) };
}
