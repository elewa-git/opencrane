import { randomUUID } from "node:crypto";
import { AgentRevisionState, McpApprovalStatus, McpCredentialRequirement, McpServerRevisionState, McpServerStatus, McpServerTransport, ModelRoutingScope, OciImageValidationState, OrgMemberStatus, OrgRole, PrincipalProvenance, Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaManagedAuthorizationGrantRepository, PrismaOrganizationAdminGrantBootstrapRepository } from "@opencrane/backend/server/iam/authorization";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { CompanyAssistantProvisioningDenied, CompanyAssistantToolsConflict } from "../../company-assistant.errors";
import { PrismaCompanyAssistantProvisioningRepository } from "../prisma-company-assistant-provisioning";
import { PrismaCompanyAssistantProvisioningUnitOfWork } from "../prisma-company-assistant-provisioning-unit-of-work";

const _First = new PrismaClient();
const _Second = new PrismaClient();
const _POLICY = { workloadProfile: "company", promptPolicyVersion: "sql-company-tools-v1", budget: { maxTurns: 2, maxTokens: 4096, maxDurationMs: 60_000 } };

/** Seeds exact grants through the production managed writer and the installed capability catalogue. */
async function _Grants(transaction: Prisma.TransactionClient, siloId: string, principalId: string, resource: ProductAuthorizationResourceLocator, actions: readonly ProductAuthorizationActions[], managerId = "company-tools-sql-admin")
{
	const grants = actions.map(function _Grant(action)
	{
		const capability = __ProductAuthorizationCapability(resource.kind, action);
		if (capability === null)
			throw new Error("Company tool SQL proof requires the installed product catalogue");
		return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId } as const;
	});
	const writer = new PrismaManagedAuthorizationGrantRepository(transaction);
	await writer.reconcileManagedResourceGrants({ siloId, managerId, resource, grants, now: new Date() });
}

/** Freezes a credential-free discovered tool using the trigger-valid OCI sequence shared by SQL suites. */
async function _Tool(transaction: Prisma.TransactionClient, siloId: string, principalId: string)
{
	const serverId = randomUUID();
	const validationId = randomUUID();
	const revisionId = randomUUID();
	const toolId = randomUUID();
	const digest = ___DigestCanonicalJson(toolId);
	const image = `registry.example.test/company-tool-proof/image@${digest}`;
	const now = new Date();
	await transaction.mcpServer.create({ data: { id: serverId, siloId, name: serverId, endpoint: image, transport: McpServerTransport.OciImage, credentialRequirement: McpCredentialRequirement.Credentialless, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } });
	await transaction.ociImageValidation.create({ data: { id: validationId, siloId, artifactId: randomUUID(), artifactRevisionId: randomUUID(), contentAddress: digest, byteLength: 1, mediaType: "application/vnd.oci.image.layout.v1+tar", submissionKeyDigest: digest, submissionDigest: digest, state: OciImageValidationState.Imported, indexDigest: digest, imageManifestDigest: digest, configDigest: digest, registryReference: image, createdByPrincipalId: principalId, completedAt: now } });
	await transaction.mcpServerRevision.create({ data: { id: revisionId, siloId, mcpServerId: serverId, ociImageValidationId: validationId, revision: 1, registryReference: image } });
	const schema = { type: "object", properties: {}, additionalProperties: false };
	await transaction.mcpToolRevision.create({ data: { id: toolId, siloId, serverRevisionId: revisionId, name: "records.read", inputSchema: schema, inputSchemaDigest: ___DigestCanonicalJson(schema) } });
	await transaction.mcpServerRevision.update({ where: { id: revisionId }, data: { state: McpServerRevisionState.Ready, protocolVersion: "2026-07-28", completedAt: now } });
	await _Grants(transaction, siloId, principalId, { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: toolId }, [ProductAuthorizationActions.Assign, ProductAuthorizationActions.Use]);
	return { serverId, revisionId, toolId };
}

