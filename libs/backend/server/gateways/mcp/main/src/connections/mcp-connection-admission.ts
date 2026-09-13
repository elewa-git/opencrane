import { randomUUID } from "node:crypto";

import { McpConnectionCredentialKinds, McpConnectionFailureCodes, McpConnectionStatus, McpCredentialRequirement, McpInstallStates, type McpConnectionCredential, type McpConnectionProjection } from "@opencrane/contracts";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationDecisionOutcomes, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { __McpConnectionCommandDigest, __McpConnectionEndpointDigest, __McpConnectionGrantManagerId, __McpConnectionRequestKeyDigest } from "./mcp-connection-digests";
import { __ProjectMcpConnection } from "./mcp-connection-projection";
import { __PlanMcpInstallLifecycle, McpInstallLifecycleActions, McpInstallLifecycleEvents } from "./installs/mcp-install-lifecycle";
import { McpConnectionAdmissionOutcomes, McpConnectionOwnerKinds, McpConnectionRevocationOutcomes, McpConnectionSecretWriteOutcomes, McpConnectionStates, McpConnectionUninstallOutcomes } from "./mcp-connection.types";
import type { McpConnectionActor, McpConnectionAdmissionCommand, McpConnectionAdmissionResult, McpConnectionAdmissionUnitOfWork, McpConnectionAuthority, McpConnectionCredentialSecretStore, McpConnectionInstallTarget, McpConnectionMaterialVerifier, McpConnectionRecord, McpConnectionRevocationCommand, McpConnectionRevocationResult, McpConnectionSecretTarget, McpConnectionTransaction, McpConnectionUninstallCommand, McpConnectionUninstallResult } from "./mcp-connection.types";

/** Fixed conflict returned without revealing which saved coordinate differed. */
export class McpConnectionConflictError extends Error
{
	constructor()
	{
		super("MCP connection command conflicts with the saved generation.");
		this.name = "McpConnectionConflictError";
	}
}

/** Coordinates prepared outside a retried transaction without retaining raw material. */
interface _PreparedAdmission
{
	readonly requestKeyDigest: `sha256:${string}`;
	readonly credentialKind: McpConnectionCredentialKinds;
	readonly materialVerifier: `hmac-sha256:${string}` | null;
	readonly materialVerifierKeyId: string | null;
}

/** Connect and revoke service that keeps bearer material between the route and Secret adapter only. */
export class __McpConnectionAuthority implements McpConnectionAuthority
{
	constructor(private readonly _unitOfWork: McpConnectionAdmissionUnitOfWork, private readonly _secretStore: McpConnectionCredentialSecretStore, private readonly _materialVerifier: McpConnectionMaterialVerifier) {}

	async connect(command: McpConnectionAdmissionCommand): Promise<McpConnectionProjection | null>
	{
		const prepared = this._Prepare(command.command.credential, command.command.idempotencyKey);
		const admission = await this._unitOfWork.execute(transaction => _Admit(transaction, command, prepared, this._materialVerifier));
		if (admission.outcome === McpConnectionAdmissionOutcomes.Denied)
			return null;
		if (admission.outcome === McpConnectionAdmissionOutcomes.Conflict)
			throw new McpConnectionConflictError();
		if (!("record" in admission))
			throw new Error("MCP connection admission returned no record.");
		if (admission.record.state !== McpConnectionStates.AwaitingMaterial)
			return __ProjectMcpConnection(admission.record);

		const custodied = await this._EstablishCustody(admission.record, command.command.credential);
		return __ProjectMcpConnection(custodied);
	}

	async revoke(command: McpConnectionRevocationCommand): Promise<McpConnectionProjection | null>
	{
		const result = await this._unitOfWork.execute(transaction => _Revoke(transaction, command));
		if (result.outcome === McpConnectionRevocationOutcomes.Denied || result.outcome === McpConnectionRevocationOutcomes.NotFound)
			return null;
		if (result.outcome === McpConnectionRevocationOutcomes.Conflict)
			throw new McpConnectionConflictError();
		if (!("record" in result))
			throw new Error("MCP connection revocation returned no record.");
		return __ProjectMcpConnection(result.record);
	}

