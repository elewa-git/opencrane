import { AgentServiceKinds, RevisionBoundaryCoverages, RevisionBoundaryKinds, type AgentRevision, type AgentRevisionContent, type AgentService } from "@opencrane/models/agents";
import { describe, expect, it } from "vitest";

import { __AdmitManagedRunNow, __ChangeAgentServiceState, __CompareAgentRevisions, __CreateManagedAgentService, __ReadAgentServiceHistory, __RestoreAgentRevision, __ReviseAgentRevision } from "../agent-revision-lifecycle";
import { ManagedRunAdmissionOutcomes, type AgentRevisionLifecycleRepository, type AgentServiceHistory, type AppendAgentRevisionResult, type ChangeAgentServiceStateCommand, type ChangeAgentServiceStateResult, type CreateManagedAgentServiceCommand, type CreateManagedAgentServiceResult, type ManagedRunAdmissionPort, type ManagedRunAdmissionResult, type ManagedRunNowCommand, type RestoreAgentRevisionCommand, type ReviseAgentRevisionCommand } from "../agent-revision-lifecycle.types";

/** Exhaustive service-state result for each lifecycle action used by the repository double. */
const _STATE_BY_ACTION: Readonly<Record<ChangeAgentServiceStateCommand["action"], AgentService["state"]>> = {
	enable: "active",
	pause: "paused",
	retire: "retired",
};

