import { describe, expect, it, vi } from "vitest";

import { McpConnectionCredentialKinds, McpConnectionFailureCodes, McpCredentialRequirement, McpInstallStates } from "@opencrane/contracts";
import { WorkflowTaskRetryableError, WorkflowTaskTerminalError, type IWorkflowTaskContext } from "@opencrane/backend/server/infra/workflows/contract";
import { AuthorizationDecisionOutcomes } from "@opencrane/models/authorization";

import { McpAuthenticatedConnectionDiscoveryOutcomes } from "../discovery/mcp-authenticated-connection-discovery.types";
import { __McpConnectionWorkflowController } from "../mcp-connection-workflow-controller";
import { McpConnectionSecretDeleteOutcomes, McpConnectionSecretReadOutcomes, McpConnectionStates, type McpConnectionRecord, type McpConnectionTransaction } from "../mcp-connection.types";

const _INPUT = { siloId: "silo-1", connectionId: "connection-1", generation: 1, commandDigest: `sha256:${"a".repeat(64)}` } as const;
const _CONTEXT = { task: { taskId: "task-1", taskName: "activate", idempotencyKey: "task-key" }, attempt: 1 } as unknown as IWorkflowTaskContext;

describe("MCP connection workflow controller", () =>
{
	it("discovers from the current authorized credentialless generation", async () =>
	{
		const record = _Record({ credentialKind: McpConnectionCredentialKinds.None, credentialRequirement: McpCredentialRequirement.Credentialless, materialVerifier: null, materialVerifierKeyId: null });
		const transaction = _Transaction(record);
		const activate = vi.fn(async () => ({ outcome: McpAuthenticatedConnectionDiscoveryOutcomes.Completed, serverRevisionId: "revision-1" } as const));
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets(), { activate }, { isSettled: vi.fn() });

		await controller.activate(_CONTEXT, _INPUT);
		expect(activate).toHaveBeenCalledWith(expect.objectContaining({ record, endpoint: "https://mcp.example.test/rpc", credential: { kind: McpConnectionCredentialKinds.None }, task: _CONTEXT.task }));
	});

	it("records recovery without discovery when exact Secret evidence conflicts", async () =>
	{
		const record = _Record();
		const transaction = _Transaction(record);
		const markRecoveryRequired = vi.fn(async () => ({ ...record, state: McpConnectionStates.RecoveryRequired, failureCode: McpConnectionFailureCodes.CredentialConflict }));
		transaction.connections.markRecoveryRequired = markRecoveryRequired;
		const activate = vi.fn();
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets({ readExact: vi.fn(async () => ({ outcome: McpConnectionSecretReadOutcomes.Conflict } as const)) }), { activate }, { isSettled: vi.fn() });

		await controller.activate(_CONTEXT, _INPUT);
		expect(activate).not.toHaveBeenCalled();
		expect(markRecoveryRequired).toHaveBeenCalledWith(record, McpConnectionFailureCodes.CredentialConflict, expect.any(Date));
	});

	it("does not delete a revoked Secret before admitted executions settle", async () =>
	{
		const record = _Record({ state: McpConnectionStates.Revoked, revokeTask: { taskId: "revoke-1", taskName: "revoke", taskKey: "revoke-key" }, revokedAt: new Date() });
		const transaction = _Transaction(record);
		const deleteExact = vi.fn();
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets({ deleteExact }), { activate: vi.fn() }, { isSettled: vi.fn(async () => false) });

		await expect(controller.revoke({ ..._CONTEXT, task: { taskId: "revoke-1", taskName: "revoke", idempotencyKey: "revoke-key" } }, _INPUT)).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(deleteExact).not.toHaveBeenCalled();
	});

	it("finishes install removal only after credentialless cleanup commits", async () =>
	{
		const record = _Record({ state: McpConnectionStates.Revoked, credentialKind: McpConnectionCredentialKinds.None, credentialRequirement: McpCredentialRequirement.Credentialless, materialVerifier: null, materialVerifierKeyId: null, secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null, revokeTask: { taskId: "revoke-1", taskName: "revoke", taskKey: "revoke-key" }, revokedAt: new Date() });
		const transaction = _Transaction(record);
		transaction.installRemoval.lockForCleanup = vi.fn(async () => McpInstallStates.Removing);
		transaction.connections.markCleanupComplete = vi.fn(async () => ({ ...record, cleanupCompletedAt: new Date() }));
		transaction.installRemoval.markRemovedIfSettled = vi.fn(async () => true);
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets(), { activate: vi.fn() }, { isSettled: vi.fn(async () => true) });

		await controller.revoke({ ..._CONTEXT, task: { taskId: "revoke-1", taskName: "revoke", idempotencyKey: "revoke-key" } }, _INPUT);
		expect(transaction.installRemoval.lockForCleanup).toHaveBeenCalledBefore(vi.mocked(transaction.connections.markCleanupComplete));
		expect(transaction.installRemoval.markRemovedIfSettled).toHaveBeenCalledWith("install-1");
	});

	it.each(["explicit revocation", "replacement revocation"])("records %s cleanup while the install remains Installed", async () =>
	{
		const record = _Record({ state: McpConnectionStates.Revoked, revokeTask: { taskId: "revoke-1", taskName: "revoke", taskKey: "revoke-key" }, revokedAt: new Date() });
		const transaction = _Transaction(record);
		transaction.installRemoval.lockForCleanup = vi.fn(async () => McpInstallStates.Installed);
		transaction.connections.markCleanupComplete = vi.fn(async () => ({ ...record, cleanupCompletedAt: new Date() }));
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets({ deleteExact: vi.fn(async () => ({ outcome: McpConnectionSecretDeleteOutcomes.Deleted } as const)) }), { activate: vi.fn() }, { isSettled: vi.fn(async () => true) });

		await controller.revoke({ ..._CONTEXT, task: { taskId: "revoke-1", taskName: "revoke", idempotencyKey: "revoke-key" } }, _INPUT);
		expect(transaction.installRemoval.lockForCleanup).toHaveBeenCalledBefore(vi.mocked(transaction.connections.markCleanupComplete));
		expect(transaction.connections.markCleanupComplete).toHaveBeenCalledOnce();
		expect(transaction.installRemoval.markRemovedIfSettled).not.toHaveBeenCalled();
	});

	it("recovers and deletes a Secret whose create response was lost before uninstall", async () =>
	{
		const record = _Record({ state: McpConnectionStates.Revoked, secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null, revokeTask: { taskId: "revoke-1", taskName: "revoke", taskKey: "revoke-key" }, revokedAt: new Date() });
		const transaction = _Transaction(record);
		transaction.installRemoval.lockForCleanup = vi.fn(async () => McpInstallStates.Removing);
		transaction.connections.markCleanupComplete = vi.fn(async () => ({ ...record, cleanupCompletedAt: new Date() }));
		transaction.installRemoval.markRemovedIfSettled = vi.fn(async () => true);
		const recoverIdentity = vi.fn(async () => ({ outcome: McpConnectionSecretReadOutcomes.Found, identity: { secretRef: "mcp-connection-connection-1-g1", secretUid: "uid-1", secretResourceVersion: "7" } } as const));
		const deleteExact = vi.fn(async () => ({ outcome: McpConnectionSecretDeleteOutcomes.Deleted } as const));
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets({ recoverIdentity, deleteExact }), { activate: vi.fn() }, { isSettled: vi.fn(async () => true) });

		await controller.revoke({ ..._CONTEXT, task: { taskId: "revoke-1", taskName: "revoke", idempotencyKey: "revoke-key" } }, _INPUT);
		expect(recoverIdentity).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "connection-1" }));
		expect(deleteExact).toHaveBeenCalledWith(expect.objectContaining({ expectedIdentity: { secretRef: "mcp-connection-connection-1-g1", secretUid: "uid-1", secretResourceVersion: "7" } }));
		expect(transaction.installRemoval.markRemovedIfSettled).toHaveBeenCalledWith("install-1");
	});

	it.each([McpConnectionSecretReadOutcomes.NotFound, McpConnectionSecretReadOutcomes.Uncertain])("keeps removal pending when missing Secret identity returns %s", async outcome =>
	{
		const record = _Record({ state: McpConnectionStates.Revoked, secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null, revokeTask: { taskId: "revoke-1", taskName: "revoke", taskKey: "revoke-key" }, revokedAt: new Date() });
		const transaction = _Transaction(record);
		const deleteExact = vi.fn();
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets({ recoverIdentity: vi.fn(async () => ({ outcome })), deleteExact }), { activate: vi.fn() }, { isSettled: vi.fn(async () => true) });

		await expect(controller.revoke({ ..._CONTEXT, task: { taskId: "revoke-1", taskName: "revoke", idempotencyKey: "revoke-key" } }, _INPUT)).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		expect(deleteExact).not.toHaveBeenCalled();
		expect(transaction.connections.markCleanupComplete).not.toHaveBeenCalled();
		expect(transaction.installRemoval.markRemovedIfSettled).not.toHaveBeenCalled();
	});

	it("adopts a matching Secret identity after the request lost its SQL bind", async () =>
	{
		const record = _Record({ state: McpConnectionStates.AwaitingMaterial, secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null });
		const transaction = _Transaction(record);
		let current = record;
		transaction.connections.bindCustody = vi.fn(async (_saved, identity) =>
		{
			current = { ...record, state: McpConnectionStates.Activating, secretRef: identity?.secretRef ?? null, secretUid: identity?.secretUid ?? null, secretResourceVersion: identity?.secretResourceVersion ?? null, credentialCustodiedAt: new Date() };
			return current;
		});
		transaction.connections.loadActivationTarget = vi.fn(async () => ({ record: current, endpoint: "https://mcp.example.test/rpc" }));
		const activate = vi.fn(async () => ({ outcome: McpAuthenticatedConnectionDiscoveryOutcomes.Completed, serverRevisionId: "revision-1" } as const));
		const secrets = _Secrets({ recoverIdentity: vi.fn(async () => ({ outcome: McpConnectionSecretReadOutcomes.Found, identity: { secretRef: "mcp-connection-connection-1-g1", secretUid: "uid-1", secretResourceVersion: "7" } } as const)), readExact: vi.fn(async () => ({ outcome: McpConnectionSecretReadOutcomes.Found, bearerToken: "ephemeral" } as const)) });
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), secrets, { activate }, { isSettled: vi.fn() });

		await controller.activate(_CONTEXT, _INPUT);
		expect(transaction.connections.bindCustody).toHaveBeenCalledWith(record, expect.objectContaining({ secretUid: "uid-1" }), expect.any(Date));
		expect(activate).toHaveBeenCalledWith(expect.objectContaining({ credential: { kind: McpConnectionCredentialKinds.Bearer, token: "ephemeral" } }));
	});

	it("records recovery when unproven custody exhausts its workflow attempts", async () =>
	{
		const record = _Record({ state: McpConnectionStates.AwaitingMaterial, secretRef: null, secretUid: null, secretResourceVersion: null, credentialCustodiedAt: null });
		const transaction = _Transaction(record);
		const recovered = { ...record, state: McpConnectionStates.RecoveryRequired, failureCode: McpConnectionFailureCodes.WorkflowExhausted };
		transaction.connections.markRecoveryRequired = vi.fn(async () => recovered);
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets({ recoverIdentity: vi.fn(async () => ({ outcome: McpConnectionSecretReadOutcomes.NotFound } as const)) }), { activate: vi.fn() }, { isSettled: vi.fn() });

		await controller.activate({ ..._CONTEXT, attempt: 5 }, _INPUT);
		expect(transaction.connections.markRecoveryRequired).toHaveBeenCalledWith(record, McpConnectionFailureCodes.WorkflowExhausted, expect.any(Date));
		expect(transaction.connections.markActivationFailed).not.toHaveBeenCalled();
	});

	it("bounds an unexpected discovery failure through the product exhaustion policy", async () =>
	{
		const record = _Record();
		const transaction = _Transaction(record);
		transaction.connections.markActivationFailed = vi.fn(async () => ({ ...record, state: McpConnectionStates.Failed, failureCode: McpConnectionFailureCodes.WorkflowExhausted }));
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets({ readExact: vi.fn(async () => ({ outcome: McpConnectionSecretReadOutcomes.Found, bearerToken: "ephemeral" } as const)) }), { activate: vi.fn(async () => { throw new Error("dependency detail"); }) }, { isSettled: vi.fn() });

		await expect(controller.activate(_CONTEXT, _INPUT)).rejects.toBeInstanceOf(WorkflowTaskRetryableError);
		await expect(controller.activate({ ..._CONTEXT, attempt: 5 }, _INPUT)).resolves.toBeUndefined();
		expect(transaction.connections.markActivationFailed).toHaveBeenCalledWith(record, McpConnectionFailureCodes.WorkflowExhausted, expect.any(Date));
	});

	it("records cleanup exhaustion when settlement throws before any Secret deletion", async () =>
	{
		const record = _Record({ state: McpConnectionStates.Revoked, revokeTask: { taskId: "revoke-1", taskName: "revoke", taskKey: "revoke-key" }, revokedAt: new Date() });
		const transaction = _Transaction(record);
		transaction.connections.markCleanupFailed = vi.fn(async () => ({ ...record, failureCode: McpConnectionFailureCodes.WorkflowExhausted }));
		const deleteExact = vi.fn();
		const controller = new __McpConnectionWorkflowController(_UnitOfWork(transaction), _Secrets({ deleteExact }), { activate: vi.fn() }, { isSettled: vi.fn(async () => { throw new Error("dependency detail"); }) });

		await expect(controller.revoke({ ..._CONTEXT, attempt: 8, task: { taskId: "revoke-1", taskName: "revoke", idempotencyKey: "revoke-key" } }, _INPUT)).rejects.toBeInstanceOf(WorkflowTaskTerminalError);
		expect(transaction.connections.markCleanupFailed).toHaveBeenCalledWith(record, McpConnectionFailureCodes.WorkflowExhausted, expect.any(Date));
		expect(deleteExact).not.toHaveBeenCalled();
		expect(transaction.installRemoval.markRemovedIfSettled).not.toHaveBeenCalled();
	});
});