	async uninstall(command: McpConnectionUninstallCommand): Promise<McpConnectionUninstallResult>
	{
		return this._unitOfWork.execute(transaction => _Uninstall(transaction, command));
	}

	private _Prepare(credential: McpConnectionCredential, idempotencyKey: string): _PreparedAdmission
	{
		if (credential.kind === McpConnectionCredentialKinds.None)
			return { requestKeyDigest: __McpConnectionRequestKeyDigest(idempotencyKey), credentialKind: credential.kind, materialVerifier: null, materialVerifierKeyId: null };
		const verification = this._materialVerifier.current(credential.token);
		return { requestKeyDigest: __McpConnectionRequestKeyDigest(idempotencyKey), credentialKind: credential.kind, materialVerifier: verification.verifier, materialVerifierKeyId: verification.keyId };
	}

	private async _EstablishCustody(record: McpConnectionRecord, credential: McpConnectionCredential): Promise<McpConnectionRecord>
	{
		if (credential.kind === McpConnectionCredentialKinds.None)
		{
			const bound = await this._unitOfWork.execute(async function _Bind(transaction)
			{
				const current = await transaction.connections.bindCustody(record, null, new Date());
				if (current)
					await transaction.connections.setInstallProjection(record.installId, __ProjectMcpConnection(current));
				return current;
			});
			if (!bound)
				throw new McpConnectionConflictError();
			return bound;
		}
		const target = _SecretTarget(record);
		const result = await this._secretStore.createOrRecover(target, credential.token);
		if (result.outcome === McpConnectionSecretWriteOutcomes.Created || result.outcome === McpConnectionSecretWriteOutcomes.Recovered)
		{
			const bound = await this._unitOfWork.execute(async function _Bind(transaction)
			{
				const current = await transaction.connections.bindCustody(record, result.identity, new Date());
				if (current)
					await transaction.connections.setInstallProjection(record.installId, __ProjectMcpConnection(current));
				return current;
			});
			if (!bound)
				throw new McpConnectionConflictError();
			return bound;
		}
		if (result.outcome === McpConnectionSecretWriteOutcomes.Uncertain)
			return record;
		const failed = await this._unitOfWork.execute(async function _Fail(transaction)
		{
			const current = await transaction.connections.markRecoveryRequired(record, McpConnectionFailureCodes.CredentialConflict, new Date());
			if (current)
				await transaction.connections.setInstallProjection(record.installId, __ProjectMcpConnection(current));
			return current;
		});
		if (!failed)
			throw new McpConnectionConflictError();
		return failed;
	}
}

