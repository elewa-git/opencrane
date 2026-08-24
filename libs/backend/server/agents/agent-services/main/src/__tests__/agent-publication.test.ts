import { AgentServiceKinds, __DigestAgentRevisionContent, type AgentRevision, type AgentRevisionId, type AgentService, type AgentServiceId } from "@opencrane/models/agents";
import { describe, expect, it } from "vitest";

import { __PublishAgentRevision } from "../agent-publication";
import type { AgentServicePublicationRepository, AtomicAgentRevisionPublication, AtomicAgentRevisionPublicationResult } from "../agent-publication.types";

/** Creates a stable personal AgentService fixture. */
function _service(): AgentService
{
	return {
		id: "service-1",
		siloId: "silo-1",
		kind: AgentServiceKinds.Personal,
		name: "Personal agent",
		state: "draft",
		activeRevisionId: null,
		workloadProfile: "personal-default",
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:00:00.000Z",
	};
}

/** Creates one valid immutable draft revision fixture. */
function _revision(): AgentRevision
{
	const revision: AgentRevision = {
		id: "revision-1",
		agentServiceId: "service-1",
		revision: 1,
		parentRevisionId: null,
		sourceRevisionId: null,
		changeMessage: "initial",
		state: "draft",
		digest: "sha256:pending",
		promptPolicyVersion: "prompt-v1",
		personaRevisionId: "persona-1",
		modelDefinitionId: "model-definition-1",
		skills: [],
		integrationAssignments: [],
		boundaryAttachments: [],
		budget: { maxTurns: 10, maxTokens: 10000, maxDurationMs: 60000 },
		authoredBy: "user-1",
		createdAt: "2026-07-18T00:00:00.000Z",
		publishedAt: null,
	};
	return { ...revision, digest: __DigestAgentRevisionContent(revision.agentServiceId, revision.revision, revision) };
}

/** In-memory compare-and-swap repository used to exercise concurrent publication. */
class _PublicationRepository implements AgentServicePublicationRepository
{
	/** Mutable service authority state for the test adapter. */
	private service: AgentService = _service();
	/** Immutable revision records keyed by identifier. */
	private readonly revisions = new Map<AgentRevisionId, AgentRevision>([["revision-1", _revision()]]);
	/** Revision ids whose parent service lives in another silo (never resolve for this caller). */
	private readonly foreignRevisionIds = new Set<AgentRevisionId>();
	/** Number of revision reads performed after loading service authority. */
	revisionReadCount = 0;
	/** Number of atomic publication calls received. */
	publicationCallCount = 0;
	/** Whether to simulate retirement after the domain read and before the atomic compare-and-swap. */
	retireBeforeNextPublication = false;

	/** Replaces current service state for lifecycle and race tests. */
	setService(service: AgentService): void
	{
		this.service = service;
	}

	/** Registers a revision whose parent service is in another silo, so it never resolves here. */
	addForeignSiloRevision(revision: AgentRevision): void
	{
		this.revisions.set(revision.id, revision);
		this.foreignRevisionIds.add(revision.id);
	}

	/** Loads the one service fixture when it is in the caller's silo. */
	async getService(_agentServiceId: AgentServiceId, siloId: string): Promise<AgentService | null>
	{
		return this.service.siloId === siloId ? this.service : null;
	}

	/** Loads an immutable revision fixture when its parent service is in the caller's silo. */
	async getRevision(agentRevisionId: AgentRevisionId, siloId: string): Promise<AgentRevision | null>
	{
		this.revisionReadCount += 1;
		if (this.foreignRevisionIds.has(agentRevisionId)) return null;
		const revision = this.revisions.get(agentRevisionId) ?? null;
		return revision !== null && this.service.siloId === siloId ? revision : null;
	}

