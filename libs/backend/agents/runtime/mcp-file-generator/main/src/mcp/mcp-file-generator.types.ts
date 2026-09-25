import type { JsonValue } from "@opencrane/util";

/** Stable error messages returned without echoing rejected arguments or generated content. */
export enum McpFileGeneratorErrorCodes
{
	/** The request body was not valid JSON. */
	ParseError = "parse_error",
	/** The JSON-RPC envelope or protocol metadata was invalid. */
	InvalidRequest = "invalid_request",
	/** The request selected a method this server does not implement. */
	MethodNotFound = "method_not_found",
	/** Tool arguments did not satisfy the published CSV contract. */
	InvalidArguments = "invalid_arguments",
	/** Valid arguments rendered more bytes than this server permits. */
	GeneratedOutputTooLarge = "generated_output_too_large",
	/** The server failed without exposing exception or content details. */
	InternalError = "internal_error",
}

/** Result returned by the pure MCP protocol handler to its HTTP adapter. */
export interface McpFileGeneratorProtocolResponse
{
	/** HTTP status for the response body. JSON-RPC method errors still use 200. */
	readonly statusCode: number;
	/** Strict JSON-RPC response ready for serialization. */
	readonly body: JsonValue;
}
