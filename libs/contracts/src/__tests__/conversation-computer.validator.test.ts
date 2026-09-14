import { describe, expect, it } from "vitest";

import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates, type ComputerLease, type ConversationComputer, type ConversationComputerRealization } from "../conversation-computer.types";
import { ___ComputerLeaseSchema, ___ConversationComputerRealizationSchema, ___ConversationComputerSchema } from "../conversation-computer.validator";

/** Supplies the existing public computer shape without sandbox credentials. */
function _Computer(): ConversationComputer
{
	return {
		schemaVersion: 1,
		id: "computer-1",
		siloId: "silo-1",
		conversationId: "conversation-1",
		agentIdentityId: "identity-1",
		profileRevisionId: "profile-1",
		state: ConversationComputerStates.Cold,
		leaseGeneration: 0,
		workspaceCheckpoint: null,
		createdAt: "2026-09-05T00:00:00.000Z",
		updatedAt: "2026-09-05T00:00:00.000Z"
	};
}

/** Supplies the production realization variant without credentials. */
function _AgentSandboxRealization(): ConversationComputerRealization
{
	return {
		kind: ConversationComputerRealizationKinds.AgentSandbox,
		claimId: "claim-1",
		sandboxId: "sandbox-1",
		serviceFQDN: "sandbox-1.test.svc.cluster.local"
	};
}

/** Supplies the local-development realization variant on loopback. */
function _HostDevelopmentRealization(): ConversationComputerRealization
{
	return {
		kind: ConversationComputerRealizationKinds.HostDevelopmentProcess,
		processId: "process-1",
		endpoint: "http://127.0.0.1:4310/"
	};
}

/** Supplies one structurally valid active lease. */
function _Lease(): ComputerLease
{
	return {
		schemaVersion: 1,
		id: "lease-1",
		computerId: "computer-1",
		generation: 1,
		realization: _AgentSandboxRealization(),
		state: ComputerLeaseStates.Active,
		claimedAt: "2026-09-05T00:00:00.000Z",
		expiresAt: "2026-09-05T00:20:00.000Z",
		releasedAt: null
	};
}

describe("ConversationComputer schema", function _DescribeComputer()
{
	it("accepts the existing public shape and checkpoint metadata", function _ValidComputer()
	{
		const computer = {
			..._Computer(),
			workspaceCheckpoint: {
				artifactRevisionId: "artifact-1",
				digest: "sha256:digest",
				format: "workspace-v1",
				checkpointedAt: "2026-09-05T00:00:00.000Z"
			}
		};

		expect(___ConversationComputerSchema.parse(computer)).toEqual(computer);
	});

	it.each([
		{ siloId: "" },
		{ conversationId: " " },
		{ agentIdentityId: null },
		{ profileRevisionId: 3 },
		{ state: "invented" },
		{ leaseGeneration: -1 },
		{ leaseGeneration: 0.5 },
		{ leaseGeneration: Number.MAX_SAFE_INTEGER + 1 },
		{ workspaceCheckpoint: {} },
		{ sandboxToken: "unexpected-private-field" }
	])("rejects malformed coordinates, lifecycle and private extensions", function _MalformedComputer(change)
	{
		expect(___ConversationComputerSchema.safeParse({ ..._Computer(), ...change }).success).toBe(false);
	});

	it.each([
		_AgentSandboxRealization(),
		_HostDevelopmentRealization()
	])("accepts a closed realization variant: %j", function _ValidRealization(realization)
	{
		expect(___ConversationComputerRealizationSchema.parse(realization)).toEqual(realization);
	});

	it("composes realization validation into a strict lease contract", function _ValidLease()
	{
		const lease = _Lease();

		expect(___ComputerLeaseSchema.parse(lease)).toEqual(lease);
		expect(___ComputerLeaseSchema.safeParse({ ...lease, bearerToken: "private" }).success).toBe(false);
		expect(___ComputerLeaseSchema.safeParse({ ...lease, realization: { ...lease.realization, endpoint: "https://example.com" } }).success).toBe(false);
	});

	it("rejects date-only values that Date.parse would otherwise accept as lease timestamps", function _DateOnlyTimestamp()
	{
		expect(___ComputerLeaseSchema.safeParse({ ..._Lease(), claimedAt: "2026-09-05" }).success).toBe(false);
	});
});
