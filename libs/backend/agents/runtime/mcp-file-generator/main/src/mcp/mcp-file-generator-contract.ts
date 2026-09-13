/** Metadata URI carried by the resource; consumers never fetch it or use it as a path. */
export const MCP_FILE_GENERATOR_RESOURCE_URI = "urn:opencrane:generated-file:csv";
/** Loopback host used by the existing OCI MCP companion. */
export const MCP_FILE_GENERATOR_HOST = "127.0.0.1";
/** Loopback port used by the existing OCI MCP companion. */
export const MCP_FILE_GENERATOR_PORT = 3000;
/** Caps a complete incoming HTTP body before JSON parsing. */
export const MCP_FILE_GENERATOR_MAX_REQUEST_BYTES = 1_048_576;