async function _Uninstall(transaction: McpConnectionTransaction, command: McpConnectionUninstallCommand): Promise<McpConnectionUninstallResult>
{
	const target = await transaction.connections.lockInstallForRemoval(command.siloId, command.serverId, command.actorPrincipalId);
	if (!target)
		return { outcome: McpConnectionUninstallOutcomes.NotFound };
	if (target.lifecycleState === McpInstallStates.Removed)
		return { outcome: McpConnectionUninstallOutcomes.Removed };

	const current = await transaction.connections.lockCurrent(command.siloId, target.installId);
	const commandDigest = ___DigestCanonicalJson({ operation: "uninstall", serverId: command.serverId, ownerPrincipalId: command.actorPrincipalId, generation: current?.generation ?? null } as JsonValue);
	const actor = { siloId: command.siloId, actorPrincipalId: command.actorPrincipalId, ownerKind: McpConnectionOwnerKinds.Personal } as const;
	const decision = await _Authorize(transaction, actor, command.serverId, command.actorPrincipalId, "uninstall", commandDigest);
	if (decision === null)
		return { outcome: McpConnectionUninstallOutcomes.NotFound };

	if (!current)
	{
		const lifecycle = __PlanMcpInstallLifecycle(target.lifecycleState, McpInstallLifecycleEvents.UninstallWithoutConnection);
		if (lifecycle.action === McpInstallLifecycleActions.Advance)
		{
			if (!await transaction.installRemoval.markRemovedWithoutConnection(target.installId))
				throw new Error("MCP uninstall lost its generation-free installation.");
			await transaction.installAudit.appendUninstalled(command.siloId, command.serverId, target.ownerPrincipalId, command.actorPrincipalId);
			return { outcome: McpConnectionUninstallOutcomes.Removed };
		}
		const removed = await transaction.installRemoval.markRemovedIfSettled(target.installId);
		return { outcome: removed ? McpConnectionUninstallOutcomes.Removed : McpConnectionUninstallOutcomes.Removing };
	}
	const lifecycle = __PlanMcpInstallLifecycle(target.lifecycleState, McpInstallLifecycleEvents.UninstallWithConnection);
	if (lifecycle.action === McpInstallLifecycleActions.Advance)
	{
		if (!await transaction.installRemoval.markRemoving(target.installId))
			throw new Error("MCP uninstall lost its locked installation.");
		await transaction.installAudit.appendUninstalled(command.siloId, command.serverId, target.ownerPrincipalId, command.actorPrincipalId);
	}
	if (current.state !== McpConnectionStates.Revoked)
	{
		const revokeKeyDigest = ___DigestCanonicalJson({ operation: "uninstall-revoke", installId: target.installId, connectionId: current.id, generation: current.generation } as JsonValue);
		const task = await transaction.workflow.admitRevocation(transaction.workflowTransaction, { siloId: current.siloId, connectionId: current.id, generation: current.generation, commandDigest });
		const revoked = await transaction.connections.markRevoked(current, { actorPrincipalId: command.actorPrincipalId, revokeKeyDigest, revokeDecisionDigest: decision, task, now: new Date() });
		if (!revoked)
			throw new Error("MCP uninstall lost its locked connection generation.");
		await _SetConnectionGrants(transaction, revoked, command.actorPrincipalId, false);
		return { outcome: McpConnectionUninstallOutcomes.Removing };
	}
	if (!current.revokeTask)
		throw new Error("MCP uninstall found a revoked generation without its cleanup task.");
	const removed = await transaction.installRemoval.markRemovedIfSettled(target.installId);
	return { outcome: removed ? McpConnectionUninstallOutcomes.Removed : McpConnectionUninstallOutcomes.Removing };
}

