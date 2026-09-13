import type { PrismaClient } from "@prisma/client";

import { ConversationModelToolModes } from "@opencrane/contracts";
import { PrismaConversationRunLifecycleUnitOfWork } from "@opencrane/backend/agents/execution/runs";
import { ConversationComputerTurnAuthorityService, ConversationComputerTurnWriterFactory, ConversationComputerToolResultOutcomes, KurrentConversationComputerTurnStore, PrismaConversationComputerTurnUnitOfWork, PrismaConversationModelCustodyUnitOfWork, PrismaConversationToolProposalUnitOfWork, type ConversationComputerTurnAuthorityDependencies, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { _GENERATED_OUTPUT_CIPHER, _GENERATED_OUTPUT_WORKLOAD } from "./conversation-generated-file-output.integration.sql.fixture";
import { _ToolHandoffSqlRuntime } from "./conversation-tool-handoff.sql-fixture";
import type { _SeedConversationToolProposalSqlFixture } from "./conversation-tool-proposal.sql-fixture";

/** Compose a first-turn authority that uses real Kurrent custody, selection and proposal admission. */
export function _McpModelNameAuthority(prisma: PrismaClient, history: HistoryStore, fixture: Awaited<ReturnType<typeof _SeedConversationToolProposalSqlFixture>>, requestModel: ConversationComputerTurnAuthorityDependencies["model"]["request"])
{
	const turns = new KurrentConversationComputerTurnStore(history);
	const runtime = _ToolHandoffSqlRuntime(prisma, fixture);
	const candidates = {
		async admit() {},
		async resolve() { return fixture.candidate; },
		async resolveForWorkflow() { return { candidate: fixture.candidate, workload: _GENERATED_OUTPUT_WORKLOAD }; },
		async assertCurrent() { return fixture.candidate; },
		async assertCurrentForWorkflow() { return { candidate: fixture.candidate, workload: _GENERATED_OUTPUT_WORKLOAD }; },
		async assertLeaseForWorkflow() { return _GENERATED_OUTPUT_WORKLOAD; },
	};
	const toolResults = {
		async read() { return { outcome: ConversationComputerToolResultOutcomes.Pending as const, waitFor: "result" as const }; },
		async consume() { throw new Error("MCP model-name proof cannot consume an unfinished result"); },
	};
	const dependencies: ConversationComputerTurnAuthorityDependencies = {
		siloId: fixture.siloId,
		candidates,
		credentials: { async issueOnce() { return { key: "synthetic-model-key", credentialDigest: `sha256:${"8".repeat(64)}`, expiresAt: fixture.candidate.credentialExpiresAt }; }, async reuseExact() { throw new Error("MCP model-name proof has no continuation"); }, async revoke() {} },
		endpoint: "https://model.example.test",
		model: { request: requestModel },
		modelCustody: new PrismaConversationModelCustodyUnitOfWork(prisma, _GENERATED_OUTPUT_CIPHER),
		toolResults,
		toolResultNotifications: { async publishTerminal() { throw new Error("MCP model-name proof has no terminal result"); } },
		logger: { warn() {} },
		reviewCredentials: { bearer() { throw new Error("MCP model-name proof has no approval"); }, derive() { throw new Error("MCP model-name proof has no review credential"); } },
		generatedFiles: { async link() {} },
		outputPayloads: new PrismaConversationComputerTurnUnitOfWork(prisma, history, _GENERATED_OUTPUT_CIPHER, 65_536, { async admit() { throw new Error("MCP model-name proof cannot admit another run"); } }),
		store: turns,
		writers: new ConversationComputerTurnWriterFactory(history, turns, candidates, toolResults),
		runLifecycle: new PrismaConversationRunLifecycleUnitOfWork(prisma),
		toolProposals: new PrismaConversationToolProposalUnitOfWork(prisma, fixture.dependencies, runtime.admission, async function _ApprovalExpiry() {}),
	};
	const authority = new ConversationComputerTurnAuthorityService(dependencies);
	return {
		authority,
		runtime,
		turns,
		async start(): Promise<FrozenConversationComputerTurn>
		{
			const turn = await authority.start({ computerId: fixture.turn.computerId, lease: fixture.turn.lease, causationId: fixture.turn.latestPendingEntryId, causationPosition: fixture.turn.latestPendingEntryPosition });
			if (turn === null)
				throw new Error("MCP model-name proof could not start its frozen turn");
			return turn;
		},
	};
}
