import type { PrismaClient } from "@prisma/client";

import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";

import type { CompiledConversationCreation, ConversationCreationCompiler } from "../conversation-creation-compiler.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import type { CreateConversationRequest } from "../types/conversation-request.types";
import { PrismaConversationCreationCompilerRepository } from "./prisma-conversation-creation-compiler-repository";

/** Opens the short serializable authority snapshot that resolves one browser create request. */
export class PrismaConversationCreationCompilerUnitOfWork implements ConversationCreationCompiler
{
	/** Holds the root client used only to open the reviewed transaction envelope. */
	public constructor(private readonly prisma: PrismaClient) {}

	/** @inheritdoc */
	public compile(caller: ConversationCaller, request: CreateConversationRequest): Promise<CompiledConversationCreation | null>
	{
		return ___RunInPrismaUnitOfWork(this.prisma, async function _Compile(transaction): Promise<CompiledConversationCreation | null>
		{
			const repository = new PrismaConversationCreationCompilerRepository(transaction);
			return repository.compile(caller, request);
		}, { isolationLevel: "Serializable", attemptLimit: 3, operation: "conversation creation compile" });
	}
}
