// Common response helpers
function notFound(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function badRequest(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function ok(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

function created(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

/** OpenAPI path fragments owned by the mcp domain (composed into the opencrane-ui spec). */
export const _McpOpenapiPaths = {
  "/mcp/catalog": {
    get: {
      operationId: "listMcpCatalog",
      summary: "List the published MCP servers the calling user is entitled to",
      tags: ["MCP Operator"],
      responses: {
        200: ok("Entitlement-scoped catalogue.", { type: "array", items: { $ref: "#/components/schemas/McpCatalogServer" } }),
      },
    },
  },

  "/mcp/installed": {
    get: {
      operationId: "listMcpInstalled",
      summary: "List the servers the calling user has installed",
      tags: ["MCP Operator"],
      responses: {
        200: ok("Install list.", { type: "array", items: { $ref: "#/components/schemas/McpInstalled" } }),
      },
    },
    post: {
      operationId: "installMcpServer",
      summary: "Install a catalogue server for the calling user",
      tags: ["MCP Operator"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["serverId"], properties: { serverId: { type: "string" } } } } },
      },
      responses: {
        201: created("Server installed.", { $ref: "#/components/schemas/McpInstalled" }),
        400: badRequest("serverId is required."),
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/installed/{serverId}": {
    delete: {
      operationId: "uninstallMcpServer",
      summary: "Uninstall a server for the calling user",
      tags: ["MCP Operator"],
      parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        204: { description: "Server uninstalled." },
        404: notFound("MCP install not found."),
      },
    },
  },

  "/mcp/servers": {
    get: {
      operationId: "listMcpGovernanceServers",
      summary: "List every catalogue server after a current Organization/Administer grant check",
      tags: ["MCP Operator"],
      responses: {
        200: ok("All catalogue servers.", { type: "array", items: { $ref: "#/components/schemas/McpCatalogServer" } }),
        403: { description: "Current Organization/Administer grant is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
    post: {
      operationId: "registerRemoteMcpServer",
      summary: "Register a remote MCP server and start its protocol check",
      tags: ["MCP Operator"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["idempotencyKey", "name", "endpoint"], properties: { idempotencyKey: { type: "string", minLength: 8, maxLength: 128 }, name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 }, endpoint: { type: "string", format: "uri", maxLength: 2048 } } } } },
      },
      responses: {
        201: created("Remote server and protocol-check job saved.", { type: "object", required: ["id", "name", "endpoint", "eraProbeStatus"], properties: { id: { type: "string" }, name: { type: "string" }, endpoint: { type: "string", format: "uri" }, eraProbeStatus: { type: "string", enum: ["Pending", "Accepted", "Rejected"] } } }),
        400: badRequest("Registration fields are invalid."),
        403: { description: "Current Organization/Administer grant is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        409: { description: "Registration key or server name conflicts with another request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/mcp/servers/{id}/approve": {
    post: {
      operationId: "approveMcpServer",
      summary: "Approve a server (pending-review → approved). Requires Organization/Administer",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Server approved.", { $ref: "#/components/schemas/McpCatalogServer" }),
        403: { description: "Current Organization/Administer grant is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/servers/{id}/publish": {
    post: {
      operationId: "publishMcpServer",
      summary: "Publish a server (approved → published). Requires Organization/Administer",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Server published.", { $ref: "#/components/schemas/McpCatalogServer" }),
        403: { description: "Current Organization/Administer grant is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/servers/{id}/reject": {
    post: {
      operationId: "rejectMcpServer",
      summary: "Reject a server (→ disabled). Requires Organization/Administer",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Server rejected.", { $ref: "#/components/schemas/McpCatalogServer" }),
        403: { description: "Current Organization/Administer grant is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/servers/{id}/enabled": {
    post: {
      operationId: "setMcpServerEnabled",
      summary: "Toggle a server's availability (true → published, false → disabled). Requires Organization/Administer",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } } } },
      },
      responses: {
        200: ok("Server availability updated.", { $ref: "#/components/schemas/McpCatalogServer" }),
        400: badRequest("enabled (boolean) is required."),
        403: { description: "Current Organization/Administer grant is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/oci-image-validations": {
    post: {
      operationId: "submitOciImageValidation",
      summary: "Save an OCI image admission job. Requires Organization/Administer",
      tags: ["MCP Operator"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/OciImageValidationSubmission" } } },
      },
      responses: {
        201: created("OCI image admission and background import job saved.", { $ref: "#/components/schemas/OciImageValidation" }),
        400: badRequest("OCI image admission fields are invalid."),
        403: { description: "Current Organization/Administer grant is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("OCI image artifact revision not found."),
        409: { description: "Submission key conflicts with another immutable OCI image input.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/mcp/oci-image-validations/{id}": {
    get: {
      operationId: "getOciImageValidation",
      summary: "Read one saved OCI image admission. Requires Organization/Administer",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Saved OCI image admission.", { $ref: "#/components/schemas/OciImageValidation" }),
        400: badRequest("OCI image admission identifier is invalid."),
        403: { description: "Current Organization/Administer grant is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("OCI image validation not found."),
      },
    },
  },

  "/mcp/oci-image-validations/{id}/server": {
    post: {
      operationId: "promoteOciImageValidationToMcpServer",
      summary: "Create an MCP server revision from an imported OCI image and start discovery. Requires Organization/Administer",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256 } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["name", "description"], properties: { name: { type: "string", minLength: 1, maxLength: 120 }, description: { type: "string", maxLength: 1000 } } } } },
      },
      responses: {
        200: ok("The same imported image was already promoted.", { type: "object", required: ["outcome", "serverId", "serverRevisionId", "executionId"], properties: { outcome: { type: "string", enum: ["idempotent"] }, serverId: { type: "string" }, serverRevisionId: { type: "string" }, executionId: { type: "string" } } }),
        201: created("MCP server revision and discovery execution saved.", { type: "object", required: ["outcome", "serverId", "serverRevisionId", "executionId"], properties: { outcome: { type: "string", enum: ["created"] }, serverId: { type: "string" }, serverRevisionId: { type: "string" }, executionId: { type: "string" } } }),
        400: badRequest("Promotion fields are invalid."),
        401: { description: "Authenticated principal is unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        403: { description: "Current Organization/Administer grant is required.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("OCI image validation not found."),
        409: { description: "The image is not imported or its server promotion conflicts.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        503: { description: "MCP runtime authority is unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/mcp/tasks": {
    post: {
      operationId: "submitMcpTask",
      summary: "Start one durable OCI-backed MCP tool call",
      tags: ["MCP Tasks"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/McpTaskSubmission" } } },
      },
      responses: {
        201: created("MCP task and Absurd workflow receipt saved together.", { $ref: "#/components/schemas/McpTask" }),
        400: badRequest("MCP task fields are invalid."),
        401: { description: "Authenticated principal is unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        409: { description: "The idempotency key conflicts or the selected installed tool is unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/mcp/tasks/{id}": {
    get: {
      operationId: "getMcpTask",
      summary: "Read one caller-owned durable MCP task",
      tags: ["MCP Tasks"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256 } }],
      responses: {
        200: ok("Saved MCP task state, result, or failure.", { $ref: "#/components/schemas/McpTask" }),
        400: badRequest("MCP task identifier is invalid."),
        401: { description: "Authenticated principal is unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP task not found."),
      },
    },
    delete: {
      operationId: "cancelMcpTask",
      summary: "Cancel one MCP task before provider dispatch starts",
      tags: ["MCP Tasks"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256 } }],
      responses: {
        200: ok("MCP task cancelled before provider dispatch.", { $ref: "#/components/schemas/McpTask" }),
        400: badRequest("MCP task identifier is invalid."),
        401: { description: "Authenticated principal is unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP task not found."),
        409: { description: "Provider dispatch already started, so cancellation cannot claim success.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/mcp/tasks/{id}/input": {
    post: {
      operationId: "submitMcpTaskInput",
      summary: "Resume one waiting MCP task with its exact input response",
      tags: ["MCP Tasks"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256 } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/McpTaskInputResponse" } } },
      },
      responses: {
        200: ok("Input saved and the same durable task resumed.", { $ref: "#/components/schemas/McpTask" }),
        400: badRequest("MCP task input is invalid."),
        401: { description: "Authenticated principal is unavailable.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP task not found."),
        409: { description: "The response does not match the waiting request or conflicts with a saved response.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
};
