import type { ConversationComputerRunAdmissionCommand } from "@opencrane/backend/server/conversations";
import type { __CreatePrismaSessionAssemblyAuthorities } from "@opencrane/backend/agents/execution/inputs";
import type { PrismaPromptCompilerRepository } from "@opencrane/backend/agents/execution/inputs";
import type { CompiledRunInput, RunInputSnapshot } from "@opencrane/contracts";

/** Exact execution-subject source created only after the computer path has supplied its verified lease coordinates. */
export interface ConversationRunExecutionSubjectAuthorityFactory
{
	/** Bind one authority to the server-resolved computer, lease, identity, and requester evidence. */
	create(command: ConversationComputerRunAdmissionCommand): Parameters<typeof __CreatePrismaSessionAssemblyAuthorities>[1];
}

/** Canonical Kurrent history reader bound to the conversation evidence supplied by computer admission. */
export interface ConversationRunHistoryAdmissionReaderFactory
{
	/** Create a reader that verifies the command's exact stream revision and ordered message identifiers. */
	create(command: ConversationComputerRunAdmissionCommand): Parameters<typeof __CreatePrismaSessionAssemblyAuthorities>[2];
}

/** Compiled-input readers bound to the same canonical Kurrent conversation selected for admission. */
export interface ConversationRunInputCompilerRepositoryFactory
{
	/** Create readers that dereference only the immutable records named by the admitted snapshot. */
	create(command: ConversationComputerRunAdmissionCommand, transaction: ConstructorParameters<typeof PrismaPromptCompilerRepository>[0]): PrismaPromptCompilerRepository;
	/** Compile a previously admitted idempotent snapshot in its own immutable read transaction. */
	compile(command: ConversationComputerRunAdmissionCommand, snapshot: RunInputSnapshot): Promise<CompiledRunInput>;
}

/** Concrete personal authorities shared by application run-admission composition. */
export interface PersonalConversationRunAuthorities
{
	/** Creates the execution subject bound to one verified computer command. */
	readonly executionSubjects: ConversationRunExecutionSubjectAuthorityFactory;
	/** Creates the exact Kurrent history reader used by snapshot assembly. */
	readonly histories: ConversationRunHistoryAdmissionReaderFactory;
}