async function _Admit(transaction: McpConnectionTransaction, command: McpConnectionAdmissionCommand, prepared: _PreparedAdmission, materialVerifier: McpConnectionMaterialVerifier): Promise<McpConnectionAdmissionResult>
{
	const ownerPrincipalId = await _ResolveOwner(transaction, command.actor);
	if (ownerPrincipalId === null)
		return { outcome: McpConnectionAdmissionOutcomes.Denied };
	const target = await transaction.connections.lockInstall(command.actor.siloId, command.serverId, ownerPrincipalId);
	if (!target || !_CredentialMatches(target.credentialRequirement, prepared.credentialKind))
		return { outcome: McpConnectionAdmissionOutcomes.Denied };
	const endpointDigest = __McpConnectionEndpointDigest(target.endpoint);
	const replay = target.installId === null ? null : await transaction.connections.findByRequestKey(command.actor.siloId, target.installId, prepared.requestKeyDigest);
	if (replay)
	{
		const decision = await _Authorize(transaction, command.actor, command.serverId, ownerPrincipalId, "connect", replay.commandDigest);
		if (decision === null)
			return { outcome: McpConnectionAdmissionOutcomes.Denied };
		return _ReplayMatches(replay, command, ownerPrincipalId, endpointDigest, materialVerifier)
			? { outcome: McpConnectionAdmissionOutcomes.Replayed, record: replay }
			: { outcome: McpConnectionAdmissionOutcomes.Conflict };
	}
	const current = target.installId === null ? null : await transaction.connections.lockCurrent(command.actor.siloId, target.installId);
	if ((current?.generation ?? null) !== command.command.expectedGeneration)
		return { outcome: McpConnectionAdmissionOutcomes.Conflict };
	const commandDigest = __McpConnectionCommandDigest({ serverId: command.serverId, ownerPrincipalId, agentServiceId: command.actor.agentServiceId ?? null, credentialKind: prepared.credentialKind, materialVerifier: prepared.materialVerifier });
	const decision = await _Authorize(transaction, command.actor, command.serverId, ownerPrincipalId, "connect", commandDigest);
	if (decision === null)
		return { outcome: McpConnectionAdmissionOutcomes.Denied };
	let installedTarget: McpConnectionInstallTarget | null = target;
	if (installedTarget.installId === null)
	{
		if (command.actor.ownerKind !== McpConnectionOwnerKinds.ManagedService)
			return { outcome: McpConnectionAdmissionOutcomes.Denied };
		installedTarget = await transaction.connections.createManagedInstall(target);
	}
	if (!installedTarget || installedTarget.installId === null)
		return { outcome: McpConnectionAdmissionOutcomes.Denied };
	if (current && (current.state === McpConnectionStates.AwaitingMaterial || current.state === McpConnectionStates.Activating || current.state === McpConnectionStates.RecoveryRequired))
		return { outcome: McpConnectionAdmissionOutcomes.Conflict };
	if (current && (current.state === McpConnectionStates.Active || current.state === McpConnectionStates.Failed))
		await _RevokeForReplacement(transaction, current, command.actor.actorPrincipalId, prepared.requestKeyDigest, decision);

	const connectionId = randomUUID();
	const generation = (current?.generation ?? 0) + 1;
	const taskInput = { siloId: command.actor.siloId, connectionId, generation, commandDigest };
	const task = await transaction.workflow.admitActivation(transaction.workflowTransaction, taskInput);
	const record = await transaction.connections.create({
		id: connectionId,
		siloId: command.actor.siloId,
		installId: installedTarget.installId,
		serverId: target.serverId,
		ownerPrincipalId,
		actorPrincipalId: command.actor.actorPrincipalId,
		agentServiceId: command.actor.agentServiceId ?? null,
		generation,
		credentialRequirement: target.credentialRequirement,
		credentialKind: prepared.credentialKind,
		endpointDigest,
		state: McpConnectionStates.AwaitingMaterial,
		requestKeyDigest: prepared.requestKeyDigest,
		commandDigest,
		materialVerifier: prepared.materialVerifier,
		materialVerifierKeyId: prepared.materialVerifierKeyId,
		authorizationDecisionDigest: decision,
		task,
	});
	await _SetConnectionGrants(transaction, record, command.actor.actorPrincipalId, true);
	await transaction.connections.setInstallProjection(installedTarget.installId, { connectionStatus: McpConnectionStatus.Activating, connectionGeneration: generation, credentialUpdatedAt: null, failureCode: null });
	return { outcome: McpConnectionAdmissionOutcomes.Admitted, record };
}

function _ReplayMatches(record: McpConnectionRecord, command: McpConnectionAdmissionCommand, ownerPrincipalId: string, endpointDigest: `sha256:${string}`, materialVerifier: McpConnectionMaterialVerifier): boolean
{
	const expectedSuccessor = (command.command.expectedGeneration ?? 0) + 1;
	if (record.generation !== expectedSuccessor || record.serverId !== command.serverId || record.ownerPrincipalId !== ownerPrincipalId || record.agentServiceId !== (command.actor.agentServiceId ?? null) || record.endpointDigest !== endpointDigest || record.credentialKind !== command.command.credential.kind)
		return false;
	if (command.command.credential.kind === McpConnectionCredentialKinds.None)
		return record.materialVerifier === null && record.materialVerifierKeyId === null;
	return record.materialVerifier !== null && record.materialVerifierKeyId !== null && materialVerifier.verify(record.materialVerifierKeyId, command.command.credential.token, record.materialVerifier);
}

