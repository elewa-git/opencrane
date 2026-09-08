import type { SelfConversationHistoryDiagnosticError } from "./self-conversation-history.types";

/** Recognizes Prisma's documented error classes across its CommonJS and ESM runtime copies. */
const _PRISMA_ERROR_TYPES = ["PrismaClientValidationError", "PrismaClientInitializationError", "PrismaClientKnownRequestError", "PrismaClientUnknownRequestError", "PrismaClientRustPanicError"] as const;

/**
 * Copies recognized diagnostic codes while leaving error text, causes, names, and metadata behind.
 * Called by: participant history/metadata routers, the private computer-turn router and the group-child creation worker.
 * Upstream exceptions can contain private messages or credentials, so logs retain only this closed shape.
 */
export function _ConversationFailureDiagnostic(error: unknown): SelfConversationHistoryDiagnosticError
{
	const type = _ErrorType(error);
	const diagnostic = { type, message: "Conversation history operation failed" };
	if (!(error instanceof Error))
		return diagnostic;
	const codeProperty = type === "PrismaClientInitializationError" ? "errorCode" : "code";
	const code: unknown = Object.getOwnPropertyDescriptor(error, codeProperty)?.value;
	if (typeof code === "number" && Number.isInteger(code) && code >= 0 && code <= 599)
		return { ...diagnostic, code };
	if (typeof code === "string" && (/^P[0-9]{4}$/.test(code) || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code)))
		return { ...diagnostic, code };
	return diagnostic;
}

/** Selects an allowlisted Prisma name or standard JavaScript class without copying arbitrary text. */
function _ErrorType(error: unknown): string
{
	if (!(error instanceof Error))
		return "unknown";
	const name: unknown = Object.getOwnPropertyDescriptor(error, "name")?.value;
	const prismaType = _PRISMA_ERROR_TYPES.find(knownType => knownType === name);
	if (prismaType !== undefined)
		return prismaType;
	if (error instanceof TypeError)
		return "TypeError";
	if (error instanceof RangeError)
		return "RangeError";
	if (error instanceof SyntaxError)
		return "SyntaxError";
	return "Error";
}
