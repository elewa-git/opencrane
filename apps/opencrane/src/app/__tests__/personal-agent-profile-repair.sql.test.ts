import { randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Logger } from "@opencrane/backend/observability";
import { _CreateUserOnboardingComposition } from "../user-onboarding-composition";
import { PrismaAgentSessionCreationUnitOfWork } from "@opencrane/backend/server/conversations";
import type { HistoryAppend, HistoryAtomicAppend, HistoryRecordedEvent, HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _SeedPersonalAgentProfileRepairSqlFixture, type PersonalAgentProfileRepairSqlFixture } from "./personal-agent-profile-repair.sql-fixture";

/** Independent connections expose committed rows and Serializable retry behavior. */
const _First = new PrismaClient();
/** The competing process never shares transaction state with the repair owner. */
const _Second = new PrismaClient();

/** Mount the public app composition that owns the onboarding transaction and cross-domain adapter. */
function _App(client: PrismaClient, fixture: PersonalAgentProfileRepairSqlFixture, configuredProfiles: readonly string[] = [fixture.targetWorkloadProfile])
{
	const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
	const composition = _CreateUserOnboardingComposition(client, logger, function _Owner() { return { siloId: fixture.siloId, subjectId: fixture.principalId }; }, fixture.targetWorkloadProfile, configuredProfiles);
	const app = express();
	app.use("/api/v1/me/onboarding", composition.router);
	return app;
}

/** Keep enough immutable history behavior to prove whether session creation crossed its append edge. */
function _History()
{
	const streams = new Map<string, HistoryRecordedEvent[]>();
	const append = vi.fn(async function _Append(command: HistoryAppend)
	{
		const events = _AppendEvents(streams, command);
		return { streamName: command.streamName, revision: BigInt(events.length - 1) };
	});
	const appendAtomic = vi.fn(async function _AppendAtomic(command: HistoryAtomicAppend)
	{
		for (const expected of command.expectedHeads)
		{
			const current = streams.get(expected.streamName)?.length ?? 0;
			if (current !== 0)
				throw new Error("Profile repair history fixture received a stale creation append");
		}
		return command.appends.map(function _Commit(item)
		{
			const events = _AppendEvents(streams, item);
			return { streamName: item.streamName, revision: BigInt(events.length - 1) };
		});
	});
	const store: Pick<HistoryStore, "append" | "appendAtomic" | "readHead" | "readStream"> = {
		append,
		appendAtomic,
		async readHead(streamName) { return { streamName, revision: streams.has(streamName) ? BigInt(streams.get(streamName)!.length - 1) : null }; },
		async *readStream(request) { for (const event of streams.get(request.streamName) ?? []) yield event; },
	};
	return { store, append, appendAtomic };
}

/** Store one append in the in-memory provider while retaining the real event envelope. */
function _AppendEvents(streams: Map<string, HistoryRecordedEvent[]>, command: HistoryAppend): HistoryRecordedEvent[]
{
	const current = streams.get(command.streamName) ?? [];
	const committed = command.events.map(function _Recorded(event, index): HistoryRecordedEvent
	{
		return { ...event, streamName: command.streamName, revision: BigInt(current.length + index), recordedAt: new Date() };
	});
	const events = [...current, ...committed];
	streams.set(command.streamName, events);
	return events;
}

/** Read the exact service fields that a repair must preserve. */
function _ServiceIdentity(client: PrismaClient, serviceId: string)
{
	return client.agentService.findUniqueOrThrow({ where: { id: serviceId }, select: { id: true, siloId: true, kind: true, name: true, state: true, activeRevisionId: true, principalId: true } });
}