async function _Revoke(transaction: McpConnectionTransaction, command: McpConnectionRevocationCommand): Promise<McpConnectionRevocationResult>
{
	const ownerPrincipalId = await _ResolveOwner(transaction, command.actor);
	if (ownerPrincipalId === null)
		return { outcome: McpConnectionRevocationOutcomes.Denied };
	const target = await transaction.connections.lockInstallForRevocation(command.actor.siloId, command.serverId, ownerPrincipalId);
	if (!target || target.installId === null)
		return { outcome: McpConnectionRevocationOutcomes.NotFound };
	const revokeKeyDigest = __McpConnectionRequestKeyDigest(command.idempotencyKey);
	const replay = await transaction.connections.findByRevokeKey(command.actor.siloId, target.installId, revokeKeyDigest);
	const current = replay ?? await transaction.connections.lockCurrent(command.actor.siloId, target.installId);
	if (!current)
		return { outcome: McpConnectionRevocationOutcomes.NotFound };
	if (current.generation !== command.expectedGeneration)
		return { outcome: McpConnectionRevocationOutcomes.Conflict };
	const commandDigest = ___DigestCanonicalJson({ operation: "revoke", serverId: command.serverId, ownerPrincipalId, generation: current.generation } as JsonValue);
	const decision = await _Authorize(transaction, command.actor, command.serverId, ownerPrincipalId, "revoke", commandDigest);
	if (decision === null)
		return { outcome: McpConnectionRevocationOutcomes.Denied };
	if (replay)
		return replay.serverId === command.serverId && replay.ownerPrincipalId === ownerPrincipalId ? { outcome: McpConnectionRevocationOutcomes.Replayed, record: replay } : { outcome: McpConnectionRevocationOutcomes.Conflict };
	if (current.state === McpConnectionStates.Revoked)
		return { outcome: McpConnectionRevocationOutcomes.Conflict };
	const task = await transaction.workflow.admitRevocation(transaction.workflowTransaction, { siloId: current.siloId, connectionId: current.id, generation: current.generation, commandDigest });
	const revoked = await transaction.connections.markRevoked(current, { actorPrincipalId: command.actor.actorPrincipalId, revokeKeyDigest, revokeDecisionDigest: decision, task, now: new Date() });
	if (!revoked)
		throw new Error("MCP connection revocation lost its locked generation.");
	await _SetConnectionGrants(transaction, revoked, command.actor.actorPrincipalId, false);
	await transaction.connections.setInstallProjection(target.installId, { connectionStatus: McpConnectionStatus.NeedsCredential, connectionGeneration: current.generation, credentialUpdatedAt: current.credentialCustodiedAt?.toISOString() ?? null, failureCode: null });
	return { outcome: McpConnectionRevocationOutcomes.Admitted, record: revoked };
}

async function _ResolveOwner(transaction: McpConnectionTransaction, actor: McpConnectionActor): Promise<string | null>
{
	if (actor.ownerKind === McpConnectionOwnerKinds.Personal)
		return actor.agentServiceId === undefined ? actor.actorPrincipalId : null;
	if (!actor.agentServiceId)
		return null;
	const identity = await transaction.managedServices.resolve(actor.siloId, actor.agentServiceId);
	return identity?.agentServiceId === actor.agentServiceId ? identity.principalId : null;
}

