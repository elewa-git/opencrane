import type { PrismaClient } from "@prisma/client";

import { PrismaConversationToolDispatchAuthority, type ConversationComputerTurnStore, type ConversationGeneratedFileOutputLinker, type ConversationGeneratedFileResultRepositoryFactory, type ConversationToolDispatchDependencies, type FrozenConversationComputerTurn } from "@opencrane/backend/server/conversations";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { PrismaConversationGeneratedFileOutputRepository } from "./prisma-conversation-generated-file-output-repository";

/** Opens one serializable transaction around the saved-turn and generated-file link decision. */
export class PrismaConversationGeneratedFileOutputLinkUnitOfWork implements ConversationGeneratedFileOutputLinker
{
	/** Bind the real turn store and current result owners without accepting caller coordinates. */
	constructor(
		private readonly prisma: PrismaClient,
		private readonly turns: Pick<ConversationComputerTurnStore, "load">,
		private readonly generatedResults: ConversationGeneratedFileResultRepositoryFactory,
		private readonly dispatchDependencies: ConversationToolDispatchDependencies,
	) {}

	/** Reload the saved turn on every transaction retry before delegating direct persistence. */
	link(turn: FrozenConversationComputerTurn): Promise<void>
	{
		const expected = structuredClone(turn);
		const { turns, generatedResults, dispatchDependencies } = this;
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Link(transaction)
		{
			const stored = await turns.load(expected.bootstrapId);
			if (stored === null || ___DigestCanonicalJson(_TurnJson(expected)) !== ___DigestCanonicalJson(_TurnJson(stored)))
				throw new Error("Generated file output does not match the saved turn");
			const dispatch = new PrismaConversationToolDispatchAuthority(transaction, dispatchDependencies);
			const repository = new PrismaConversationGeneratedFileOutputRepository(transaction, generatedResults(transaction), dispatch);
			await repository.link(stored);
		}, { isolationLevel: "Serializable", operation: "link generated file output", attemptLimit: 3, timeout: 10_000 });
	}
}

/** Convert the one bigint coordinate before canonical JSON comparison. */
function _TurnJson(turn: FrozenConversationComputerTurn): JsonValue
{
	return { ...turn, binding: { ...turn.binding, expectedRevision: turn.binding.expectedRevision.toString() } } as unknown as JsonValue;
}
