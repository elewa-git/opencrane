import { ComputerLeaseStates, ConversationComputerRealizationKinds, ConversationComputerStates } from "@opencrane/contracts";
import { describe, expect, it } from "vitest";

import { _MatchesConversationExecutionSubjectAdmissionFence, _MatchesConversationExecutionSubjectCommand } from "../conversation-execution-subject-admission-fence";
import type { ActiveConversationComputerLease, ConversationExecutionSubjectCoordinates } from "../conversation-execution-subject-admission.types";

const _NOW = "2026-09-06T01:00:00.000Z";
const _COMMAND = {
	runId: "run-1",
	siloId: "silo-1",
	conversationId: "conversation-1",
	agentServiceId: "service-1",
	requestIdempotencyKey: "request-1",
	messageInput: null,
	trigger: "interactive" as const,
	requester: {
		issuer: "issuer-1",
		subjectId: "subject-1",
		authenticatedAt: _NOW,
	},
};
const _RUN = { agentServiceId: "service-1", agentRevisionId: "revision-1" } as never;

/** Supplies the app-bound coordinates shared by both execution-subject authorities. */
function _coordinates(): ConversationExecutionSubjectCoordinates
{
	return {
		runId: "run-1",
		computer: {
			siloId: "silo-1",
			conversationId: "conversation-1",
			computerId: "computer-1",
			agentIdentityId: "identity-1",
		},
		agent: {
			agentServiceId: "service-1",
			agentRevisionId: "revision-1",
			profileRevisionId: "profile-1",
		},
		lease: {
			leaseId: "lease-1",
			leaseGeneration: 3,
			realization: {
				kind: ConversationComputerRealizationKinds.AgentSandbox,
				claimId: "claim-1",
				sandboxId: "sandbox-1",
				serviceFQDN: "sandbox.local",
			},
		},
		requesterPrincipalId: "principal-1",
		requesterIssuer: "issuer-1",
		requesterSubjectId: "subject-1",
		requesterAuthenticatedAt: _NOW,
		requestIdempotencyKey: "request-1",
	};
}

/** Supplies current computer history with independently constructed realization fields. */
function _active(realization: ActiveConversationComputerLease["lease"]["realization"]): ActiveConversationComputerLease
{
	return {
		computer: {
			schemaVersion: 1,
			id: "computer-1",
			siloId: "silo-1",
			conversationId: "conversation-1",
			agentIdentityId: "identity-1",
			profileRevisionId: "profile-1",
			state: ConversationComputerStates.Warm,
			leaseGeneration: 4,
			workspaceCheckpoint: null,
			createdAt: _NOW,
			updatedAt: _NOW,
		},
		lease: {
			schemaVersion: 1,
			id: "lease-1",
			computerId: "computer-1",
			generation: 3,
			realization,
			state: ComputerLeaseStates.Active,
			claimedAt: _NOW,
			expiresAt: "2099-01-01T00:00:00.000Z",
			releasedAt: null,
		},
	};
}

describe("conversation execution-subject admission fence", function _suite()
{
	it("accepts exact Sandbox coordinates regardless of object property insertion order", function _acceptsSandboxCoordinates()
	{
		const coordinates = _coordinates();
		const active = _active({
			serviceFQDN: "sandbox.local",
			sandboxId: "sandbox-1",
			claimId: "claim-1",
			kind: ConversationComputerRealizationKinds.AgentSandbox,
		});
		expect(_MatchesConversationExecutionSubjectAdmissionFence(_COMMAND, _RUN, coordinates, active)).toBe(true);
	});

	it("accepts exact host-process coordinates and rejects any field drift", function _checksHostCoordinates()
	{
		const coordinates = _coordinates();
		const hostCoordinates: ConversationExecutionSubjectCoordinates = {
			...coordinates,
			lease: {
				...coordinates.lease,
				realization: {
					kind: ConversationComputerRealizationKinds.HostDevelopmentProcess,
					processId: "process-1",
					endpoint: "http://127.0.0.1:4310",
				},
			},
		};
		const exact = _active({
			endpoint: "http://127.0.0.1:4310",
			processId: "process-1",
			kind: ConversationComputerRealizationKinds.HostDevelopmentProcess,
		});
		const drifted = _active({
			endpoint: "http://127.0.0.1:4311",
			processId: "process-1",
			kind: ConversationComputerRealizationKinds.HostDevelopmentProcess,
		});
		expect(_MatchesConversationExecutionSubjectAdmissionFence(_COMMAND, _RUN, hostCoordinates, exact)).toBe(true);
		expect(_MatchesConversationExecutionSubjectAdmissionFence(_COMMAND, _RUN, hostCoordinates, drifted)).toBe(false);
	});

	it("rejects invalid command coordinates before current history is considered", function _rejectsCommandDrift()
	{
		const coordinates = _coordinates();
		expect(_MatchesConversationExecutionSubjectCommand({ ..._COMMAND, requestIdempotencyKey: "request-other" }, _RUN, coordinates)).toBe(false);
		expect(_MatchesConversationExecutionSubjectCommand(_COMMAND, _RUN, { ...coordinates, requesterPrincipalId: " " })).toBe(false);
	});
});
