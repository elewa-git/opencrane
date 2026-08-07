import { AgentRunState, AgentRunTrigger, ChannelInvocationAction } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { PrismaChannelTargetAuthorityRepository } from "../prisma-channel-target-authority.js";

/** Builds the minimum transaction facade needed to reject a run during issuance. */
function _issueTransaction(trigger: AgentRunTrigger, state: AgentRunState): Record<string, unknown>
{
	return {
		$queryRaw: async function _queryRaw(): Promise<readonly unknown[]> { return []; },
		conversationThread: { findUnique: async function _findThread(): Promise<unknown> { return { id: "thread-1", siloId: "silo-1", agentServiceId: "service-1", state: "Active", participants: [{ userId: "user-1" }] }; } },
		agentRun: { findUnique: async function _findRun(): Promise<unknown> { return { id: "run-1", siloId: "silo-1", threadId: "thread-1", agentServiceId: "service-1", delegatedUserId: "user-1", trigger, state }; } },
	};
}

/** Builds a Prisma facade that executes the adapter transaction against a test double. */
function _prisma(transaction: Record<string, unknown>): never
{
	return { $transaction: async function _transaction<T>(operation: (client: never) => Promise<T>): Promise<T> { return operation(transaction as never); } } as never;
}

/** Canonical issuance command used by run-lifecycle rejection tests. */
function _issueCommand(): never
{
	return { digest: `sha256:${"a".repeat(64)}`, subjectId: "user-1", siloId: "silo-1", threadId: "thread-1", agentServiceId: "service-1", action: "command.forward", runId: "run-1", membershipRevision: 1, authorizationDigest: `sha256:${"b".repeat(64)}`, nowEpochMs: 1_000, expiresAtEpochMs: 2_000, allowedRouteHostSuffixes: [".svc.cluster.local"] } as never;
}

describe("PrismaChannelTargetAuthorityRepository run lifecycle", function _suite()
{
	it("rejects a non-interactive run during command-context issuance", async function _test()
	{
		const repository = new PrismaChannelTargetAuthorityRepository(_prisma(_issueTransaction(AgentRunTrigger.Schedule, AgentRunState.Accepted)));
		await expect(repository.issueInvocationContextAtomically(_issueCommand())).resolves.toEqual({ status: "run_conflict" });
	});

	it.each([AgentRunState.Cancelling, AgentRunState.Completed, AgentRunState.Failed, AgentRunState.Cancelled])("rejects closed run state %s during issuance", async function _test(state)
	{
		const repository = new PrismaChannelTargetAuthorityRepository(_prisma(_issueTransaction(AgentRunTrigger.Interactive, state)));
		await expect(repository.issueInvocationContextAtomically(_issueCommand())).resolves.toEqual({ status: "run_conflict" });
	});

	it("rejects a command context when its run begins cancelling before consumption", async function _test()
	{
		const transaction = {
			$queryRaw: async function _queryRaw(): Promise<readonly unknown[]> { return []; },
			channelInvocationContext: {
				findUnique: async function _findContext(): Promise<unknown>
				{
					return { id: "context-1", digest: `sha256:${"a".repeat(64)}`, subjectId: "user-1", siloId: "silo-1", threadId: "thread-1", agentServiceId: "service-1", action: ChannelInvocationAction.CommandForward, routeId: "route-1", runId: "run-1", authorizationDigest: `sha256:${"b".repeat(64)}`, expiresAt: new Date(2_000), consumedAt: null, revokedAt: null, route: { isCurrent: true, revokedAt: null, expiresAt: new Date(2_000) } };
				},
				update: async function _update(): Promise<never> { throw new Error("cancelling run must not consume context"); },
			},
			agentRun: { findUnique: async function _findRun(): Promise<unknown> { return { id: "run-1", siloId: "silo-1", threadId: "thread-1", agentServiceId: "service-1", delegatedUserId: "user-1", trigger: AgentRunTrigger.Interactive, state: AgentRunState.Cancelling }; } },
		};
		const repository = new PrismaChannelTargetAuthorityRepository(_prisma(transaction));
		await expect(repository.consumeInvocationContextAtomically({ digest: `sha256:${"a".repeat(64)}`, expectedRouteId: "route-1", nowEpochMs: 1_000 })).resolves.toEqual({ status: "denied", reason: "run_inactive" });
	});

	it("rejects a command context when its run is cancelled before consumption", async function _test()
	{
		const transaction = {
			$queryRaw: async function _queryRaw(): Promise<readonly unknown[]> { return []; },
			channelInvocationContext: {
				findUnique: async function _findContext(): Promise<unknown>
				{
					return { id: "context-1", digest: `sha256:${"a".repeat(64)}`, subjectId: "user-1", siloId: "silo-1", threadId: "thread-1", agentServiceId: "service-1", action: ChannelInvocationAction.CommandForward, routeId: "route-1", runId: "run-1", authorizationDigest: `sha256:${"b".repeat(64)}`, expiresAt: new Date(2_000), consumedAt: null, revokedAt: null, route: { isCurrent: true, revokedAt: null, expiresAt: new Date(2_000) } };
				},
				update: async function _update(): Promise<never> { throw new Error("cancelled run must not consume context"); },
			},
			agentRun: { findUnique: async function _findRun(): Promise<unknown> { return { id: "run-1", siloId: "silo-1", threadId: "thread-1", agentServiceId: "service-1", delegatedUserId: "user-1", trigger: AgentRunTrigger.Interactive, state: AgentRunState.Cancelled }; } },
		};
		const repository = new PrismaChannelTargetAuthorityRepository(_prisma(transaction));
		await expect(repository.consumeInvocationContextAtomically({ digest: `sha256:${"a".repeat(64)}`, expectedRouteId: "route-1", nowEpochMs: 1_000 })).resolves.toEqual({ status: "denied", reason: "run_inactive" });
	});
});