/** Creates only isolated authority rows; immutable revisions and audits remain in the disposable Actions database. */
async function _Fixture()
{
	const siloId = `company-tools-sql-${randomUUID()}`;
	return _First.$transaction(async function _Seed(transaction)
	{
		const principalId = randomUUID();
		const modelId = randomUUID();
		const membershipId = randomUUID();
		const caller = { siloId, principalId };
		await transaction.principal.create({ data: { id: principalId, siloId, issuer: "https://company-tools-sql.example", subject: principalId, provenance: PrincipalProvenance.External } });
		await transaction.orgMembership.create({ data: { id: membershipId, clusterTenant: siloId, subject: principalId, role: OrgRole.Admin, status: OrgMemberStatus.Active } });
		const bootstrap = new PrismaOrganizationAdminGrantBootstrapRepository(transaction);
		await bootstrap.reconcileOrganizationAdminGrant({ ...caller, subject: principalId, now: new Date() });
		await transaction.modelDefinition.create({ data: { id: modelId, siloId, scope: ModelRoutingScope.Global, publicModelName: modelId, litellmModelId: `litellm-${modelId}`, upstreamModel: modelId } });
		await _Grants(transaction, siloId, principalId, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: modelId }, [ProductAuthorizationActions.Use]);
		const firstTool = await _Tool(transaction, siloId, principalId);
		const secondTool = await _Tool(transaction, siloId, principalId);
		const repository = new PrismaCompanyAssistantProvisioningRepository(transaction, _POLICY);
		const assistant = await repository.provision(caller, { name: "SQL company assistant", modelDefinitionId: modelId, invokerPrincipalIds: [principalId] }, new Date());
		return { caller, membershipId, firstTool, secondTool, assistant };
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}

/** Uses the production transaction owner; tool commands must never read or write identity history. */
function _Authority(prisma: PrismaClient)
{
	const identities = { async load(): Promise<never> { throw new Error("Tool assignment read identity history"); }, async append(): Promise<never> { throw new Error("Tool assignment wrote identity history"); }, async loadActive(): Promise<never> { throw new Error("Tool assignment read active identity"); } };
	return new PrismaCompanyAssistantProvisioningUnitOfWork(prisma, _POLICY, identities);
}

describe("company assistant tool assignment on the fresh PostgreSQL baseline", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Company tool SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Second.$connect()]);
	});
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it("publishes immutable successors and removes only its manager's old own-principal tool grants", async function _ExactReplacement()
	{
		const f = await _Fixture();
		const authority = _Authority(_First);
		const first = await authority.setTools(f.caller, { expectedActiveRevisionId: f.assistant.agentRevisionId, toolRevisionIds: [f.firstTool.toolId] });
		const original = await _Second.agentRevision.findUniqueOrThrow({ where: { id: f.assistant.agentRevisionId }, include: { mcpToolAssignments: true } });
		expect(original.mcpToolAssignments).toEqual([]);
		await _Second.$transaction(async function _OtherManager(transaction)
		{
			await _Grants(transaction, f.caller.siloId, f.assistant.principalId, { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: f.firstTool.toolId }, [ProductAuthorizationActions.Use], "independent-manager");
		});
		const second = await authority.setTools(f.caller, { expectedActiveRevisionId: first.activeRevisionId, toolRevisionIds: [f.secondTool.toolId] });
		const managerId = `company-assistant:${f.assistant.agentServiceId}`;
		const current = await _Second.authorizationGrant.findMany({ where: { siloId: f.caller.siloId, managerId, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision, revokedAt: null } });
		expect(current.map(grant => [grant.subjectPrincipalId, grant.resourceId, grant.capabilityId]).sort()).toEqual(["mcp-tool-revision:invoke", "mcp-tool-revision:use"].map(capability => [f.assistant.principalId, f.secondTool.toolId, capability]));
		expect(await _Second.authorizationGrant.count({ where: { siloId: f.caller.siloId, resourceId: f.firstTool.toolId, managerId: "independent-manager", revokedAt: null } })).toBe(1);
		expect(await _Second.authorizationGrant.count({ where: { siloId: f.caller.siloId, resourceId: f.firstTool.toolId, subjectPrincipalId: f.caller.principalId, revokedAt: null } })).toBe(2);
		const revision = await _Second.agentRevision.findUniqueOrThrow({ where: { id: second.activeRevisionId } });
		expect(revision).toMatchObject({ parentRevisionId: first.activeRevisionId, state: AgentRevisionState.Published, modelDefinitionId: original.modelDefinitionId, budget: original.budget, promptPolicyVersion: original.promptPolicyVersion, personaRevisionId: null });
		const noOp = await _Authority(_Second).setTools(f.caller, { expectedActiveRevisionId: second.activeRevisionId, toolRevisionIds: [f.secondTool.toolId] });
		expect(noOp).toEqual(second);
		expect(await _Second.agentRevision.count({ where: { agentServiceId: f.assistant.agentServiceId } })).toBe(3);
		await expect(authority.setTools(f.caller, { expectedActiveRevisionId: first.activeRevisionId, toolRevisionIds: [f.secondTool.toolId] })).rejects.toBeInstanceOf(CompanyAssistantToolsConflict);
		await expect(authority.getTools(f.caller)).resolves.toEqual(second);
	});

	it("allows only one successor when independent servers replace the same observed revision", async function _ConcurrentReplacement()
	{
		const f = await _Fixture();
		const results = await Promise.allSettled([
			_Authority(_First).setTools(f.caller, { expectedActiveRevisionId: f.assistant.agentRevisionId, toolRevisionIds: [f.firstTool.toolId] }),
			_Authority(_Second).setTools(f.caller, { expectedActiveRevisionId: f.assistant.agentRevisionId, toolRevisionIds: [f.secondTool.toolId] }),
		]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find(result => result.status === "rejected");
		expect(rejected?.status === "rejected" && rejected.reason instanceof CompanyAssistantToolsConflict).toBe(true);
		const current = await _Authority(_Second).getTools(f.caller);
		expect(await _Second.agentRevision.count({ where: { agentServiceId: f.assistant.agentServiceId } })).toBe(2);
		const grants = await _Second.authorizationGrant.findMany({ where: { siloId: f.caller.siloId, managerId: `company-assistant:${f.assistant.agentServiceId}`, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision, revokedAt: null } });
		expect(grants).toHaveLength(2);
		expect(grants.every(grant => current.toolRevisionIds.includes(grant.resourceId!))).toBe(true);
	});

	it("rolls back successor publication and all tool grants when the active-pointer comparison loses", async function _CasRollback()
	{
		const f = await _Fixture();
		const extension = Prisma.defineExtension({ query: { agentService: { async updateMany({ args, query })
		{
			await query(args);
			return { count: 0 };
		} } } });
		const client = _First.$extends(extension) as unknown as PrismaClient;
		await expect(_Authority(client).setTools(f.caller, { expectedActiveRevisionId: f.assistant.agentRevisionId, toolRevisionIds: [f.firstTool.toolId] })).rejects.toBeInstanceOf(CompanyAssistantToolsConflict);
		expect(await _Second.agentRevision.count({ where: { agentServiceId: f.assistant.agentServiceId } })).toBe(1);
		expect(await _Second.authorizationGrant.count({ where: { siloId: f.caller.siloId, managerId: `company-assistant:${f.assistant.agentServiceId}`, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision } })).toBe(0);
		await expect(_Authority(_Second).getTools(f.caller)).resolves.toMatchObject({ activeRevisionId: f.assistant.agentRevisionId, toolRevisionIds: [] });
	});

	it("refuses missing Assign and a removed administrator despite retained grants", async function _CurrentPermissions()
	{
		const f = await _Fixture();
		await _Second.authorizationGrant.updateMany({ where: { siloId: f.caller.siloId, subjectPrincipalId: f.caller.principalId, resourceId: f.firstTool.toolId, capabilityId: "mcp-tool-revision:assign" }, data: { revokedAt: new Date() } });
		const command = { expectedActiveRevisionId: f.assistant.agentRevisionId, toolRevisionIds: [f.firstTool.toolId] };
		await expect(_Authority(_First).setTools(f.caller, command)).rejects.toBeInstanceOf(CompanyAssistantProvisioningDenied);
		await _Second.orgMembership.update({ where: { id: f.membershipId }, data: { status: OrgMemberStatus.Suspended } });
		await expect(_Authority(_First).getTools(f.caller)).rejects.toBeInstanceOf(CompanyAssistantProvisioningDenied);
		await expect(_Authority(_First).setTools(f.caller, { ...command, toolRevisionIds: [f.secondTool.toolId] })).rejects.toBeInstanceOf(CompanyAssistantProvisioningDenied);
		expect(await _Second.agentRevision.count({ where: { agentServiceId: f.assistant.agentServiceId } })).toBe(1);
	});

	it("refuses a foreign tool and a server whose publication was withdrawn", async function _UnavailableTools()
	{
		const f = await _Fixture();
		const other = await _Fixture();
		await expect(_Authority(_First).setTools(f.caller, { expectedActiveRevisionId: f.assistant.agentRevisionId, toolRevisionIds: [other.firstTool.toolId] })).rejects.toBeInstanceOf(CompanyAssistantProvisioningDenied);
		await _Second.mcpServer.update({ where: { id: f.firstTool.serverId }, data: { approvalStatus: McpApprovalStatus.Disabled } });
		await expect(_Authority(_First).setTools(f.caller, { expectedActiveRevisionId: f.assistant.agentRevisionId, toolRevisionIds: [f.firstTool.toolId] })).rejects.toBeInstanceOf(CompanyAssistantProvisioningDenied);
		expect(await _Second.agentRevision.count({ where: { agentServiceId: f.assistant.agentServiceId } })).toBe(1);
	});
});