async function _Authorize(transaction: McpConnectionTransaction, actor: McpConnectionActor, serverId: string, ownerPrincipalId: string, operation: "connect" | "revoke" | "uninstall", commandDigest: `sha256:${string}`): Promise<`sha256:${string}` | null>
{
	const resource = actor.ownerKind === McpConnectionOwnerKinds.Personal
		? { kind: ProductAuthorizationResourceKinds.McpServer, id: serverId }
		: { kind: ProductAuthorizationResourceKinds.Organization, id: actor.siloId };
	const action = actor.ownerKind === McpConnectionOwnerKinds.Personal ? ProductAuthorizationActions.Install : ProductAuthorizationActions.Administer;
	const admission = await transaction.authorization.admitPrincipal({ siloId: actor.siloId, principalId: actor.actorPrincipalId, actorKind: "user", actorId: actor.actorPrincipalId, resource, action, argumentsDigest: ___DigestCanonicalJson({ operation, serverId, ownerPrincipalId, commandDigest } as JsonValue), nowEpochMs: Date.now() });
	return admission.outcome === AuthorizationDecisionOutcomes.Allow ? admission.evidence?.decisionDigest ?? null : null;
}

async function _SetConnectionGrants(transaction: McpConnectionTransaction, record: McpConnectionRecord, actorPrincipalId: string, active: boolean): Promise<void>
{
	const resource = { kind: ProductAuthorizationResourceKinds.ProviderConnection, id: record.id } as const;
	const grants = active ? [ProductAuthorizationActions.Read, ProductAuthorizationActions.Use].map(function _Grant(action)
	{
		const capability = __ProductAuthorizationCapability(ProductAuthorizationResourceKinds.ProviderConnection, action);
		if (!capability)
			throw new Error("ProviderConnection authorization capability is missing.");
		return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId: record.ownerPrincipalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId: record.ownerPrincipalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 100, createdByPrincipalId: actorPrincipalId } as const;
	}) : [];
	await transaction.grants.reconcileManagedResourceGrants({ siloId: record.siloId, managerId: __McpConnectionGrantManagerId(record.id), resource, grants, now: new Date() });
}

function _CredentialMatches(requirement: McpCredentialRequirement, kind: McpConnectionCredentialKinds): boolean
{
	return requirement === McpCredentialRequirement.Credentialless ? kind === McpConnectionCredentialKinds.None : kind === McpConnectionCredentialKinds.Bearer;
}

function _SecretTarget(record: McpConnectionRecord): McpConnectionSecretTarget
{
	if (record.materialVerifier === null || record.materialVerifierKeyId === null)
		throw new Error("Bearer connection has no material verifier.");
	return { connectionId: record.id, siloId: record.siloId, ownerPrincipalId: record.ownerPrincipalId, generation: record.generation, endpointDigest: record.endpointDigest, materialVerifier: record.materialVerifier, materialVerifierKeyId: record.materialVerifierKeyId };
}

async function _RevokeForReplacement(transaction: McpConnectionTransaction, current: McpConnectionRecord, actorPrincipalId: string, replacementKeyDigest: `sha256:${string}`, decisionDigest: `sha256:${string}`): Promise<void>
{
	const revokeKeyDigest = ___DigestCanonicalJson({ operation: "replacement-revoke", connectionId: current.id, generation: current.generation, replacementKeyDigest } as JsonValue);
	const commandDigest = ___DigestCanonicalJson({ operation: "replace", connectionId: current.id, generation: current.generation, revokeKeyDigest } as JsonValue);
	const task = await transaction.workflow.admitRevocation(transaction.workflowTransaction, { siloId: current.siloId, connectionId: current.id, generation: current.generation, commandDigest });
	const revoked = await transaction.connections.markRevoked(current, { actorPrincipalId, revokeKeyDigest, revokeDecisionDigest: decisionDigest, task, now: new Date() });
	if (!revoked)
		throw new Error("MCP connection replacement lost its locked generation.");
	await _SetConnectionGrants(transaction, revoked, actorPrincipalId, false);
}
