import { describe, expect, it, vi } from "vitest";

import { McpConnectionCredentialKinds, McpCredentialRequirement } from "@opencrane/contracts";

import { __McpConnectionCredentialReader } from "../mcp-connection-credential-reader";
import { McpConnectionCredentialReadOutcomes } from "../mcp-connection-credential-reader.types";
import { McpConnectionSecretReadOutcomes, McpConnectionStates, type McpConnectionAdmissionUnitOfWork, type McpConnectionRecord, type McpConnectionTransaction } from "../mcp-connection.types";
import { PrismaMcpConnectionRepository } from "../prisma-mcp-connection-repository";

const _COMMAND = { siloId: "silo-1", connectionId: "connection-1", generation: 2, ownerPrincipalId: "principal-1", serverId: "server-1", serverRevisionId: "revision-1" } as const;

describe("MCP connection credential reader", () =>
{
	it("returns no material and performs no Secret read when SQL coordinates are unavailable", async () =>
	{
		const readExact = vi.fn();
		const reader = new __McpConnectionCredentialReader(_UnitOfWork(null), { createOrRecover: vi.fn(), recoverIdentity: vi.fn(), readExact, deleteExact: vi.fn() });

		await expect(reader.readExact(_COMMAND)).resolves.toEqual({ outcome: McpConnectionCredentialReadOutcomes.NotFound });
		expect(readExact).not.toHaveBeenCalled();
	});

	it("returns credentialless only when no Secret evidence exists", async () =>
	{
		const reader = new __McpConnectionCredentialReader(_UnitOfWork(_Record({ credentialKind: McpConnectionCredentialKinds.None, materialVerifier: null, materialVerifierKeyId: null, secretRef: null, secretUid: null, secretResourceVersion: null })), { createOrRecover: vi.fn(), recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() });
		const inconsistent = new __McpConnectionCredentialReader(_UnitOfWork(_Record({ credentialKind: McpConnectionCredentialKinds.None, materialVerifier: null, materialVerifierKeyId: null, secretRef: "unexpected", secretUid: null, secretResourceVersion: null })), { createOrRecover: vi.fn(), recoverIdentity: vi.fn(), readExact: vi.fn(), deleteExact: vi.fn() });

		await expect(reader.readExact(_COMMAND)).resolves.toEqual({ outcome: McpConnectionCredentialReadOutcomes.Ready, credential: { kind: McpConnectionCredentialKinds.None } });
		await expect(inconsistent.readExact(_COMMAND)).resolves.toEqual({ outcome: McpConnectionCredentialReadOutcomes.RecoveryRequired });
	});

	it("returns bearer material only from an exact Secret read", async () =>
	{
		const readExact = vi.fn(async () => ({ outcome: McpConnectionSecretReadOutcomes.Found, bearerToken: "ephemeral-token" } as const));
		const reader = new __McpConnectionCredentialReader(_UnitOfWork(_Record()), { createOrRecover: vi.fn(), recoverIdentity: vi.fn(), readExact, deleteExact: vi.fn() });

		await expect(reader.readExact(_COMMAND)).resolves.toEqual({ outcome: McpConnectionCredentialReadOutcomes.Ready, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "ephemeral-token" } });
		expect(readExact).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "connection-1", generation: 2, expectedIdentity: { secretRef: "mcp-connection-connection-1-g2", secretUid: "uid-1", secretResourceVersion: "7" } }), undefined);
	});

	it("does not open a Secret read when its signal aborts during the SQL lookup", async function _AbortAfterSql()
	{
		let releaseSql: (() => void) | undefined;
		const sqlBarrier = new Promise<void>(function _WaitForSql(resolve)
		{
			releaseSql = resolve;
		});
		const unitOfWork = { execute: async function _Execute<Result>(operation: (transaction: McpConnectionTransaction) => Promise<Result>): Promise<Result>
		{
			await sqlBarrier;
			return operation({ connections: { readExecutionCredential: vi.fn(async function _Read() { return _Record(); }) } } as never);
		} };
		const readExact = vi.fn();
		const reader = new __McpConnectionCredentialReader(unitOfWork, { createOrRecover: vi.fn(), recoverIdentity: vi.fn(), readExact, deleteExact: vi.fn() });
		const controller = new AbortController();
		const result = reader.readExact(_COMMAND, controller.signal);

		controller.abort();
		releaseSql?.();

		await expect(result).resolves.toEqual({ outcome: McpConnectionCredentialReadOutcomes.Uncertain });
		expect(readExact).not.toHaveBeenCalled();
	});

	it("queries the complete claimed generation and Ready revision binding", async () =>
	{
		const findFirst = vi.fn(async () => null);
		const repository = new PrismaMcpConnectionRepository({ mcpConnection: { findFirst } } as never);

		await repository.readExecutionCredential(_COMMAND);
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
			id: "connection-1",
			siloId: "silo-1",
			generation: 2,
			ownerPrincipalId: "principal-1",
			mcpServerId: "server-1",
			state: { in: ["Active", "Revoked"] },
			cleanupCompletedAt: null,
			revisions: { some: { id: "revision-1", state: "Ready" } },
		} }));
	});
});

function _UnitOfWork(record: McpConnectionRecord | null): McpConnectionAdmissionUnitOfWork
{
	return { execute: async function _Execute<Result>(operation: (transaction: McpConnectionTransaction) => Promise<Result>): Promise<Result>
	{
		return operation({ connections: { readExecutionCredential: vi.fn(async () => record) } } as never);
	} };
}

function _Record(overrides: Partial<McpConnectionRecord> = {}): McpConnectionRecord
{
	return {
		id: "connection-1", siloId: "silo-1", installId: "install-1", serverId: "server-1", ownerPrincipalId: "principal-1", actorPrincipalId: "principal-1", agentServiceId: null, generation: 2,
		credentialRequirement: McpCredentialRequirement.PrincipalCredential, credentialKind: McpConnectionCredentialKinds.Bearer, endpointDigest: `sha256:${"a".repeat(64)}`, state: McpConnectionStates.Active,
		requestKeyDigest: `sha256:${"b".repeat(64)}`, commandDigest: `sha256:${"c".repeat(64)}`, materialVerifier: `hmac-sha256:${"d".repeat(64)}`, materialVerifierKeyId: "key-1", authorizationDecisionDigest: `sha256:${"e".repeat(64)}`,
		secretRef: "mcp-connection-connection-1-g2", secretUid: "uid-1", secretResourceVersion: "7", credentialCustodiedAt: new Date("2026-09-12T12:00:00.000Z"),
		task: { taskId: "task-1", taskName: "activate", taskKey: "task-key" }, revokeKeyDigest: null, revokeDecisionDigest: null, revokeTask: null, failureCode: null, activatedAt: new Date("2026-09-12T12:00:01.000Z"), revokedAt: null, cleanupCompletedAt: null,
		...overrides,
	};
}