function _Secrets(overrides: Record<string, unknown> = {})
{
	return { createOrRecover: vi.fn(), recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn(), ...overrides } as never;
}

function _UnitOfWork(transaction: McpConnectionTransaction)
{
	return { execute: async function _Execute<Result>(operation: (value: McpConnectionTransaction) => Promise<Result>): Promise<Result> { return operation(transaction); } };
}

function _Transaction(record: McpConnectionRecord): McpConnectionTransaction
{
	return {
		connections: {
			loadActivationRecord: vi.fn(async () => record),
			loadActivationTarget: vi.fn(async () => ({ record, endpoint: "https://mcp.example.test/rpc" })),
			loadRevocationTarget: vi.fn(async () => record),
			markRecoveryRequired: vi.fn(),
			markActivationFailed: vi.fn(),
			markCleanupFailed: vi.fn(),
			markCleanupComplete: vi.fn(),
			setInstallProjection: vi.fn(),
		} as never,
		installRemoval: { lockForCleanup: vi.fn(), markRemovedWithoutConnection: vi.fn(), markRemoving: vi.fn(), markRemovedIfSettled: vi.fn() },
		installAudit: { appendUninstalled: vi.fn() },
		authorization: { decidePrincipal: vi.fn(async () => ({ outcome: AuthorizationDecisionOutcomes.Allow })) } as never,
	} as never;
}

