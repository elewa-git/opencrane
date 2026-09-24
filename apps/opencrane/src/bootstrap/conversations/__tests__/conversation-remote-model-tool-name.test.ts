import { describe, expect, it, vi } from "vitest";

import { ConversationComputerTurnAuthorityService, ConversationComputerToolResultOutcomes, type ConversationComputerModelReservation, type ConversationComputerToolSelection, type ConversationComputerTurnCandidate, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { McpInvocationDispatchOutcomes, RemoteMcpInvocationExecutor } from "@opencrane/backend/server/gateways/mcp";
import { ConversationModelResponseKinds, ConversationToolProposalOutcomes, McpConnectionCredentialKinds } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _CreateConversationMcpToolDispatch } from "../../workflows/mcp-runtime-composition";

const _MODEL_NAME = "mcp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const _SOURCE_NAME = "records.find";
const _TOOL_REVISION_ID = "remote-tool-revision-1";
const _TURN_ID = "31c1f1dc-0010-4f13-9c2f-d3841ffd6651";

/** Exercise the public conversation authority with one durable in-memory turn. */
function _ModelSelectionHarness(callName: string)
{
	const parametersSchema = { type: "object", required: ["query"], additionalProperties: false, properties: { query: { type: "string" } } };
	const compiledInput = {
		promptCompilerVersion: "test-v1",
		runId: "run-1",
		attempt: 1,
		instructions: "Find one record",
		messages: [],
		tools: [{ name: _SOURCE_NAME, modelName: _MODEL_NAME, toolRevisionId: _TOOL_REVISION_ID, description: "Find one record", requiresApproval: false, parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) }],
		model: { modelAlias: "test-model", maxOutputTokens: 100, generatedOutputCapabilities: [] },
		budget: { maxCompletionTokens: 100, maxModelTurns: 2, maxToolInvocations: 1, maxCostUsdMicros: null, wallClockDeadlineEpochMs: Date.now() + 60_000 },
		digest: `sha256:${"b".repeat(64)}`,
	};
	const candidate = {
		binding: { siloId: "silo-1", conversationId: "conversation-1", computerId: "computer-1", leaseGeneration: 1, agentIdentityId: "identity-1", agentServiceId: "service-1", agentName: "Ada", agentAvatarArtifactRevisionId: null, runId: compiledInput.runId, expectedRevision: 1n, maximumEntryBytes: 65_536 },
		lease: { leaseId: "lease-1", leaseGeneration: 1, sandboxClaimId: "computer-1-g1" },
		latestPendingEntryId: "message-1",
		latestPendingEntryPosition: "1",
		modelAlias: compiledInput.model.modelAlias,
		maximumBudgetUsd: 1,
		credentialLifetimeSeconds: 60,
		credentialExpiresAt: "2099-01-01T00:00:00.000Z",
		compiledInput,
	} as ConversationComputerTurnCandidate;
	let turn: FrozenConversationComputerTurn = {
		bootstrapId: _TURN_ID, siloId: "silo-1", computerId: "computer-1", lease: candidate.lease, binding: candidate.binding,
		latestPendingEntryId: candidate.latestPendingEntryId, latestPendingEntryPosition: candidate.latestPendingEntryPosition,
		modelAlias: candidate.modelAlias, maximumBudgetUsd: candidate.maximumBudgetUsd, credentialLifetimeSeconds: candidate.credentialLifetimeSeconds,
		compile: { runId: compiledInput.runId, attempt: compiledInput.attempt, promptCompilerVersion: compiledInput.promptCompilerVersion, digest: compiledInput.digest },
		outputSourceCommandId: null, outputReceipt: null, cancellationReceipt: null, toolSelection: null, continuationReservation: null, modelReservation: null,
	};
	const store = {
		load: vi.fn(async function _Load() { return turn; }),
		reserveModel: vi.fn(async function _Reserve(_turnId: string, reservation: ConversationComputerModelReservation) { turn = { ...turn, modelReservation: reservation }; return true; }),
		selectTool: vi.fn(async function _Select(_turnId: string, selection: ConversationComputerToolSelection) { turn = { ...turn, toolSelection: selection }; }),
	};
	const proposals = { admit: vi.fn(async function _Admit(selected: FrozenConversationComputerTurn)
	{
		if (selected.toolSelection === null)
			throw new Error("The tool must be selected before admission");
		return { proposalId: selected.toolSelection.proposalId, outcome: ConversationToolProposalOutcomes.Existing };
	}) };
	const logger = { warn: vi.fn() };
	const model = { request: vi.fn().mockResolvedValue({ kind: ConversationModelResponseKinds.Tool, call: { id: "model-call-1", name: callName, arguments: JSON.stringify({ query: "private-query" }), content: null } }) };
	const modelCustody = { storeDeclaration: vi.fn().mockResolvedValue({ payloadRef: "payload-1", ciphertextDigest: `sha256:${"d".repeat(64)}` }) };
	const toolResults = { read: vi.fn().mockResolvedValue({ outcome: ConversationComputerToolResultOutcomes.Pending, waitFor: "result" }) };
	const toolRequestedNotifications = { publishRequested: vi.fn().mockResolvedValue("published") };
	const authority = new ConversationComputerTurnAuthorityService({
		siloId: "silo-1",
		logger,
		store,
		candidates: { assertCurrentForWorkflow: vi.fn().mockResolvedValue({ candidate, workload: { namespace: "computers", serviceAccountName: "computer", podUid: "pod-1" } }) },
		credentials: { issueOnce: vi.fn().mockResolvedValue({ key: "test-key", credentialDigest: `sha256:${"c".repeat(64)}`, expiresAt: candidate.credentialExpiresAt }) },
		model,
		modelCustody,
		toolProposals: proposals,
		toolResults,
		toolRequestedNotifications,
		endpoint: "https://model.example.test",
	} as never);
	return { authority, candidate, logger, model, modelCustody, proposals, store, toolResults, toolRequestedNotifications, step: _TURN_ID };
}