/** Builds valid executable content for a managed revision. */
function _content(overrides: Partial<AgentRevisionContent> = {}): AgentRevisionContent
{
	return { promptPolicyVersion: "prompt-v1", personaRevisionId: null, modelDefinitionId: "model-definition-a", budget: { maxTurns: 5, maxTokens: 1000, maxDurationMs: 30000 }, skills: [], mcpToolRevisionIds: [], boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "proj-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }], ...overrides };
}

/** Minimal in-memory definition-plane repository, silo-scoped like the Prisma adapter. */
class _Repository implements AgentRevisionLifecycleRepository
{
	readonly services = new Map<string, AgentService>();
	readonly revisions: AgentRevision[] = [];
	private counter = 0;

	async listManagedServices(siloId: string): Promise<readonly AgentService[]>
	{
		return [...this.services.values()].filter(service => service.siloId === siloId && service.kind === AgentServiceKinds.Managed).sort(function _newestFirst(left, right) { return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id); });
	}

	async getService(id: string, siloId: string): Promise<AgentService | null>
	{
		const service = this.services.get(id) ?? null;
		return service !== null && service.siloId === siloId ? service : null;
	}

	async getRevision(id: string, siloId: string): Promise<AgentRevision | null>
	{
		const revision = this.revisions.find(entry => entry.id === id) ?? null;
		if (revision === null) return null;
		const service = this.services.get(revision.agentServiceId) ?? null;
		return service !== null && service.siloId === siloId ? revision : null;
	}

	async createManagedService(command: CreateManagedAgentServiceCommand, createdAt: string): Promise<CreateManagedAgentServiceResult>
	{
		const serviceId = `service-${++this.counter}`;
		const service: AgentService = { id: serviceId, siloId: command.siloId, kind: AgentServiceKinds.Managed, name: command.name, state: "draft", activeRevisionId: null, workloadProfile: command.workloadProfile, createdAt, updatedAt: createdAt };
		const revision = this._append(serviceId, 1, null, null, command.content, command.authoredBy, command.changeMessage, createdAt);
		this.services.set(serviceId, service);
		return { outcome: "created", service, revision };
	}

	async reviseRevision(command: ReviseAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		if (this._siloService(command.agentServiceId, command.siloId) === null) return { outcome: "denied", reason: "service_not_found" };
		const head = this._head(command.agentServiceId);
		if (head === null || head.id !== command.expectedParentRevisionId) return { outcome: "conflict", currentHeadRevisionId: head?.id ?? null };
		return { outcome: "revised", revision: this._append(command.agentServiceId, head.revision + 1, head.id, null, command.content, command.authoredBy, command.changeMessage, createdAt) };
	}

	async restoreRevision(command: RestoreAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
	{
		if (this._siloService(command.agentServiceId, command.siloId) === null) return { outcome: "denied", reason: "service_not_found" };
		const head = this._head(command.agentServiceId);
		if (head === null || head.id !== command.expectedParentRevisionId) return { outcome: "conflict", currentHeadRevisionId: head?.id ?? null };
		// Silo-scope the source lookup exactly like the Prisma adapter: a foreign-silo source is a 404.
		const source = this.revisions.find(revision => revision.id === command.sourceRevisionId && this._siloService(revision.agentServiceId, command.siloId) !== null);
		if (source === undefined) return { outcome: "denied", reason: "revision_not_found" };
		const content: AgentRevisionContent = { promptPolicyVersion: source.promptPolicyVersion, personaRevisionId: source.personaRevisionId, modelDefinitionId: source.modelDefinitionId, budget: source.budget, skills: source.skills.map(skill => ({ skillId: skill.skillId, revisionId: skill.revisionId })), mcpToolRevisionIds: [...source.mcpToolRevisionIds], boundaryAttachments: source.boundaryAttachments.map(attachment => ({ ...attachment })) };
		return { outcome: "revised", revision: this._append(command.agentServiceId, head.revision + 1, head.id, source.id, content, command.authoredBy, command.changeMessage, createdAt) };
	}

	async changeServiceState(command: ChangeAgentServiceStateCommand, changedAt: string): Promise<ChangeAgentServiceStateResult>
	{
		const service = this._siloService(command.agentServiceId, command.siloId);
		if (service === null) return { outcome: "denied", reason: "service_not_found" };
		if (service.state !== command.expectedState) return { outcome: "conflict", currentState: service.state };
		if (command.action === "enable" && service.activeRevisionId === null) return { outcome: "denied", reason: "service_not_runnable" };
		const state = _STATE_BY_ACTION[command.action];
		const updated: AgentService = { ...service, state, activeRevisionId: command.action === "retire" ? null : service.activeRevisionId, updatedAt: changedAt };
		this.services.set(service.id, updated);
		return { outcome: "changed", service: updated };
	}

	async readHistory(agentServiceId: string, siloId: string): Promise<AgentServiceHistory>
	{
		if (this._siloService(agentServiceId, siloId) === null) return { revisions: [], runs: [] };
		return { revisions: this.revisions.filter(revision => revision.agentServiceId === agentServiceId).reverse(), runs: [] };
	}

	/** Returns a service only when it exists in the caller's silo. */
	private _siloService(id: string, siloId: string): AgentService | null
	{
		const service = this.services.get(id) ?? null;
		return service !== null && service.siloId === siloId ? service : null;
	}

	/** Returns the highest-numbered revision for a service. */
	private _head(agentServiceId: string): AgentRevision | null
	{
		const owned = this.revisions.filter(revision => revision.agentServiceId === agentServiceId);
		return owned.length === 0 ? null : owned[owned.length - 1];
	}

	/** Appends one immutable draft revision to the in-memory store. */
	private _append(agentServiceId: string, revision: number, parentRevisionId: string | null, sourceRevisionId: string | null, content: AgentRevisionContent, authoredBy: string, changeMessage: string, createdAt: string): AgentRevision
	{
		const record: AgentRevision = { id: `revision-${++this.counter}`, agentServiceId, revision, parentRevisionId, sourceRevisionId, changeMessage, state: "draft", digest: `sha256:${revision}`, promptPolicyVersion: content.promptPolicyVersion, personaRevisionId: content.personaRevisionId, modelDefinitionId: content.modelDefinitionId, skills: content.skills.map(skill => ({ ...skill })), mcpToolRevisionIds: [...content.mcpToolRevisionIds], boundaryAttachments: content.boundaryAttachments.map(attachment => ({ ...attachment })), budget: content.budget, authoredBy, createdAt, publishedAt: null };
		this.revisions.push(record);
		return record;
	}
}

/** Records the last admission command a run-now request reached. */
class _AdmissionPort implements ManagedRunAdmissionPort
{
	lastCommand: ManagedRunNowCommand | null = null;
	async admitManagedRun(command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult>
	{
		this.lastCommand = command;
		return { outcome: ManagedRunAdmissionOutcomes.Accepted, runId: "run-1" };
	}
}

const _NOW = "2026-07-21T00:00:00.000Z";
const _SILO = "silo-1";

/** Creates one managed service and returns its identifiers. */
async function _seedService(repository: _Repository, siloId = _SILO): Promise<{ serviceId: string; revisionId: string }>
{
	const created = await __CreateManagedAgentService(repository, { siloId, name: "Reporter", workloadProfile: "managed-default", authoredBy: "admin-1", changeMessage: "initial", content: _content() }, _NOW);
	if (created.outcome !== "created") throw new Error("expected created");
	return { serviceId: created.service.id, revisionId: created.revision.id };
}

describe("managed agent revision lifecycle", function _suite()
{
	it("creates a managed service with a first draft revision and rejects a persona", async function _create()
	{
		const repository = new _Repository();
		const created = await __CreateManagedAgentService(repository, { siloId: _SILO, name: "Reporter", workloadProfile: "managed-default", authoredBy: "admin-1", changeMessage: "initial", content: _content() }, _NOW);
		expect(created.outcome).toBe("created");
		const withPersona = await __CreateManagedAgentService(repository, { siloId: _SILO, name: "Bad", workloadProfile: "managed-default", authoredBy: "admin-1", changeMessage: "x", content: _content({ personaRevisionId: "persona-1" }) }, _NOW);
		expect(withPersona).toEqual({ outcome: "denied", reason: "invalid_command" });
	});

	it("rejects a workload profile the deployed controller cannot resolve", async function _unknownProfile()
	{
		const repository = new _Repository();
		const created = await __CreateManagedAgentService(repository, { siloId: _SILO, name: "Reporter", workloadProfile: "reports-v2", authoredBy: "admin-1", changeMessage: "initial", content: _content() }, _NOW);
		expect(created).toEqual({ outcome: "denied", reason: "invalid_command" });
		expect(repository.services.size).toBe(0);
	});

	it("rejects duplicate boundary attachments with a validation denial, not a persistence error", async function _duplicateAttachment()
	{
		const repository = new _Repository();
		const created = await __CreateManagedAgentService(repository, { siloId: _SILO, name: "Reporter", workloadProfile: "managed-default", authoredBy: "admin-1", changeMessage: "initial", content: _content({ boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "proj-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }, { boundaryKind: RevisionBoundaryKinds.Group, boundaryId: "proj-1", boundaryCoverage: RevisionBoundaryCoverages.Exact }] }) }, _NOW);
		expect(created).toEqual({ outcome: "denied", reason: "invalid_command" });
	});

	it("appends a revision on the expected head and conflicts on a stale parent", async function _revise()
	{
		const repository = new _Repository();
		const seed = await _seedService(repository);
		const revised = await __ReviseAgentRevision(repository, { siloId: _SILO, agentServiceId: seed.serviceId, expectedParentRevisionId: seed.revisionId, authoredBy: "admin-1", changeMessage: "edit", content: _content({ modelDefinitionId: "model-definition-b" }) }, _NOW);
		expect(revised.outcome).toBe("revised");
		const stale = await __ReviseAgentRevision(repository, { siloId: _SILO, agentServiceId: seed.serviceId, expectedParentRevisionId: seed.revisionId, authoredBy: "admin-1", changeMessage: "edit-2", content: _content() }, _NOW);
		expect(stale.outcome).toBe("conflict");
	});

	it("restores a source revision into a new revision recording its source", async function _restore()
	{
		const repository = new _Repository();
		const seed = await _seedService(repository);
		const revised = await __ReviseAgentRevision(repository, { siloId: _SILO, agentServiceId: seed.serviceId, expectedParentRevisionId: seed.revisionId, authoredBy: "admin-1", changeMessage: "edit", content: _content({ modelDefinitionId: "model-definition-b" }) }, _NOW);
		if (revised.outcome !== "revised") throw new Error("expected revised");
		const restored = await __RestoreAgentRevision(repository, { siloId: _SILO, agentServiceId: seed.serviceId, sourceRevisionId: seed.revisionId, expectedParentRevisionId: revised.revision.id, authoredBy: "admin-1", changeMessage: "restore v1" }, _NOW);
		if (restored.outcome !== "revised") throw new Error("expected revised");
		expect(restored.revision.sourceRevisionId).toBe(seed.revisionId);
		expect(restored.revision.parentRevisionId).toBe(revised.revision.id);
		expect(restored.revision.modelDefinitionId).toBe("model-definition-a");
	});

	it("enforces legal state transitions and optimistic concurrency", async function _state()
	{
		const repository = new _Repository();
		const seed = await _seedService(repository);
		repository.services.set(seed.serviceId, { ...repository.services.get(seed.serviceId)!, activeRevisionId: seed.revisionId });
		const enabled = await __ChangeAgentServiceState(repository, { siloId: _SILO, agentServiceId: seed.serviceId, expectedState: "draft", action: "enable" }, _NOW);
		expect(enabled.outcome).toBe("changed");
		const badTransition = await __ChangeAgentServiceState(repository, { siloId: _SILO, agentServiceId: seed.serviceId, expectedState: "active", action: "enable" }, _NOW);
		expect(badTransition).toEqual({ outcome: "denied", reason: "transition_not_allowed" });
		const staleState = await __ChangeAgentServiceState(repository, { siloId: _SILO, agentServiceId: seed.serviceId, expectedState: "paused", action: "enable" }, _NOW);
		expect(staleState.outcome).toBe("conflict");
	});

	it("clears the active revision when a service retires", async function _retire()
	{
		const repository = new _Repository();
		const seed = await _seedService(repository);
		repository.services.set(seed.serviceId, { ...repository.services.get(seed.serviceId)!, state: "active", activeRevisionId: seed.revisionId });

		const retired = await __ChangeAgentServiceState(repository, { siloId: _SILO, agentServiceId: seed.serviceId, expectedState: "active", action: "retire" }, _NOW);

		expect(retired).toEqual(expect.objectContaining({ outcome: "changed", service: expect.objectContaining({ state: "retired", activeRevisionId: null }) }));
	});

	it("compares two revisions of the same service", async function _compare()
	{
		const repository = new _Repository();
		const seed = await _seedService(repository);
		const revised = await __ReviseAgentRevision(repository, { siloId: _SILO, agentServiceId: seed.serviceId, expectedParentRevisionId: seed.revisionId, authoredBy: "admin-1", changeMessage: "edit", content: _content({ budget: { maxTurns: 50, maxTokens: 1000, maxDurationMs: 30000 } }) }, _NOW);
		if (revised.outcome !== "revised") throw new Error("expected revised");
		const compared = await __CompareAgentRevisions(repository, _SILO, seed.revisionId, revised.revision.id);
		if (compared.outcome !== "compared") throw new Error("expected compared");
		expect(compared.diff.widenings.some(widening => widening.kind === "budget")).toBe(true);
	});

	it("admits run-now only for an active managed service", async function _runNow()
	{
		const repository = new _Repository();
		const port = new _AdmissionPort();
		const seed = await _seedService(repository);
		const command: ManagedRunNowCommand = { agentServiceId: seed.serviceId, siloId: _SILO, requestedBy: "admin-1", requestIdempotencyKey: "req-1", trigger: "managed_invocation", scheduledSlot: null };
		const draftDenied = await __AdmitManagedRunNow(repository, port, command);
		expect(draftDenied).toEqual({ outcome: "denied", reason: "service_not_runnable" });
		repository.services.set(seed.serviceId, { ...repository.services.get(seed.serviceId)!, state: "active", activeRevisionId: seed.revisionId });
		const accepted = await __AdmitManagedRunNow(repository, port, command);
		expect(accepted).toEqual({ outcome: "accepted", runId: "run-1" });
		expect(port.lastCommand?.requestIdempotencyKey).toBe("req-1");
	});

	it("isolates every verb across silos — a silo-B caller cannot touch a silo-A service", async function _crossSilo()
	{
		const repository = new _Repository();
		const port = new _AdmissionPort();
		const seed = await _seedService(repository, "silo-a");
		repository.services.set(seed.serviceId, { ...repository.services.get(seed.serviceId)!, state: "active", activeRevisionId: seed.revisionId });
		const foreign = "silo-b";

		// Reads: a cross-silo revision and history must not resolve.
		expect(await __CompareAgentRevisions(repository, foreign, seed.revisionId, seed.revisionId)).toEqual({ outcome: "denied", reason: "revision_not_found" });
		expect(await repository.getService(seed.serviceId, foreign)).toBeNull();
		expect((await __ReadAgentServiceHistory(repository, seed.serviceId, foreign, 50)).revisions).toHaveLength(0);

		// Writes: revise, restore, enable/pause/retire, and run-now all fail closed as not-found.
		expect(await __ReviseAgentRevision(repository, { siloId: foreign, agentServiceId: seed.serviceId, expectedParentRevisionId: seed.revisionId, authoredBy: "attacker", changeMessage: "x", content: _content() }, _NOW)).toEqual({ outcome: "denied", reason: "service_not_found" });
		expect(await __RestoreAgentRevision(repository, { siloId: foreign, agentServiceId: seed.serviceId, sourceRevisionId: seed.revisionId, expectedParentRevisionId: seed.revisionId, authoredBy: "attacker", changeMessage: "x" }, _NOW)).toEqual({ outcome: "denied", reason: "service_not_found" });
		expect(await __ChangeAgentServiceState(repository, { siloId: foreign, agentServiceId: seed.serviceId, expectedState: "active", action: "pause" }, _NOW)).toEqual({ outcome: "denied", reason: "service_not_found" });
		expect(await __ChangeAgentServiceState(repository, { siloId: foreign, agentServiceId: seed.serviceId, expectedState: "active", action: "retire" }, _NOW)).toEqual({ outcome: "denied", reason: "service_not_found" });
		expect(await __AdmitManagedRunNow(repository, port, { agentServiceId: seed.serviceId, siloId: foreign, requestedBy: "attacker", requestIdempotencyKey: "req-x", trigger: "managed_invocation", scheduledSlot: null })).toEqual({ outcome: "denied", reason: "service_not_found" });
		expect(port.lastCommand).toBeNull();

		// Indirect path: a silo-B service restoring a silo-A source revision resolves as revision_not_found,
		// never revision_service_mismatch — no cross-silo existence oracle on the source lookup.
		const foreignSeed = await _seedService(repository, foreign);
		const restoreForeignSource = await __RestoreAgentRevision(repository, { siloId: foreign, agentServiceId: foreignSeed.serviceId, sourceRevisionId: seed.revisionId, expectedParentRevisionId: foreignSeed.revisionId, authoredBy: "attacker", changeMessage: "x" }, _NOW);
		expect(restoreForeignSource).toEqual({ outcome: "denied", reason: "revision_not_found" });

		// Same-silo access still works.
		expect((await __AdmitManagedRunNow(repository, port, { agentServiceId: seed.serviceId, siloId: "silo-a", requestedBy: "admin-1", requestIdempotencyKey: "req-ok", trigger: "managed_invocation", scheduledSlot: null })).outcome).toBe("accepted");
	});
});