	/** Atomically publishes only the first command observing the current active pointer. */
	async publishRevisionAtomically(publication: AtomicAgentRevisionPublication): Promise<AtomicAgentRevisionPublicationResult>
	{
		this.publicationCallCount += 1;
		if (this.retireBeforeNextPublication)
		{
			this.retireBeforeNextPublication = false;
			this.service = { ...this.service, state: "retired", updatedAt: "2026-07-18T00:30:00.000Z" };
		}
		if (this.service.state !== publication.expectedServiceState || this.service.activeRevisionId !== publication.expectedActiveRevisionId)
		{
			return { status: "conflict", currentActiveRevisionId: this.service.activeRevisionId };
		}
		const source = this.revisions.get(publication.agentRevisionId);
		if (source === undefined || source.state !== "draft")
		{
			return { status: "conflict", currentActiveRevisionId: this.service.activeRevisionId };
		}
		const revision: AgentRevision = { ...source, state: "published", publishedAt: publication.publishedAt };
		this.revisions.set(revision.id, revision);
		this.service = { ...this.service, state: "active", activeRevisionId: revision.id, updatedAt: publication.publishedAt };
		return { status: "published", service: this.service, revision };
	}
}

describe("agent revision publication", function _suite()
{
	it("allows exactly one concurrent publisher to change the active immutable revision", async function _concurrentPublication()
	{
		const repository = new _PublicationRepository();
		const command = { siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" } as const;

		const results = await Promise.all([
			__PublishAgentRevision(repository, command),
			__PublishAgentRevision(repository, command),
		]);

		expect(results.filter(result => result.outcome === "published")).toHaveLength(1);
		expect(results.filter(result => result.outcome === "denied")).toHaveLength(1);
	});

	it("rejects a revision owned by another service before repository publication", async function _wrongService()
	{
		const repository = new _PublicationRepository();
		const foreign = { ..._revision(), agentServiceId: "service-other" };
		const getRevision = repository.getRevision.bind(repository);
		repository.getRevision = async function _getForeign(): Promise<AgentRevision> { return foreign; };

		const result = await __PublishAgentRevision(repository, { siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: "revision_service_mismatch" });
		repository.getRevision = getRevision;
	});

	it("denies a retired service before loading a revision or invoking atomic publication", async function _retiredService()
	{
		const repository = new _PublicationRepository();
		repository.setService({ ..._service(), state: "retired" });

		const result = await __PublishAgentRevision(repository, { siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: "service_retired" });
		expect(repository.revisionReadCount).toBe(0);
		expect(repository.publicationCallCount).toBe(0);
	});

	it("conflicts when retirement races publication after the service read", async function _retirementRace()
	{
		const repository = new _PublicationRepository();
		repository.retireBeforeNextPublication = true;

		const result = await __PublishAgentRevision(repository, { siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-1", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: "publication_conflict", currentActiveRevisionId: null });
		expect(repository.publicationCallCount).toBe(1);
	});

	it("denies publish for a service in another silo as not-found, never a distinct oracle", async function _crossSiloService()
	{
		const repository = new _PublicationRepository();

		const result = await __PublishAgentRevision(repository, { siloId: "silo-other", agentServiceId: "service-1", agentRevisionId: "revision-1", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: "service_not_found" });
		expect(repository.revisionReadCount).toBe(0);
		expect(repository.publicationCallCount).toBe(0);
	});

	it("denies publishing a foreign-silo revision as revision_not_found, never revision_service_mismatch", async function _crossSiloRevision()
	{
		const repository = new _PublicationRepository();
		// The caller's own service is in silo-1; the target revision belongs to another silo's service.
		repository.addForeignSiloRevision({ ..._revision(), id: "revision-foreign", agentServiceId: "service-foreign" });

		const result = await __PublishAgentRevision(repository, { siloId: "silo-1", agentServiceId: "service-1", agentRevisionId: "revision-foreign", expectedActiveRevisionId: null, publishedAt: "2026-07-18T01:00:00.000Z" });

		expect(result).toEqual({ outcome: "denied", reason: "revision_not_found" });
		expect(repository.publicationCallCount).toBe(0);
	});
});
