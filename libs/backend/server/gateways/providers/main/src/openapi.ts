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

function pending(description: string, includeModelDefinitionId = false)
{
  return {
    description,
    content: { "application/json": { schema: { type: "object", required: ["error", "code", "commandId"], properties: { error: { type: "string" }, code: { type: "string", enum: ["PROVIDER_EFFECT_PENDING"] }, commandId: { type: "string", format: "uuid" }, ...(includeModelDefinitionId ? { modelDefinitionId: { type: "string", format: "uuid" } } : {}) } } } },
  };
}

function providerEffectBusy(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { type: "object", required: ["error", "code", "commandId"], properties: { error: { type: "string" }, code: { type: "string", enum: ["PROVIDER_EFFECT_BUSY"] }, commandId: { type: "string", format: "uuid", description: "Existing command that owns the resource barrier." } } } } },
  };
}

function providerDeletionConflict(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { oneOf: [
      { type: "object", required: ["error", "code", "commandId"], properties: { error: { type: "string" }, code: { type: "string", enum: ["PROVIDER_EFFECT_BUSY"] }, commandId: { type: "string", format: "uuid" } } },
      { type: "object", required: ["error", "code"], properties: { error: { type: "string" }, code: { type: "string", enum: ["PROVIDER_CONNECTION_GOVERNED"] } } },
    ] } } },
  };
}

/** OpenAPI path fragments owned by the providers domain (composed into the opencrane-ui spec). */
export const _ProvidersOpenapiPaths = {
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
      summary: "Admit and deliver a provider key change through the durable effect authority",
      tags: ["Provider Keys"],
      parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string", enum: ["openai", "anthropic", "gemini", "mistral", "deepseek", "glm"] } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ProviderKeySetRequest" } } },
      },
      responses: {
        200: ok("Key set; returns the provider's status.", { $ref: "#/components/schemas/ByokProviderKeyStatus" }),
        400: badRequest("Unsupported provider (code UNSUPPORTED_PROVIDER) or missing apiKey (code VALIDATION_ERROR)."),
		409: providerEffectBusy("Another claimed provider command owns this provider resource; retry or resume the returned command first."),
		503: pending("The command is durable but needs a later retry. Resubmit the returned commandId with the same raw key."),
      },
    },
    delete: {
      operationId: "deleteByokProviderKey",
      summary: "Admit and deliver durable removal of a provider key",
      tags: ["Provider Keys"],
      parameters: [
		{ name: "provider", in: "path", required: true, schema: { type: "string", enum: ["openai", "anthropic", "gemini", "mistral", "deepseek", "glm"] } },
		{ name: "commandId", in: "query", required: false, schema: { type: "string", format: "uuid" }, description: "Command id returned by a previous PROVIDER_EFFECT_PENDING response." },
	  ],
      responses: {
        204: { description: "Key removed (idempotent — 204 even when no key was set)." },
        400: badRequest("Unsupported provider (code UNSUPPORTED_PROVIDER)."),
		409: providerDeletionConflict("Another provider command owns this resource, or selected/frozen deployments still govern the connection."),
		503: pending("The removal is durable and the background reconciler or this exact command retry may resume it."),
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
      summary: "Create a model definition and durably register it with LiteLLM",
      tags: ["Model Registry"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/ModelDefinitionWrite" } } },
      },
      responses: {
        201: created("Model definition created.", { $ref: "#/components/schemas/ModelDefinition" }),
        400: badRequest("Request body failed validation, or the providerCredentialId is missing or owned by another ClusterTenant (code CREDENTIAL_SCOPE_MISMATCH)."),
        403: { description: "Caller is not authorized for the resource scope (code FORBIDDEN_SCOPE).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
		409: providerEffectBusy("The selected provider has an unsettled custody command."),
		503: pending("The model definition and registration command are durable but registration has not completed.", true),
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
  },

  "/models/{id}/registration-commands/{commandId}": {
	post: {
	  operationId: "resumeModelRegistration",
	  summary: "Resume one exact durable LiteLLM model registration",
	  tags: ["Model Registry"],
	  parameters: [
		{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
		{ name: "commandId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
	  ],
	  responses: {
		200: ok("Model registration completed.", { $ref: "#/components/schemas/ModelDefinition" }),
		503: pending("The exact model registration remains pending.", true),
	  },
	},
  },
};
