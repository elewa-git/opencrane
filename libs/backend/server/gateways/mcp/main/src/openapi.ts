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

const McpServerCredentialInputSchema = {
  type: "object" as const,
  required: ["displayName"],
  properties: {
    displayName: { type: "string", description: "Operator-facing label." },
    brokeringMode: {
      type: "string",
      enum: ["static", "obo"],
      description: "Defaults to 'static'. 'static' requires secretRef; 'obo' must omit it.",
    },
    secretRef: { type: "string", description: "Required for 'static' brokering; omit for 'obo'." },
  },
};

/** OpenAPI path fragments owned by the mcp domain (composed into the opencrane-ui spec). */
export const _McpOpenapiPaths = {
  "/mcp-servers": {
    get: {
      operationId: "listMcpServers",
      summary: "List all MCP servers with grants and credentials",
      tags: ["MCP Servers"],
      responses: {
        200: ok("MCP server list.", { type: "array", items: { $ref: "#/components/schemas/McpServer" } }),
      },
    },
    post: {
      operationId: "createMcpServer",
      summary: "Create a new MCP server",
      tags: ["MCP Servers"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "endpoint", "transport"],
              properties: {
                name: { type: "string" },
                endpoint: { type: "string" },
                transport: { type: "string" },
                grants: { type: "array", items: { type: "object" } },
                credentials: { type: "array", items: { type: "object" } },
              },
            },
          },
        },
      },
      responses: {
        201: created("MCP server created.", { $ref: "#/components/schemas/McpServer" }),
      },
    },
  },

  "/mcp-servers/{id}": {
    get: {
      operationId: "getMcpServer",
      summary: "Get a single MCP server by identifier",
      tags: ["MCP Servers"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("MCP server detail.", { $ref: "#/components/schemas/McpServer" }),
        404: notFound("MCP server not found."),
      },
    },
    put: {
      operationId: "updateMcpServer",
      summary: "Update an MCP server and fully replace grants and credentials",
      tags: ["MCP Servers"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: {
        200: ok("MCP server updated.", { $ref: "#/components/schemas/McpServer" }),
      },
    },
    delete: {
      operationId: "deleteMcpServer",
      summary: "Delete an MCP server and its linked grant rows",
      tags: ["MCP Servers"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("MCP server deleted.", { type: "object", properties: { id: { type: "string" }, status: { type: "string" } } }),
      },
    },
  },

  "/mcp-servers/{id}/credentials": {
    get: {
      operationId: "listMcpServerCredentials",
      summary: "List the brokered credentials of an MCP server",
      tags: ["MCP Servers"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Credential list.", { type: "array", items: { $ref: "#/components/schemas/McpServerCredential" } }),
        404: notFound("MCP server not found."),
      },
    },
    post: {
      operationId: "addMcpServerCredential",
      summary: "Add a brokered credential to an MCP server (does not touch grants)",
      tags: ["MCP Servers"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: McpServerCredentialInputSchema } },
      },
      responses: {
        201: created("Credential added.", { $ref: "#/components/schemas/McpServerCredential" }),
        400: badRequest("Credential payload violates brokering-mode custody rules."),
        404: notFound("MCP server not found."),
      },
    },
  },

  "/mcp-servers/{id}/credentials/{credentialId}": {
    delete: {
      operationId: "deleteMcpServerCredential",
      summary: "Remove a single brokered credential from an MCP server",
      tags: ["MCP Servers"],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "credentialId", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: ok("Credential deleted.", { type: "object", properties: { id: { type: "string" }, status: { type: "string" } } }),
        404: notFound("MCP server or credential not found."),
      },
    },
  },

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
      summary: "Uninstall a server for the calling user (clears the stored credential)",
      tags: ["MCP Operator"],
      parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        204: { description: "Server uninstalled." },
        404: notFound("MCP install not found."),
      },
    },
  },

  "/mcp/installed/{serverId}/credential": {
    put: {
      operationId: "setMcpCredential",
      summary: "Author a per-user credential (write-only) and mark the install connected",
      description: "The submitted values are write-only: stored server-side as an opaque custody handle and NEVER returned by any response.",
      tags: ["MCP Operator"],
      parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["values"], properties: { values: { type: "object", additionalProperties: { type: "string" }, description: "Field values keyed by CredentialField.key. Write-only — never echoed back." } } } } },
      },
      responses: {
        200: ok("Credential connected.", { $ref: "#/components/schemas/McpInstalled" }),
        404: notFound("MCP install not found."),
      },
    },
    delete: {
      operationId: "clearMcpCredential",
      summary: "Clear a per-user credential, returning the install to needs-credential",
      tags: ["MCP Operator"],
      parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Credential cleared.", { $ref: "#/components/schemas/McpInstalled" }),
        404: notFound("MCP install not found."),
      },
    },
  },

  "/mcp/installed/{serverId}/oauth": {
    post: {
      operationId: "connectMcpOauth",
      summary: "Mark a remote-OAuth install connected after a successful handshake",
      tags: ["MCP Operator"],
      parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("OAuth connected.", { $ref: "#/components/schemas/McpInstalled" }),
        404: notFound("MCP install not found."),
      },
    },
    delete: {
      operationId: "disconnectMcpOauth",
      summary: "Disconnect a remote-OAuth install, returning it to needs-credential",
      tags: ["MCP Operator"],
      parameters: [{ name: "serverId", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("OAuth disconnected.", { $ref: "#/components/schemas/McpInstalled" }),
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
      summary: "Read a server's access policy. Org-admin only",
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
      summary: "Replace a server's access policy wholesale. Org-admin only",
      tags: ["MCP Operator"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["everyoneInOrg", "groups", "users"], properties: { everyoneInOrg: { type: "boolean" }, groups: { type: "array", items: { type: "string" } }, users: { type: "array", items: { type: "string" }, description: "Entitled user identifiers." } } } } },
      },
      responses: {
        200: ok("Access policy updated.", { $ref: "#/components/schemas/McpAccessPolicy" }),
        400: badRequest("everyoneInOrg (boolean), groups (array), and users (array) are required."),
        403: { description: "Caller is not an organisation admin.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("MCP server not found."),
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