/** Build the server-mediated remote ports from the exact revision selected by the model flow. */
function _RemotePorts(selectedRevision: () => string | undefined, toolInvocationId: string)
{
	const client = { callTool: vi.fn().mockResolvedValue({ isError: false, content: [{ type: "text", text: "found" }] }) };
	const authority = {
		claim: vi.fn(async function _Claim(command: { readonly target: { readonly toolInvocationId: string }; readonly workload?: unknown })
		{
			if (command.workload === undefined)
				return { outcome: "identity_required" };
			if (command.target.toolInvocationId !== toolInvocationId || selectedRevision() !== _TOOL_REVISION_ID)
				return { outcome: "unavailable" };
			return {
				outcome: "claimed",
				claim: {
					executionId: "execution-1",
					notAfterEpochMs: new Date("2099-01-01T00:00:00.000Z").getTime(),
					remainingClaimMilliseconds: 45_000,
					remoteClaimFence: "remote-fence-1",
					toolInvocationClaim: { invocationId: "invocation-row-1", kind: "dispatch", fence: 1, revision: 2 },
					binding: { siloId: "silo-1", connectionId: "connection-1", connectionGeneration: 1, connectionOwnerPrincipalId: "principal-1", endpointDigest: `sha256:${"a".repeat(64)}`, serverRevisionId: "server-revision-1", mcpServerId: "server-1", toolRevisionId: _TOOL_REVISION_ID, protocolVersion: "2026-07-28", credentialSecretUid: null, credentialSecretResourceVersion: null },
					endpoint: "https://mcp.example.test/rpc",
					toolName: _SOURCE_NAME,
					arguments: { query: "private-query" },
					inputSchema: { type: "object" },
				},
			};
		}),
		completeSucceeded: vi.fn().mockResolvedValue(true),
		completeFailed: vi.fn().mockResolvedValue(true),
		completeAmbiguous: vi.fn().mockResolvedValue(true),
		settleExhausted: vi.fn().mockResolvedValue(true),
	};
	const executor = new RemoteMcpInvocationExecutor({
		authority,
		serverIdentity: { read: vi.fn().mockResolvedValue({ podUid: "server-pod-1" }) },
		credentials: { readExact: vi.fn().mockResolvedValue({ outcome: "ready", credential: { kind: McpConnectionCredentialKinds.None } }) },
		client,
		timeoutMilliseconds: 5_000,
	} as never);
	return { authority, client, dispatch: _CreateConversationMcpToolDispatch(executor) };
}

describe("conversation remote MCP model-name bridge", function _Suite()
{
	it("sends the original dotted MCP name from the exact revision selected by an opaque model name", async function _DispatchesSourceName()
	{
		const fixture = _ModelSelectionHarness(_MODEL_NAME);

		const progress = await fixture.authority.advance(fixture.step);
		if (progress.outcome !== "tool_pending")
			throw new Error(`Expected the model-selected remote invocation: ${JSON.stringify({ warning: fixture.logger.warn.mock.calls, model: fixture.model.request.mock.calls.length, custody: fixture.modelCustody.storeDeclaration.mock.calls.length, selected: fixture.store.selectTool.mock.calls.length, proposals: fixture.proposals.admit.mock.calls.length, results: fixture.toolResults.read.mock.calls.length })}`);
		const proposalCall = fixture.proposals.admit.mock.calls[0] as unknown as [unknown, unknown, { readonly toolRevisionId: string }] | undefined;
		const proposal = proposalCall?.[2];
		const remote = _RemotePorts(function _SelectedRevision() { return proposal?.toolRevisionId; }, progress.toolInvocationId);

		await expect(remote.dispatch.tryExecute({ siloId: fixture.candidate.binding.siloId, runId: fixture.candidate.compiledInput.runId, attempt: fixture.candidate.compiledInput.attempt, toolInvocationId: progress.toolInvocationId })).resolves.toBe(true);

		expect(proposal?.toolRevisionId).toBe(_TOOL_REVISION_ID);
		expect(fixture.toolRequestedNotifications.publishRequested).toHaveBeenCalledExactlyOnceWith({ bootstrapId: _TURN_ID, siloId: "silo-1", conversationId: "conversation-1", runId: "run-1", attempt: 1, toolInvocationId: progress.toolInvocationId });
		expect(remote.client.callTool).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ toolName: _SOURCE_NAME, arguments: { query: "private-query" } }));
		expect(remote.client.callTool).not.toHaveBeenCalledWith(expect.objectContaining({ toolName: _MODEL_NAME }));
	});

	it.each([_SOURCE_NAME, "mcp_wrong_alias"])('refuses model call name "%s" before remote dispatch', async function _RejectsUnavailableAlias(callName)
	{
		const fixture = _ModelSelectionHarness(callName);
		const remote = _RemotePorts(function _NoRevision() { return undefined; }, "never-selected");

		const progress = await fixture.authority.advance(fixture.step);
		if (progress.outcome === "tool_pending")
			await remote.dispatch.tryExecute({ siloId: fixture.candidate.binding.siloId, runId: fixture.candidate.compiledInput.runId, attempt: fixture.candidate.compiledInput.attempt, toolInvocationId: progress.toolInvocationId });

		expect(fixture.proposals.admit).not.toHaveBeenCalled();
		expect(remote.authority.claim).not.toHaveBeenCalled();
		expect(remote.client.callTool).not.toHaveBeenCalled();
	});
});
