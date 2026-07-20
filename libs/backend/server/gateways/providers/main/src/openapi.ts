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

/** OpenAPI path fragments owned by the providers domain (composed into the opencrane-ui spec). */
export const _ProvidersOpenapiPaths = {
  "/providers/keys": {
    get: {
      operationId: "listProviderKeys",
      summary: "List configured provider API keys (configured status only, never the key value)",
      tags: ["Provider Keys"],
      responses: {
        200: ok("Provider key status list.", { type: "array", items: { $ref: "#/components/schemas/ProviderKey" } }),
      },
    },
  },

  "/providers/keys/{provider}": {
    put: {
      operationId: "upsertProviderKey",
      summary: "Create or update a provider API key",
      tags: ["Provider Keys"],
      parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["apiKey"],
              properties: { apiKey: { type: "string" } },
            },
          },
        },
      },
      responses: {
        200: ok("Key updated.", { $ref: "#/components/schemas/ProviderKey" }),
      },
    },
    delete: {
      operationId: "deleteProviderKey",
      summary: "Delete a configured provider API key",
      tags: ["Provider Keys"],
      parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        204: { description: "Key deleted." },
        404: notFound("Provider key not found."),
      },
    },
  },

  "/providers/byok": {
    get: {
      operationId: "listByokProviderKeys",
      summary: "List BYOK provider key status for every supported provider (never the key value)",
      tags: ["Provider Keys"],
      responses: {
        200: ok("BYOK provider key status list.", { type: "array", items: { $ref: "#/components/schemas/ByokProviderKeyStatus" } }),
      },
    },
  },

  "/providers/byok/{provider}": {
    put: {
      operationId: "setByokProviderKey",
      summary: "Set or refresh a provider's raw key (writes a k8s Secret + LiteLLM credential)",
      tags: ["Provider Keys"],
      parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string", enum: ["openai", "anthropic", "gemini", "mistral", "deepseek", "glm"] } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ProviderKeySetRequest" } } },
      },
      responses: {
        200: ok("Key set; returns the provider's status.", { $ref: "#/components/schemas/ByokProviderKeyStatus" }),
        400: badRequest("Unsupported provider (code UNSUPPORTED_PROVIDER) or missing apiKey (code VALIDATION_ERROR)."),
      },
    },
    delete: {
      operationId: "deleteByokProviderKey",
      summary: "Remove a provider's key (deletes the Secret, LiteLLM credential, and record)",
      tags: ["Provider Keys"],
      parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string", enum: ["openai", "anthropic", "gemini", "mistral", "deepseek", "glm"] } }],
      responses: {
        204: { description: "Key removed (idempotent — 204 even when no key was set)." },
        400: badRequest("Unsupported provider (code UNSUPPORTED_PROVIDER)."),
      },
    },
  },

  "/providers/credentials": {
    get: {
      operationId: "listProviderCredentials",
      summary: "List provider credentials (references only — never the key value)",
      tags: ["Provider Credentials"],
      parameters: [{ name: "clusterTenant", in: "query", required: false, schema: { type: "string" }, description: "Filter to one owning ClusterTenant." }],
      responses: {
        200: ok("Provider credential list.", { type: "array", items: { $ref: "#/components/schemas/ProviderCredential" } }),
      },
    },
    post: {
      operationId: "createProviderCredential",
      summary: "Create a provider credential reference (rejects any raw-key field)",
      tags: ["Provider Credentials"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ProviderCredentialWrite" } } },
      },
      responses: {
        201: created("Provider credential created.", { $ref: "#/components/schemas/ProviderCredential" }),
        400: badRequest("Request body failed validation, or carried a raw key (code RAW_KEY_REJECTED)."),
        403: { description: "Caller is not authorized for the resource scope (code FORBIDDEN_SCOPE).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/providers/credentials/{id}": {
    get: {
      operationId: "getProviderCredential",
      summary: "Get a single provider credential by id",
      tags: ["Provider Credentials"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Provider credential detail.", { $ref: "#/components/schemas/ProviderCredential" }),
        404: notFound("Provider credential not found."),
      },
    },
    put: {
      operationId: "updateProviderCredential",
      summary: "Update a provider credential reference (rejects any raw-key field)",
      tags: ["Provider Credentials"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ProviderCredentialWrite" } } },
      },
      responses: {
        200: ok("Provider credential updated.", { $ref: "#/components/schemas/ProviderCredential" }),
        400: badRequest("Request body failed validation, or carried a raw key (code RAW_KEY_REJECTED)."),
        403: { description: "Caller is not authorized for the resource scope (code FORBIDDEN_SCOPE).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("Provider credential not found."),
      },
    },
    delete: {
      operationId: "deleteProviderCredential",
      summary: "Delete a provider credential",
      tags: ["Provider Credentials"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Provider credential deleted.", { type: "object", properties: { id: { type: "string" }, status: { type: "string" } } }),
        403: { description: "Caller is not authorized for the resource scope (code FORBIDDEN_SCOPE).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("Provider credential not found."),
      },
    },
  },

  "/models": {
    get: {
      operationId: "listModels",
      summary: "List model definitions",
      tags: ["Model Registry"],
      parameters: [{ name: "clusterTenant", in: "query", required: false, schema: { type: "string" }, description: "Filter to one owning ClusterTenant." }],
      responses: {
        200: ok("Model definition list.", { type: "array", items: { $ref: "#/components/schemas/ModelDefinition" } }),
      },
    },
    post: {
      operationId: "createModel",
      summary: "Create a model definition and register it best-effort with LiteLLM",
      tags: ["Model Registry"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ModelDefinitionWrite" } } },
      },
      responses: {
        201: created("Model definition created.", { $ref: "#/components/schemas/ModelDefinition" }),
        400: badRequest("Request body failed validation, or the providerCredentialId is missing or owned by another ClusterTenant (code CREDENTIAL_SCOPE_MISMATCH)."),
        403: { description: "Caller is not authorized for the resource scope (code FORBIDDEN_SCOPE).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/models/{id}": {
    get: {
      operationId: "getModel",
      summary: "Get a single model definition by id",
      tags: ["Model Registry"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Model definition detail.", { $ref: "#/components/schemas/ModelDefinition" }),
        404: notFound("Model definition not found."),
      },
    },
    put: {
      operationId: "updateModel",
      summary: "Update a model definition",
      tags: ["Model Registry"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ModelDefinitionWrite" } } },
      },
      responses: {
        200: ok("Model definition updated.", { $ref: "#/components/schemas/ModelDefinition" }),
        400: badRequest("Request body failed validation."),
        403: { description: "Caller is not authorized for the resource scope (code FORBIDDEN_SCOPE).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("Model definition not found."),
      },
    },
    delete: {
      operationId: "deleteModel",
      summary: "Delete a model definition",
      tags: ["Model Registry"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Model definition deleted.", { type: "object", properties: { id: { type: "string" }, status: { type: "string" } } }),
        403: { description: "Caller is not authorized for the resource scope (code FORBIDDEN_SCOPE).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        404: notFound("Model definition not found."),
      },
    },
  },
};
