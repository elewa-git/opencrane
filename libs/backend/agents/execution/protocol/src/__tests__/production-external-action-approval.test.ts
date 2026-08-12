import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ExternalActionRecoveryModes, ToolInvocationStates, __DigestCanonicalJson, type OpenDeferredToolApprovalCommand, type ToolInvocationRecord } from "@opencrane/backend/server/iam/authorization";
import type { Logger } from "@opencrane/backend/observability";
import { RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";

import { __CreateProductionExternalActionApprovalOpener } from "../production-external-action-approval.js";

/** Mock of the authorization module, used to inspect the open command it receives. */
const _openApproval = vi.hoisted(function _openMock()
{
	return vi.fn(async function _open(_prisma: PrismaClient, _command: OpenDeferredToolApprovalCommand, _logger: Logger): Promise<boolean> { return true; });
});

vi.mock("@opencrane/backend/server/iam/authorization", async function _mockAuthorization(importOriginal)
{
	const original = await importOriginal<typeof import("@opencrane/backend/server/iam/authorization")>();
	return { ...original, __OpenDeferredToolApproval: _openApproval };
});

/** Fixed server instant used to prove bounded expiry. */
const _NOW = new Date("2026-08-11T10:00:00.000Z");

/** Build one invocation that requires approval, with arguments that must not appear in any public id. */
function _invocation(): ToolInvocationRecord
{
	const argumentsValue = { calendarId: "private-calendar", token: "server-secret" };
	return {
		id: "invocation-row-1",
		siloId: "silo-1",
		runId: "run-1",
		attempt: 1,
		agentRevisionId: "revision-1",
		subjectId: "user-1",
		candidateId: "candidate-1",
		toolInvocationId: "tool-call-1",
		toolRevisionId: "integration:calendar:read",
		arguments: argumentsValue,
		argumentsDigest: __DigestCanonicalJson(argumentsValue),
		effectiveArguments: argumentsValue,
		effectiveArgumentsDigest: __DigestCanonicalJson(argumentsValue),
		requestFingerprint: `sha256:${"a".repeat(64)}`,
		approvalRequired: true,
		recoveryMode: ExternalActionRecoveryModes.Manual,
		recoveryKey: null,
		state: ToolInvocationStates.AwaitingApproval,
		preparationAttempt: 1,
		retryDeadlineAt: new Date("2026-08-11T10:05:00.000Z"),
		nextPreparationAttemptAt: _NOW,
		claimAttempt: 0,
		claimKind: null,
		claimFence: 0,
		claimExpiresAt: null,
		result: null,
		failureCode: null,
		revision: 2,
	};
}

/** Build the snapshot tool definition that the tool revision id was built from. */
function _snapshot(): RunInputSnapshot
{
	const parametersSchema = { type: "object", additionalProperties: false, required: ["calendarId", "token"], properties: { calendarId: { type: "string" }, token: { type: "string", writeOnly: true } } };
	return {
		runId: "run-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		snapshotVersion: 1,
		conversationId: "conversation-1",
		messageIds: [],
		personaRevisionId: null,
		preferenceFactIds: [],
		artifactRevisionIds: [],
		skillRevisionIds: [],
		memoryFacts: [],
		memoryQueryPolicy: {},
		integrationAssignments: [{ integrationId: "calendar", toolDefinitions: [{ name: "read", description: "Read a calendar", parametersSchema, parametersSchemaDigest: __DigestCanonicalJson(parametersSchema) }] }],
		modelRoute: {},
		budgetPolicy: {},
		identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "user-1", organizationId: "org-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer-1", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"b".repeat(64)}`, fleetMembershipTrustedUntil: "2026-08-11T11:00:00.000Z" },
		capabilitySetDigest: `sha256:${"c".repeat(64)}`,
		effectiveContractDigest: `sha256:${"d".repeat(64)}`,
		promptCompilerVersion: "prompt-v1",
		digest: `sha256:${"e".repeat(64)}`,
		compiledAt: "2026-08-11T09:59:00.000Z",
	};
}

describe("production external-action approval opener", function _suite()
{
	it("opens from the exact frozen schema with an opaque stable id and bounded expiry", async function _opens()
	{
		_openApproval.mockClear();
		const opener = __CreateProductionExternalActionApprovalOpener({} as PrismaClient, { warn: vi.fn(), error: vi.fn() } as unknown as Logger);
		const invocation = _invocation();
		const context = { snapshot: _snapshot() };

		await expect(opener.open(invocation, context, _NOW)).resolves.toBe(true);
		await expect(opener.open(invocation, context, _NOW)).resolves.toBe(true);
		const command = _openApproval.mock.calls[0]?.[1];
		if (command === undefined) throw new Error("approval command was not captured");
		const definition = context.snapshot.integrationAssignments[0]!.toolDefinitions[0]!;
		const expected: OpenDeferredToolApprovalCommand = {
			interruptId: command.interruptId,
			runId: "run-1",
			attempt: 1,
			toolInvocationId: "tool-call-1",
			toolRevisionId: "integration:calendar:read",
			arguments: invocation.arguments,
			argumentsDigest: invocation.argumentsDigest,
			parametersSchema: definition.parametersSchema,
			parametersSchemaDigest: definition.parametersSchemaDigest,
			capabilitySetDigest: context.snapshot.capabilitySetDigest,
			invocationId: "invocation-row-1",
			now: _NOW,
			expiresAt: new Date("2026-08-11T10:15:00.000Z"),
		};
		expect(command as unknown).toEqual(expected as unknown);
		expect(command?.interruptId).toMatch(/^tool-approval-[0-9a-f]{64}$/);
		expect(_openApproval.mock.calls[1]?.[1].interruptId).toBe(command?.interruptId);
		expect(command?.interruptId).not.toContain("invocation-row-1");
		expect(command?.interruptId).not.toContain("server-secret");
	});

	it("fails before persistence when the frozen schema digest is invalid", async function _invalidSchemaDigest()
	{
		_openApproval.mockClear();
		const snapshot = _snapshot();
		const assignment = snapshot.integrationAssignments[0]!;
		const context = { snapshot: { ...snapshot, integrationAssignments: [{ ...assignment, toolDefinitions: [{ ...assignment.toolDefinitions[0]!, parametersSchemaDigest: `sha256:${"f".repeat(64)}` }] }] } };
		const opener = __CreateProductionExternalActionApprovalOpener({} as PrismaClient, { warn: vi.fn(), error: vi.fn() } as unknown as Logger);

		await expect(opener.open(_invocation(), context, _NOW)).rejects.toThrow("schema digest is invalid");
		expect(_openApproval).not.toHaveBeenCalled();
	});
});
