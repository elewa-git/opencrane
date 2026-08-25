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
      summary: "List every catalogue server regardless of status (org-admin governance view)",
      tags: ["MCP Operator"],
      responses: {
        200: ok("All catalogue servers.", { type: "array", items: { $ref: "#/components/schemas/McpCatalogServer" } }),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
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
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        409: { description: "Registration key or server name conflicts with another request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/mcp/servers/{id}/approve": {
    post: {
      operationId: "approveMcpServer",
      summary: "Approve a server (pending-review → approved). Org-admin only",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Server approved.", { $ref: "#/components/schemas/McpCatalogServer" }),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/servers/{id}/publish": {
    post: {
      operationId: "publishMcpServer",
      summary: "Publish a server (approved → published). Org-admin only",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Server published.", { $ref: "#/components/schemas/McpCatalogServer" }),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/servers/{id}/reject": {
    post: {
      operationId: "rejectMcpServer",
      summary: "Reject a server (→ disabled). Org-admin only",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Server rejected.", { $ref: "#/components/schemas/McpCatalogServer" }),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/servers/{id}/enabled": {
    post: {
      operationId: "setMcpServerEnabled",
      summary: "Toggle a server's availability (true → published, false → disabled). Org-admin only",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } } } },
      },
      responses: {
        200: ok("Server availability updated.", { $ref: "#/components/schemas/McpCatalogServer" }),
        400: badRequest("enabled (boolean) is required."),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/servers/{id}/access": {
    get: {
      operationId: "getMcpAccessPolicy",
      summary: "Read the authorization grants for an MCP server. Org-admin only",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Access policy.", { $ref: "#/components/schemas/McpAccessPolicy" }),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
    put: {
      operationId: "setMcpAccessPolicy",
      summary: "Replace the authorization grants for an MCP server. Org-admin only",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["groupIds", "principalIds"], properties: { groupIds: { type: "array", items: { type: "string" }, description: "Stable local Group identifiers." }, principalIds: { type: "array", items: { type: "string" }, description: "Stable local Principal identifiers." } } } } },
      },
      responses: {
        200: ok("Access policy updated.", { $ref: "#/components/schemas/McpAccessPolicy" }),
        400: badRequest("groupIds (array) and principalIds (array) are required."),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp/bundle-validations": {
    post: {
      operationId: "submitMcpbValidation",
      summary: "Save an MCP bundle validation job. Org-admin only",
      tags: ["MCP Operator"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/McpbValidationSubmission" } } },
      },
      responses: {
        201: created("Bundle validation and background job saved.", { $ref: "#/components/schemas/McpbValidation" }),
        400: badRequest("Bundle validation fields are invalid."),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP bundle artifact revision not found."),
        409: { description: "Submission key conflicts with another immutable bundle input.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/mcp/bundle-validations/{id}": {
    get: {
      operationId: "getMcpbValidation",
      summary: "Read one saved MCP bundle validation. Org-admin only",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Saved bundle validation.", { $ref: "#/components/schemas/McpbValidation" }),
        400: badRequest("Bundle validation identifier is invalid."),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP bundle validation not found."),
      },
    },
  },

  "/mcp/tasks": {
    post: {
      operationId: "submitMcpTask",
      summary: "Save an asynchronous MCP tool call and start its workflow",
      tags: ["MCP Operator"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/McpTaskSubmission" } } },
      },
      responses: {
        201: created("Task and background workflow saved.", { $ref: "#/components/schemas/McpTask" }),
        400: badRequest("MCP task fields are invalid."),
        409: { description: "Task key conflicts with a different call.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/mcp/tasks/{id}": {
    get: {
      operationId: "getMcpTask",
      summary: "Read a saved MCP task owned by the calling user",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256, pattern: "\\S" } }],
      responses: {
        200: ok("Saved task progress.", { $ref: "#/components/schemas/McpTask" }),
        400: badRequest("MCP task identifier is invalid."),
        404: notFound("MCP task not found."),
      },
    },
  },

  "/mcp/tasks/{id}/input": {
    post: {
      operationId: "submitMcpTaskInput",
      summary: "Save requested input and wake an MCP task workflow",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256, pattern: "\\S" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/McpTaskInputResponse" } } },
      },
      responses: {
        200: ok("Task input accepted.", { $ref: "#/components/schemas/McpTask" }),
        400: badRequest("MCP task identifier or input fields are invalid."),
        404: notFound("MCP task not found."),
        409: { description: "Input conflicts with the saved task request or response.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/mcp/directory": {
    get: {
      operationId: "getMcpDirectory",
      summary: "List the selectable users and groups for the access editor. Org-admin only",
      tags: ["MCP Operator"],
      responses: {
        200: ok("Directory.", { $ref: "#/components/schemas/McpDirectory" }),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },
};
