import { describe, expect, it, vi } from "vitest";

import { McpConnectionCredentialKinds, McpConnectionStatus, McpCredentialRequirement, McpInstallStates } from "@opencrane/contracts";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { __McpConnectionAuthority, McpConnectionConflictError } from "../mcp-connection-admission";
import { HmacMcpConnectionMaterialVerifier } from "../mcp-connection-material-verifier";
import { __McpConnectionWorkflowController } from "../mcp-connection-workflow-controller";
import { McpConnectionOwnerKinds, McpConnectionSecretDeleteOutcomes, McpConnectionSecretReadOutcomes, McpConnectionSecretWriteOutcomes, McpConnectionStates, McpConnectionUninstallOutcomes, type McpConnectionRecord, type McpConnectionTransaction } from "../mcp-connection.types";

const _DIGEST = `sha256:${"a".repeat(64)}` as const;
const _VERIFIER = new HmacMcpConnectionMaterialVerifier({ currentKeyId: "test", keys: [{ id: "test", secretBase64: Buffer.alloc(32, 1).toString("base64") }] });

describe("MCP connection admission", () =>
{
	it("custodies bearer material outside SQL and safely replays only the same command", async () =>
	{
		let saved: McpConnectionRecord | null = null;
		const createOrRecover = vi.fn(async (_target, token: string) =>
		{
			expect(token).toBe("write-only-bearer");
			return { outcome: McpConnectionSecretWriteOutcomes.Created, identity: { secretRef: "mcp-connection-id-g1", secretUid: "uid-1", secretResourceVersion: "7" } } as const;
		});
		const transaction = _Transaction(function _FindReplay() { return saved; }, function _Create(record)
		{
			expect(JSON.stringify(record)).not.toContain("write-only-bearer");
			saved = _Record(record);
			return saved;
		}, function _Bind(record, binding)
		{
			saved = { ...record, state: McpConnectionStates.Activating, secretRef: binding?.secretRef ?? null, secretUid: binding?.secretUid ?? null, secretResourceVersion: binding?.secretResourceVersion ?? null, credentialCustodiedAt: new Date("2026-09-12T12:00:00.000Z") };
			return saved;
		});
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, { createOrRecover, recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() }, _VERIFIER);
		const command = { actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", command: { idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "write-only-bearer" } } } as const;

		await expect(authority.connect(command)).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.Activating, connectionGeneration: 1 });
		await expect(authority.connect(command)).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.Activating, connectionGeneration: 1 });
		expect(createOrRecover).toHaveBeenCalledTimes(1);
		await expect(authority.connect({ ...command, command: { ...command.command, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "different" } } })).rejects.toBeInstanceOf(McpConnectionConflictError);
		expect(createOrRecover).toHaveBeenCalledTimes(1);
	});

	it("replays retained bearer material after the current verifier key rotates", async () =>
	{
		const verifierA = new HmacMcpConnectionMaterialVerifier({ currentKeyId: "key-a", keys: [{ id: "key-a", secretBase64: Buffer.alloc(32, 1).toString("base64") }] });
		const verifierB = new HmacMcpConnectionMaterialVerifier({ currentKeyId: "key-b", keys: [{ id: "key-a", secretBase64: Buffer.alloc(32, 1).toString("base64") }, { id: "key-b", secretBase64: Buffer.alloc(32, 2).toString("base64") }] });
		let activeVerifier = verifierA;
		let saved: McpConnectionRecord | null = null;
		const createOrRecover = vi.fn(async () => ({ outcome: McpConnectionSecretWriteOutcomes.Created, identity: { secretRef: "mcp-connection-id-g1", secretUid: "uid-1", secretResourceVersion: "7" } } as const));
		const transaction = _Transaction(() => saved, record =>
		{
			saved = _Record(record);
			return saved;
		}, function _Bind(record, binding)
		{
			saved = { ...record, state: McpConnectionStates.Activating, secretRef: binding?.secretRef ?? null, secretUid: binding?.secretUid ?? null, secretResourceVersion: binding?.secretResourceVersion ?? null, credentialCustodiedAt: new Date("2026-09-12T12:00:00.000Z") };
			return saved;
		});
		const rotatingVerifier = { current: (material: string) => activeVerifier.current(material), verify: (keyId: string, material: string, expected: `hmac-sha256:${string}`) => activeVerifier.verify(keyId, material, expected) };
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, { createOrRecover, recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() }, rotatingVerifier);
		const command = { actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", command: { idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "write-only-bearer" } } } as const;

		await expect(authority.connect(command)).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.Activating, connectionGeneration: 1 });
		activeVerifier = verifierB;
		await expect(authority.connect(command)).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.Activating, connectionGeneration: 1 });
		await expect(authority.connect({ ...command, command: { ...command.command, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "different" } } })).rejects.toBeInstanceOf(McpConnectionConflictError);
		expect(createOrRecover).toHaveBeenCalledTimes(1);
	});

	it("activates credentialless installs without creating a Secret", async () =>
	{
		const createOrRecover = vi.fn();
		const transaction = _Transaction(() => null, record => _Record(record, McpCredentialRequirement.Credentialless), record => ({ ...record, state: McpConnectionStates.Activating }));
		transaction.connections.lockInstall = vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", endpoint: "https://mcp.example.test/rpc", credentialRequirement: McpCredentialRequirement.Credentialless }));
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, { createOrRecover, recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() }, _VERIFIER);

		await expect(authority.connect({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", command: { idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.None } } })).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.Activating, credentialUpdatedAt: null });
		expect(createOrRecover).not.toHaveBeenCalled();
	});

	it("creates a managed-service install only after current administration is admitted", async () =>
	{
		const transaction = _Transaction(() => null, record => _Record(record), record => ({ ...record, state: McpConnectionStates.Activating }));
		transaction.connections.lockInstall = vi.fn(async () => ({ installId: null, serverId: "remote", ownerPrincipalId: "service-principal-1", endpoint: "https://mcp.example.test/rpc", credentialRequirement: McpCredentialRequirement.Credentialless }));
		transaction.connections.createManagedInstall = vi.fn(async target => ({ ...target, installId: "service-install-1" }));
		transaction.managedServices.resolve = vi.fn(async () => ({ agentServiceId: "service-1", principalId: "service-principal-1" }));
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, { createOrRecover: vi.fn(), recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() }, _VERIFIER);

		await expect(authority.connect({ actor: { siloId: "silo-1", actorPrincipalId: "admin-1", ownerKind: McpConnectionOwnerKinds.ManagedService, agentServiceId: "service-1" }, serverId: "remote", command: { idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.None } } })).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.Activating });
		expect(transaction.authorization.admitPrincipal).toHaveBeenCalledBefore(vi.mocked(transaction.connections.createManagedInstall));
		expect(transaction.connections.create).toHaveBeenCalledWith(expect.objectContaining({ installId: "service-install-1", ownerPrincipalId: "service-principal-1", agentServiceId: "service-1" }));
	});

	it("does not contact custody when install or authority admission is denied", async () =>
	{
		const createOrRecover = vi.fn();
		const transaction = _Transaction(() => null, record => _Record(record), record => record);
		transaction.connections.lockInstall = vi.fn(async () => null);
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, { createOrRecover, recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() }, _VERIFIER);

		await expect(authority.connect({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "missing", command: { idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "secret" } } })).resolves.toBeNull();
		expect(createOrRecover).not.toHaveBeenCalled();
	});

	it("leaves uncertain Secret creation recoverable by the saved activation workflow", async () =>
	{
		const transaction = _Transaction(() => null, record => _Record(record), record => record);
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, { createOrRecover: vi.fn(async () => ({ outcome: McpConnectionSecretWriteOutcomes.Uncertain } as const)), recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() }, _VERIFIER);

		await expect(authority.connect({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", command: { idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "secret" } } })).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.Activating });
		expect(transaction.connections.markRecoveryRequired).not.toHaveBeenCalled();
	});

	it("rejects a never-saved activation key after another client advances the generation", async () =>
	{
		const transaction = _Transaction(() => null, record => _Record(record), record => record);
		transaction.connections.lockCurrent = vi.fn(async () => _Current({ state: McpConnectionStates.Active, generation: 1 }));
		const createOrRecover = vi.fn();
		const secrets = { createOrRecover, recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() } as never;
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, secrets, _VERIFIER);

		await expect(authority.connect({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", command: { idempotencyKey: "delayed-key", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "write-only-bearer" } } })).rejects.toBeInstanceOf(McpConnectionConflictError);

		expect(transaction.connections.markRevoked).not.toHaveBeenCalled();
		expect(transaction.connections.create).not.toHaveBeenCalled();
		expect(createOrRecover).not.toHaveBeenCalled();
	});

	it("rejects a saved activation replay with the wrong predecessor generation", async () =>
	{
		const saved = _Current({ state: McpConnectionStates.Activating, generation: 1 });
		const transaction = _Transaction(() => saved, record => _Record(record), record => record);
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, _Secrets(), _VERIFIER);

		await expect(authority.connect({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", command: { idempotencyKey: "request-123", expectedGeneration: 1, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "write-only-bearer" } } })).rejects.toBeInstanceOf(McpConnectionConflictError);

		expect(transaction.connections.create).not.toHaveBeenCalled();
	});

	it("admits the next monotonic generation after an exact revoked predecessor", async () =>
	{
		const current = _Current({ state: McpConnectionStates.Revoked, generation: 1, credentialRequirement: McpCredentialRequirement.Credentialless, credentialKind: McpConnectionCredentialKinds.None, materialVerifier: null, materialVerifierKeyId: null });
		const transaction = _Transaction(() => null, record => _Record(record, McpCredentialRequirement.Credentialless), record => ({ ...record, state: McpConnectionStates.Activating }));
		transaction.connections.lockInstall = vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", endpoint: "https://mcp.example.test/rpc", credentialRequirement: McpCredentialRequirement.Credentialless }));
		transaction.connections.lockCurrent = vi.fn(async () => current);
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, _Secrets(), _VERIFIER);

		await expect(authority.connect({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", command: { idempotencyKey: "next-generation", expectedGeneration: 1, credential: { kind: McpConnectionCredentialKinds.None } } })).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.Activating, connectionGeneration: 2 });

		expect(transaction.connections.create).toHaveBeenCalledWith(expect.objectContaining({ generation: 2 }));
	});

	it("rejects stale revoke and accepts only the saved generation on replay", async () =>
	{
		const current = _Current({ state: McpConnectionStates.Active, generation: 2 });
		const transaction = _Transaction(() => null, record => _Record(record), record => record);
		transaction.connections.lockInstallForRevocation = vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", endpoint: "https://mcp.example.test/rpc", credentialRequirement: McpCredentialRequirement.PrincipalCredential }));
		transaction.connections.lockCurrent = vi.fn(async () => current);
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, _Secrets(), _VERIFIER);

		await expect(authority.revoke({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", idempotencyKey: "stale-revoke", expectedGeneration: 1 })).rejects.toBeInstanceOf(McpConnectionConflictError);
		expect(transaction.workflow.admitRevocation).not.toHaveBeenCalled();
		expect(transaction.connections.markRevoked).not.toHaveBeenCalled();

		const replay = { ...current, state: McpConnectionStates.Revoked, revokeKeyDigest: _DIGEST, revokeDecisionDigest: _DIGEST, revokeTask: { taskId: "revoke-2", taskName: "revoke", taskKey: "revoke-key-2" }, revokedAt: new Date() };
		transaction.connections.findByRevokeKey = vi.fn(async () => replay);
		await expect(authority.revoke({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", idempotencyKey: "saved-revoke", expectedGeneration: 1 })).rejects.toBeInstanceOf(McpConnectionConflictError);
		await expect(authority.revoke({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", idempotencyKey: "saved-revoke", expectedGeneration: 2 })).resolves.toMatchObject({ connectionGeneration: 2 });
	});

	it("revokes only the current generation that the caller observed", async () =>
	{
		const current = _Current({ state: McpConnectionStates.Active, generation: 2 });
		const transaction = _Transaction(() => null, record => _Record(record), record => record);
		transaction.connections.lockInstallForRevocation = vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", endpoint: "https://mcp.example.test/rpc", credentialRequirement: McpCredentialRequirement.PrincipalCredential }));
		transaction.connections.lockCurrent = vi.fn(async () => current);
		transaction.workflow.admitRevocation = vi.fn(async () => ({ taskId: "revoke-2", taskName: "revoke", taskKey: "revoke-key-2" }));
		transaction.connections.markRevoked = vi.fn(async (_record, command) => ({ ...current, state: McpConnectionStates.Revoked, revokeKeyDigest: command.revokeKeyDigest, revokeDecisionDigest: command.revokeDecisionDigest, revokeTask: command.task, revokedAt: command.now }));
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, _Secrets(), _VERIFIER);

		await expect(authority.revoke({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", idempotencyKey: "current-revoke", expectedGeneration: 2 })).resolves.toMatchObject({ connectionStatus: McpConnectionStatus.NeedsCredential, connectionGeneration: 2 });

		expect(transaction.workflow.admitRevocation).toHaveBeenCalledOnce();
		expect(transaction.connections.markRevoked).toHaveBeenCalledWith(current, expect.objectContaining({ actorPrincipalId: "principal-1" }));
	});

	it("deletes a committed Secret when uninstall wins after its create response was lost", async () =>
	{
		let saved: McpConnectionRecord | null = null;
		let lifecycleState = McpInstallStates.Installed;
		const transaction = _Transaction(() => saved, record =>
		{
			saved = _Record(record);
			return saved;
		}, record => record);
		transaction.connections.lockInstallForRemoval = vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", lifecycleState }));
		transaction.connections.lockCurrent = vi.fn(async () => saved);
		transaction.installRemoval.markRemoving = vi.fn(async () =>
		{
			lifecycleState = McpInstallStates.Removing;
			return true;
		});
		transaction.installRemoval.lockForCleanup = vi.fn(async () => lifecycleState);
		transaction.installRemoval.markRemovedIfSettled = vi.fn(async () =>
		{
			lifecycleState = McpInstallStates.Removed;
			return true;
		});
		transaction.workflow.admitRevocation = vi.fn(async () => ({ taskId: "revoke-1", taskName: "revoke", taskKey: "revoke-key" }));
		transaction.connections.markRevoked = vi.fn(async (record, command) =>
		{
			saved = { ...record, state: McpConnectionStates.Revoked, revokeKeyDigest: command.revokeKeyDigest, revokeDecisionDigest: command.revokeDecisionDigest, revokeTask: command.task, revokedAt: command.now };
			return saved;
		});
		transaction.connections.loadRevocationTarget = vi.fn(async () => saved);
		transaction.connections.markCleanupComplete = vi.fn(async record =>
		{
			saved = { ...record, cleanupCompletedAt: new Date() };
			return saved;
		});
		const recoverIdentity = vi.fn(async () => ({ outcome: McpConnectionSecretReadOutcomes.Found, identity: { secretRef: "mcp-connection-id-g1", secretUid: "uid-1", secretResourceVersion: "7" } } as const));
		const deleteExact = vi.fn(async () => ({ outcome: McpConnectionSecretDeleteOutcomes.Deleted } as const));
		const secrets = { createOrRecover: vi.fn(async () => ({ outcome: McpConnectionSecretWriteOutcomes.Uncertain } as const)), recoverIdentity, readExact: vi.fn(), deleteExact };
		const unitOfWork = { execute: async function _Execute<Result>(operation: (value: McpConnectionTransaction) => Promise<Result>): Promise<Result> { return operation(transaction); } };
		const authority = new __McpConnectionAuthority(unitOfWork, secrets, _VERIFIER);
		const controller = new __McpConnectionWorkflowController(unitOfWork, secrets, { activate: vi.fn() }, { isSettled: vi.fn(async () => true) });

		await authority.connect({ actor: { siloId: "silo-1", actorPrincipalId: "principal-1", ownerKind: McpConnectionOwnerKinds.Personal }, serverId: "remote", command: { idempotencyKey: "request-123", expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "write-only-bearer" } } });
		await authority.uninstall({ siloId: "silo-1", actorPrincipalId: "principal-1", serverId: "remote" });
		await controller.revoke({ task: { taskId: "revoke-1", taskName: "revoke", idempotencyKey: "revoke-key" }, attempt: 1 } as never, { siloId: "silo-1", connectionId: saved!.id, generation: 1, commandDigest: saved!.commandDigest });

		expect(recoverIdentity).toHaveBeenCalledOnce();
		expect(deleteExact).toHaveBeenCalledWith(expect.objectContaining({ expectedIdentity: expect.objectContaining({ secretUid: "uid-1" }) }));
		expect(lifecycleState).toBe(McpInstallStates.Removed);
	});

	it("removes a personal install immediately when it has no connection generation", async () =>
	{
		const transaction = _Transaction(() => null, record => _Record(record), record => record);
		transaction.connections.lockInstallForRemoval = vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", lifecycleState: McpInstallStates.Installed }));
		transaction.installRemoval.markRemovedWithoutConnection = vi.fn(async () => true);
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, _Secrets(), _VERIFIER);

		await expect(authority.uninstall({ siloId: "silo-1", actorPrincipalId: "principal-1", serverId: "remote" })).resolves.toEqual({ outcome: McpConnectionUninstallOutcomes.Removed });
		expect(transaction.installRemoval.markRemovedWithoutConnection).toHaveBeenCalledWith("install-1");
		expect(transaction.installAudit.appendUninstalled).toHaveBeenCalledWith("silo-1", "remote", "principal-1", "principal-1");
		expect(transaction.workflow.admitRevocation).not.toHaveBeenCalled();
	});

	it("moves an installed connection into removal using its existing revocation workflow", async () =>
	{
		const current = _Current({ state: McpConnectionStates.Active });
		const transaction = _Transaction(() => null, record => _Record(record), record => record);
		transaction.connections.lockInstallForRemoval = vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", lifecycleState: McpInstallStates.Installed }));
		transaction.connections.lockCurrent = vi.fn(async () => current);
		transaction.installRemoval.markRemoving = vi.fn(async () => true);
		transaction.workflow.admitRevocation = vi.fn(async () => ({ taskId: "revoke-1", taskName: "revoke", taskKey: "revoke-key" }));
		transaction.connections.markRevoked = vi.fn(async (_record, command) => ({ ...current, state: McpConnectionStates.Revoked, revokeKeyDigest: command.revokeKeyDigest, revokeDecisionDigest: command.revokeDecisionDigest, revokeTask: command.task, revokedAt: command.now }));
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, _Secrets(), _VERIFIER);

		await expect(authority.uninstall({ siloId: "silo-1", actorPrincipalId: "principal-1", serverId: "remote" })).resolves.toEqual({ outcome: McpConnectionUninstallOutcomes.Removing });
		expect(transaction.connections.lockInstallForRemoval).toHaveBeenCalledBefore(vi.mocked(transaction.connections.lockCurrent));
		expect(transaction.installRemoval.markRemoving).toHaveBeenCalledBefore(vi.mocked(transaction.workflow.admitRevocation));
		expect(transaction.installAudit.appendUninstalled).toHaveBeenCalledWith("silo-1", "remote", "principal-1", "principal-1");
		expect(transaction.grants.reconcileManagedResourceGrants).toHaveBeenCalledWith(expect.objectContaining({ grants: [] }));
	});

	it("reuses a pending cleanup without admitting another revocation task", async () =>
	{
		const current = _Current({ state: McpConnectionStates.Revoked, revokeKeyDigest: _DIGEST, revokeDecisionDigest: _DIGEST, revokeTask: { taskId: "revoke-1", taskName: "revoke", taskKey: "revoke-key" }, revokedAt: new Date(), cleanupCompletedAt: null });
		const transaction = _Transaction(() => null, record => _Record(record), record => record);
		transaction.connections.lockInstallForRemoval = vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", lifecycleState: McpInstallStates.Removing }));
		transaction.connections.lockCurrent = vi.fn(async () => current);
		transaction.installRemoval.markRemovedIfSettled = vi.fn(async () => false);
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, _Secrets(), _VERIFIER);

		await expect(authority.uninstall({ siloId: "silo-1", actorPrincipalId: "principal-1", serverId: "remote" })).resolves.toEqual({ outcome: McpConnectionUninstallOutcomes.Removing });
		expect(transaction.workflow.admitRevocation).not.toHaveBeenCalled();
		expect(transaction.installRemoval.markRemoving).not.toHaveBeenCalled();
		expect(transaction.installAudit.appendUninstalled).not.toHaveBeenCalled();
	});

	it("does not change install or connection state when current Install authority is denied", async () =>
	{
		const transaction = _Transaction(() => null, record => _Record(record), record => record);
		transaction.connections.lockInstallForRemoval = vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", lifecycleState: McpInstallStates.Installed }));
		transaction.connections.lockCurrent = vi.fn(async () => _Current({ state: McpConnectionStates.Active }));
		transaction.authorization.admitPrincipal = vi.fn(async () => ({ outcome: AuthorizationDecisionOutcomes.Deny, reason: "no_matching_grant", grantIds: [], rule: null, evidence: null } as const));
		const authority = new __McpConnectionAuthority({ execute: operation => operation(transaction) }, _Secrets(), _VERIFIER);

		await expect(authority.uninstall({ siloId: "silo-1", actorPrincipalId: "principal-1", serverId: "remote" })).resolves.toEqual({ outcome: McpConnectionUninstallOutcomes.NotFound });
		expect(transaction.installRemoval.markRemoving).not.toHaveBeenCalled();
		expect(transaction.connections.markRevoked).not.toHaveBeenCalled();
	});
});

function _Secrets()
{
	return { createOrRecover: vi.fn(), recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() } as never;
}

function _Transaction(findReplay: () => McpConnectionRecord | null, create: (record: Parameters<McpConnectionTransaction["connections"]["create"]>[0]) => McpConnectionRecord, bind: (record: McpConnectionRecord, binding: Parameters<McpConnectionTransaction["connections"]["bindCustody"]>[1]) => McpConnectionRecord): McpConnectionTransaction
{
	return {
		connections: {
			lockInstall: vi.fn(async () => ({ installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", endpoint: "https://mcp.example.test/rpc", credentialRequirement: McpCredentialRequirement.PrincipalCredential })),
			lockInstallForRevocation: vi.fn(),
			lockInstallForRemoval: vi.fn(),
			findByRequestKey: vi.fn(async () => findReplay()),
			findByRevokeKey: vi.fn(),
			lockCurrent: vi.fn(async () => null),
			createManagedInstall: vi.fn(),
			loadActivationRecord: vi.fn(),
			loadActivationTarget: vi.fn(),
			loadRevocationTarget: vi.fn(),
			readExecutionCredential: vi.fn(),
			create: vi.fn(async record => create(record)),
			markRevoked: vi.fn(),
			bindCustody: vi.fn(async (record, binding) => bind(record, binding)),
			markRecoveryRequired: vi.fn(),
			markActivationFailed: vi.fn(),
			markCleanupFailed: vi.fn(),
			markCleanupComplete: vi.fn(),
			setInstallProjection: vi.fn(),
		},
		installRemoval: { lockForCleanup: vi.fn(), markRemovedWithoutConnection: vi.fn(), markRemoving: vi.fn(), markRemovedIfSettled: vi.fn() },
		installAudit: { appendUninstalled: vi.fn() },
		authorization: { admitPrincipal: vi.fn(async () => ({ outcome: AuthorizationDecisionOutcomes.Allow, evidence: { decisionDigest: _DIGEST } })) } as never,
		grants: { reconcileManagedResourceGrants: vi.fn() } as never,
		managedServices: { resolve: vi.fn() },
		workflow: { admitActivation: vi.fn(async () => ({ taskId: "task-1", taskName: "activate", taskKey: "key-1" })), admitRevocation: vi.fn() },
		workflowTransaction: {} as never,
	};
}

function _Record(record: Parameters<McpConnectionTransaction["connections"]["create"]>[0], requirement = McpCredentialRequirement.PrincipalCredential): McpConnectionRecord
{
	return { ...record, credentialRequirement: requirement, secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null, revokeKeyDigest: null, revokeDecisionDigest: null, revokeTask: null, failureCode: null, activatedAt: null, revokedAt: null, cleanupCompletedAt: null };
}

function _Current(overrides: Partial<McpConnectionRecord> = {}): McpConnectionRecord
{
	return {
		id: "connection-1", siloId: "silo-1", installId: "install-1", serverId: "remote", ownerPrincipalId: "principal-1", actorPrincipalId: "principal-1", agentServiceId: null, generation: 1,
		credentialRequirement: McpCredentialRequirement.PrincipalCredential, credentialKind: McpConnectionCredentialKinds.Bearer, endpointDigest: _DIGEST, state: McpConnectionStates.Activating,
		requestKeyDigest: _DIGEST, commandDigest: _DIGEST, materialVerifier: `hmac-sha256:${"a".repeat(64)}`, materialVerifierKeyId: "test", authorizationDecisionDigest: _DIGEST,
		secretRef: "secret-1", secretUid: "uid-1", secretResourceVersion: "1", credentialCustodiedAt: new Date(), task: { taskId: "task-1", taskName: "activate", taskKey: "activate-key" },
		revokeKeyDigest: null, revokeDecisionDigest: null, revokeTask: null, failureCode: null, activatedAt: new Date(), revokedAt: null, cleanupCompletedAt: null,
		...overrides,
	};
}
