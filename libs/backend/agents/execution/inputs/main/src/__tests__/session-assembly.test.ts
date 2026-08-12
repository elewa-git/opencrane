import { MemoryFactProvenanceSourceKinds, RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { AgentServiceKinds } from "@opencrane/models/agents";
import { MessageContentBlockKinds } from "@opencrane/models/conversations";
import { RunAdmissionDenialReasons, type UserRunAdmissionCommand } from "@opencrane/backend/agents/execution/runs";
import { ___DigestCanonicalJson } from "@opencrane/util";
import type { SessionAssemblyAuthorities } from "../session-assembly.types.js";
import { describe, expect, it } from "vitest";

import { __AssembleRunInputSnapshot } from "../session-assembly.js";

/** The fixed command these tests use to check snapshot assembly is deterministic. */
const _COMMAND: UserRunAdmissionCommand = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: "conversation-1", identityKind: "user", trigger: "interactive", executionSubjectId: "user-1", requestIdempotencyKey: "request-1", inputMessageId: "message-current", inputMessageBlocks: [{ id: "block-1", kind: MessageContentBlockKinds.Text, value: "Hello" }] };

/** Build one reviewed integration tool definition. */
function _Tool(name: string)
{
	const parametersSchema = { type: "object", additionalProperties: false } as const;
	return { name, description: `${name} description`, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
}

/** Builds fake source ports, each replaceable on its own, that return their lists out of order on purpose. */
function _Authorities(onAdmission: (snapshot: RunInputSnapshot) => "accepted" | "idempotent" | "active_run" | "persistence_unavailable", personaRevisionId: string | null = "persona-1"): SessionAssemblyAuthorities
{
	return {
		admission: {
			admit: async function _admit(_command, build)
			{
				const compiled = await build({ prisma: {} as never, admittedAt: "2026-07-19T12:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-19T12:00:00.000Z") });
				if (compiled.outcome === "denied") return { outcome: "denied", reason: compiled.reason };
				const outcome = onAdmission(compiled.value.snapshot);
				if (outcome === "persistence_unavailable") return { outcome: "denied", reason: RunAdmissionDenialReasons.PersistenceUnavailable } as const;
				if (outcome === "active_run") return { outcome: "denied", reason: RunAdmissionDenialReasons.ActiveRun } as const;
				return { outcome, snapshot: compiled.value.snapshot } as const;
			},
		},
		runAuthority: { load: async function _load() { return { outcome: "loaded", value: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: AgentServiceKinds.Personal, effectiveContractDigest: "sha256:contract", promptCompilerVersion: "prompt-v1", trigger: "interactive", delegatedUserId: "user-1", rootRunId: "run-1", parentRunId: null } } as const; } },
		approvedPersona: { load: async function _load() { return { outcome: "loaded", value: { personaRevisionId } } as const; } },
		conversationContext: { load: async function _load() { return { outcome: "loaded", value: { messageIds: ["message-2", "message-1"], pendingUserMessage: { id: "message-1", blocks: [{ id: "block-1", kind: MessageContentBlockKinds.Text, value: "Hello" }] } } } as const; } },
		preferenceFacts: { load: async function _load() { return { outcome: "loaded", value: [{ id: "preference-2" }, { id: "preference-1" }] } as const; } },
		memoryScope: { load: async function _load() { return { outcome: "loaded", value: { memoryQueryPolicy: { scope: "personal" }, memoryFacts: [{ datasetId: "dataset-b", factId: "fact-2", contentDigest: `sha256:${"1".repeat(64)}`, provenance: [{ sourceKind: MemoryFactProvenanceSourceKinds.Message, sourceId: "message-2", capturedAt: "2026-07-19T11:59:00.000Z" }] }, { datasetId: "dataset-a", factId: "fact-1", contentDigest: `sha256:${"2".repeat(64)}`, provenance: [{ sourceKind: MemoryFactProvenanceSourceKinds.ExplicitUserFact, sourceId: "preference-1", sourceUserId: "user-1", capturedAt: "2026-07-19T11:58:00.000Z" }] }] } } as const; } },
		toolPolicy: { load: async function _load() { return { outcome: "loaded", value: { modelRoute: { alias: "target-model" }, integrationAssignments: [{ integrationId: "integration-2", toolDefinitions: [_Tool("write"), _Tool("read")] }, { integrationId: "integration-1", toolDefinitions: [_Tool("search")] }], skillRevisionIds: ["skill-2", "skill-1"], artifactRevisionIds: ["artifact-2", "artifact-1"] } } as const; } },
		skillEligibility: { load: async function _load() { return { outcome: "loaded", value: null } as const; } },
		budgetPolicy: { load: async function _load() { return { outcome: "loaded", value: { budgetPolicy: { maxTokens: 1000, maxTurns: 4 } } } as const; } },
		identityEnvelope: { load: async function _load() { return { outcome: "loaded", value: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "user-1", organizationId: "org-1", fleetMembershipRevision: 8, fleetMembershipIssuer: "opencrane-fleet", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"e".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-20T13:00:00.000Z", capabilitySetDigest: `sha256:${"f".repeat(64)}` } } as const; } },
	};
}

describe("__AssembleRunInputSnapshot", function _describeSessionAssembly()
{
	it("sorts independently loaded inputs and produces an identical digest for the same durable facts", async function _assemblesDeterministically()
	{
		const firstSnapshots: RunInputSnapshot[] = [];
		const secondSnapshots: RunInputSnapshot[] = [];
		const first = await __AssembleRunInputSnapshot(_COMMAND, _Authorities(function _accept(snapshot) { firstSnapshots.push(snapshot); return "accepted"; }));
		const second = await __AssembleRunInputSnapshot(_COMMAND, _Authorities(function _accept(snapshot) { secondSnapshots.push(snapshot); return "accepted"; }));

		expect(first.outcome).toBe("assembled");
		expect(second.outcome).toBe("assembled");
		expect(firstSnapshots[0]?.digest).toBe(secondSnapshots[0]?.digest);
		expect(firstSnapshots[0]?.messageIds).toEqual(["message-2", "message-1"]);
		expect(firstSnapshots[0]?.preferenceFactIds).toEqual(["preference-1", "preference-2"]);
		expect(firstSnapshots[0]?.memoryFacts.map(function _factId(fact) { return fact.factId; })).toEqual(["fact-1", "fact-2"]);
		expect(firstSnapshots[0]?.integrationAssignments).toEqual([{ integrationId: "integration-1", toolDefinitions: [_Tool("search")] }, { integrationId: "integration-2", toolDefinitions: [_Tool("read"), _Tool("write")] }]);
	});

	it("fails closed before persistence when a personal service has no active approved persona", async function _deniesMissingPersona()
	{
		let admitted = false;
		const result = await __AssembleRunInputSnapshot(_COMMAND, _Authorities(function _accept() { admitted = true; return "accepted"; }, null));

		expect(result).toEqual({ outcome: "denied", reason: "persona_unavailable" });
		expect(admitted).toBe(false);
	});

	it("fails closed before persistence when a managed service carries an approved persona", async function _deniesManagedPersona()
	{
		let admitted = false;
		const authorities = _Authorities(function _accept() { admitted = true; return "accepted"; });
		authorities.runAuthority = { load: async function _load() { return { outcome: "loaded", value: { agentServiceId: "service-1", agentRevisionId: "revision-1", agentKind: AgentServiceKinds.Managed, effectiveContractDigest: "sha256:contract", promptCompilerVersion: "prompt-v1", trigger: "managed_invocation", delegatedUserId: null, rootRunId: "run-1", parentRunId: null } } as const; } };
		authorities.identityEnvelope = { load: async function _load() { return { outcome: "loaded", value: { kind: RunInputSnapshotIdentityKinds.Service, executionSubjectId: "agent-service:service-1", agentServiceId: "service-1", organizationId: "org-1", fleetMembershipRevision: 8, fleetMembershipIssuer: "opencrane-fleet", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"e".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-20T13:00:00.000Z", effectiveScopeAttachments: [], effectiveScopeAttachmentDigest: `sha256:${"a".repeat(64)}`, capabilitySetDigest: `sha256:${"f".repeat(64)}` } } as const; } };

		const result = await __AssembleRunInputSnapshot({ runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", conversationId: null, identityKind: "service", trigger: "managed_invocation", requestIdempotencyKey: "request-1" }, authorities);

		expect(result).toEqual({ outcome: "denied", reason: "persona_unavailable" });
		expect(admitted).toBe(false);
	});

	it("returns a typed source refusal without accepting a partial snapshot", async function _deniesSourceRefusal()
	{
		let admitted = false;
		const authorities = _Authorities(function _accept() { admitted = true; return "accepted"; });
		authorities.memoryScope = { load: async function _load() { return { outcome: "denied", reason: "memory_scope_unavailable" } as const; } };

		const result = await __AssembleRunInputSnapshot(_COMMAND, authorities);

		expect(result).toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
		expect(admitted).toBe(false);
	});

	it("preserves the durable active-run classification after final assembly", async function _preservesActiveRun()
	{
		const result = await __AssembleRunInputSnapshot(_COMMAND, _Authorities(function _denyActiveRun() { return "active_run"; }));

		expect(result).toEqual({ outcome: "denied", reason: "active_run" });
	});

	it("fails closed when an integration assignment cannot form an unambiguous tool revision", async function _deniesAmbiguousIntegrationTool()
	{
		let admitted = false;
		const authorities = _Authorities(function _accept() { admitted = true; return "accepted"; });
		authorities.toolPolicy = { load: async function _load() { return { outcome: "loaded", value: { modelRoute: {}, integrationAssignments: [{ integrationId: "calendar", toolDefinitions: [_Tool("calendar:read")] }], skillRevisionIds: [], artifactRevisionIds: [] } } as const; } };

		await expect(__AssembleRunInputSnapshot(_COMMAND, authorities)).resolves.toEqual({ outcome: "denied", reason: "tool_policy_unavailable" });
		expect(admitted).toBe(false);
	});

	it("fails closed when an assigned skill revision is no longer eligible for a future admission", async function _deniesUnavailableSkill()
	{
		let admitted = false;
		const authorities = _Authorities(function _accept() { admitted = true; return "accepted"; });
		authorities.skillEligibility = { load: async function _load() { return { outcome: "denied", reason: "skill_unavailable" } as const; } };

		const result = await __AssembleRunInputSnapshot(_COMMAND, authorities);

		expect(result).toEqual({ outcome: "denied", reason: "skill_unavailable" });
		expect(admitted).toBe(false);
	});

	it("accepts a non-conversational run only when it has no transcript messages", async function _assemblesNonConversationalRun()
	{
		const authorities = _Authorities(function _accept() { return "accepted"; });
		authorities.conversationContext = { load: async function _load() { return { outcome: "loaded", value: { messageIds: [], pendingUserMessage: null } } as const; } };

		const result = await __AssembleRunInputSnapshot({ ..._COMMAND, conversationId: null }, authorities);

		expect(result.outcome).toBe("assembled");
		if (result.outcome === "assembled") expect(result.snapshot.conversationId).toBeNull();
	});

	it("returns the snapshot selected by an earlier admission without compiling a later request timestamp", async function _returnsIdempotentSnapshot()
	{
		let sourceLoads = 0;
		const previous = { runId: "run-1", siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", snapshotVersion: 1, conversationId: "conversation-1", messageIds: [], personaRevisionId: null, preferenceFactIds: [], artifactRevisionIds: [], skillRevisionIds: [], memoryFacts: [], memoryQueryPolicy: {}, integrationAssignments: [], modelRoute: {}, budgetPolicy: {}, identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionSubjectId: "user-1", organizationId: "org-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "issuer-1", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"a".repeat(64)}`, fleetMembershipTrustedUntil: "2026-07-21T00:00:00.000Z" }, capabilitySetDigest: `sha256:${"b".repeat(64)}`, effectiveContractDigest: `sha256:${"c".repeat(64)}`, promptCompilerVersion: "prompt-v1", digest: `sha256:${"d".repeat(64)}`, compiledAt: "2026-07-19T12:00:00.000Z" } as const;
		const authorities = _Authorities(function _accept() { return "accepted"; });
		authorities.admission = { admit: async function _admit() { return { outcome: "idempotent", snapshot: previous } as const; } };
		authorities.runAuthority = { load: async function _load() { sourceLoads += 1; return { outcome: "denied", reason: "run_not_admittable" } as const; } };

		await expect(__AssembleRunInputSnapshot(_COMMAND, authorities)).resolves.toEqual({ outcome: "assembled", admissionOutcome: "idempotent", snapshot: previous });
		expect(sourceLoads).toBe(0);
	});

	it("rejects a blank execution subject before the admission repository starts", async function _deniesBlankSubject()
	{
		let admitted = false;
		const authorities = _Authorities(function _accept() { admitted = true; return "accepted"; });

		const result = await __AssembleRunInputSnapshot({ ..._COMMAND, executionSubjectId: " " }, authorities);

		expect(result).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(admitted).toBe(false);
	});
});