function _Record(overrides: Partial<McpConnectionRecord> = {}): McpConnectionRecord
{
	return {
		id: "connection-1", siloId: "silo-1", installId: "install-1", serverId: "server-1", ownerPrincipalId: "principal-1", actorPrincipalId: "principal-1", agentServiceId: null, generation: 1,
		credentialRequirement: McpCredentialRequirement.PrincipalCredential, credentialKind: McpConnectionCredentialKinds.Bearer, endpointDigest: `sha256:${"b".repeat(64)}`, state: McpConnectionStates.Activating,
		requestKeyDigest: `sha256:${"c".repeat(64)}`, commandDigest: _INPUT.commandDigest, materialVerifier: `hmac-sha256:${"d".repeat(64)}`, materialVerifierKeyId: "key-1", authorizationDecisionDigest: `sha256:${"e".repeat(64)}`,
		secretRef: "mcp-connection-connection-1-g1", secretUid: "uid-1", secretResourceVersion: "7", credentialCustodiedAt: new Date(), task: { taskId: "task-1", taskName: "activate", taskKey: "task-key" },
		revokeKeyDigest: null, revokeDecisionDigest: null, revokeTask: null, failureCode: null, activatedAt: null, revokedAt: null, cleanupCompletedAt: null,
		...overrides,
	};
}