describe("unused personal-agent workload-profile repair on fresh PostgreSQL", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("The personal-agent profile repair SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Second.$connect()]);
	});
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it("repairs one unused deterministic service before the first session append", async function _RepairAndCreateSession()
	{
		const fixture = await _SeedPersonalAgentProfileRepairSqlFixture();
		const caller = { siloId: fixture.siloId, subjectId: fixture.principalId, principalId: fixture.principalId };
		const beforeService = await _ServiceIdentity(_Second, fixture.agentServiceId);
		const beforeRevision = await _Second.agentRevision.findUniqueOrThrow({ where: { id: fixture.agentRevisionId } });
		const beforePersona = await _Second.personaProfile.findUniqueOrThrow({ where: { id: fixture.personaProfileId } });
		expect(await _Second.conversation.count({ where: { agentServiceId: fixture.agentServiceId } })).toBe(0);
		expect(await _Second.agentRun.count({ where: { agentServiceId: fixture.agentServiceId } })).toBe(0);

		const history = _History();
		const sessions = new PrismaAgentSessionCreationUnitOfWork(_First, history.store, [{ workloadProfile: fixture.targetWorkloadProfile, profileRevisionId: `sha256:${"d".repeat(64)}` }]);
		const sessionKey = randomUUID();
		await expect(sessions.resolve(caller, fixture.agentServiceId, sessionKey)).resolves.toBeNull();
		expect(history.append).not.toHaveBeenCalled();
		expect(history.appendAtomic).not.toHaveBeenCalled();

		const readiness = await request(_App(_First, fixture)).get("/api/v1/me/onboarding");
		expect(readiness.status, JSON.stringify(readiness.body)).toBe(200);
		expect(readiness.body).toMatchObject({ state: "completed" });
		const repaired = await _Second.agentService.findUniqueOrThrow({ where: { id: fixture.agentServiceId } });
		expect(repaired.workloadProfile).toBe(fixture.targetWorkloadProfile);
		expect(await _ServiceIdentity(_Second, fixture.agentServiceId)).toEqual(beforeService);
		expect(await _Second.agentRevision.findUniqueOrThrow({ where: { id: fixture.agentRevisionId } })).toEqual(beforeRevision);
		expect(await _Second.personaProfile.findUniqueOrThrow({ where: { id: fixture.personaProfileId } })).toEqual(beforePersona);
		expect(await _Second.agentRevision.count({ where: { agentServiceId: fixture.agentServiceId } })).toBe(1);

		const audit = await _Second.auditDecision.findFirstOrThrow({ where: { siloId: fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.AgentService, resourceId: fixture.agentServiceId, action: ProductAuthorizationActions.Edit } });
		expect(audit).toMatchObject({ actorKind: "User", actorId: fixture.principalId, outcome: "Allow", reasonCode: "winning_allow" });
		expect(audit.argumentsDigest).toBe(___DigestCanonicalJson({ onboardingId: fixture.onboardingId, readinessKind: "repair", agentServiceId: fixture.agentServiceId, agentRevisionId: fixture.agentRevisionId, sourceWorkloadProfile: fixture.sourceWorkloadProfile, targetWorkloadProfile: fixture.targetWorkloadProfile }));

		await expect(sessions.resolve(caller, fixture.agentServiceId, sessionKey)).resolves.toMatch(/^[0-9a-f-]{36}$/u);
		expect(history.append).toHaveBeenCalledTimes(1);
		expect(history.appendAtomic).toHaveBeenCalledTimes(1);
		const created = await _Second.conversation.findFirstOrThrow({ where: { siloId: fixture.siloId, agentServiceId: fixture.agentServiceId } });
		expect(created.computerProfileRevisionId).toBe(`sha256:${"d".repeat(64)}`);
	});

	it("keeps an old profile that remains configured", async function _ConfiguredOldProfile()
	{
		const fixture = await _SeedPersonalAgentProfileRepairSqlFixture();
		await request(_App(_First, fixture, [fixture.targetWorkloadProfile, fixture.sourceWorkloadProfile])).get("/api/v1/me/onboarding").expect(503);
		expect((await _Second.agentService.findUniqueOrThrow({ where: { id: fixture.agentServiceId } })).workloadProfile).toBe(fixture.sourceWorkloadProfile);
		expect(await _Second.auditDecision.count({ where: { siloId: fixture.siloId } })).toBe(0);
	});

	it("rolls the central denial decision back without changing the service", async function _DeniedRepair()
	{
		const fixture = await _SeedPersonalAgentProfileRepairSqlFixture({ agentServiceEditEffect: "deny" });
		const beforeService = await _ServiceIdentity(_Second, fixture.agentServiceId);
		await request(_App(_First, fixture)).get("/api/v1/me/onboarding").expect(503);
		expect(await _ServiceIdentity(_Second, fixture.agentServiceId)).toEqual(beforeService);
		expect((await _Second.agentService.findUniqueOrThrow({ where: { id: fixture.agentServiceId } })).workloadProfile).toBe(fixture.sourceWorkloadProfile);
		expect(await _Second.auditDecision.count({ where: { siloId: fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.AgentService, resourceId: fixture.agentServiceId, action: ProductAuthorizationActions.Edit } })).toBe(0);
	});

	it("rolls back authorization and the profile update when the final CAS reports no winner", async function _LostComparison()
	{
		const fixture = await _SeedPersonalAgentProfileRepairSqlFixture();
		let intercepted = 0;
		const client = _First.$extends({ query: { agentService: { async updateMany({ args, query })
		{
			if (args.data.workloadProfile === fixture.targetWorkloadProfile)
			{
				const changed = await query(args);
				intercepted += changed.count;
				return { count: 0 };
			}
			return query(args);
		} } } }) as unknown as PrismaClient;
		await request(_App(client, fixture)).get("/api/v1/me/onboarding").expect(503);
		expect(intercepted).toBe(3);
		expect((await _Second.agentService.findUniqueOrThrow({ where: { id: fixture.agentServiceId } })).workloadProfile).toBe(fixture.sourceWorkloadProfile);
		expect(await _Second.auditDecision.count({ where: { siloId: fixture.siloId } })).toBe(0);
	});

	it("retries a serialization conflict and then refuses the concurrently used service", async function _ConcurrentUse()
	{
		const fixture = await _SeedPersonalAgentProfileRepairSqlFixture();
		let repairReads = 0;
		let releaseRead!: () => void;
		let releaseReference!: () => void;
		const readObserved = new Promise<void>(resolve => { releaseRead = resolve; });
		const referenceCommitted = new Promise<void>(resolve => { releaseReference = resolve; });
		const client = _First.$extends({ query: { agentService: { async findFirst({ args, query })
		{
			const service = await query(args);
			if (args.where !== undefined && "conversations" in args.where)
			{
				repairReads += 1;
				if (repairReads === 1)
				{
					releaseRead();
					await referenceCommitted;
				}
			}
			return service;
		} } } }) as unknown as PrismaClient;
		const repair = request(_App(client, fixture)).get("/api/v1/me/onboarding").then(function _Response(response) { return response; });
		await readObserved;
		const history = _History();
		const sessions = new PrismaAgentSessionCreationUnitOfWork(_Second, history.store, [{ workloadProfile: fixture.sourceWorkloadProfile, profileRevisionId: `sha256:${"e".repeat(64)}` }]);
		await expect(sessions.resolve({ siloId: fixture.siloId, subjectId: fixture.principalId, principalId: fixture.principalId }, fixture.agentServiceId, randomUUID())).resolves.toMatch(/^[0-9a-f-]{36}$/u);
		releaseReference();
		expect((await repair).status).toBe(503);
		expect(repairReads).toBeGreaterThanOrEqual(2);
		expect((await _Second.agentService.findUniqueOrThrow({ where: { id: fixture.agentServiceId } })).workloadProfile).toBe(fixture.sourceWorkloadProfile);
		expect(await _Second.conversation.count({ where: { agentServiceId: fixture.agentServiceId } })).toBe(1);
		expect(await _Second.auditDecision.count({ where: { siloId: fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.AgentService, resourceId: fixture.agentServiceId, action: ProductAuthorizationActions.Edit } })).toBe(0);
	});
});
