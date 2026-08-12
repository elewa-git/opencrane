import { GeneratedOutputCapability } from "@opencrane/contracts";

/** Public model-registry record, including the exact generated-output features the route admits. */
export const _ModelDefinitionSchema = {
  type: "object" as const,
  required: ["id", "scope", "publicModelName", "litellmModelId", "upstreamModel", "isDefault", "generatedOutputCapabilities"],
  properties: {
    id: { type: "string", description: "Stable identifier." },
    scope: { type: "string", enum: ["global", "clusterTenant"], description: "Whether the model is platform-wide or owned by one ClusterTenant." },
    clusterTenant: { type: "string", nullable: true, description: "Owning ClusterTenant when scope is clusterTenant; null for Global." },
    publicModelName: { type: "string", description: "The routable public slug callers request, e.g. openai/gpt-4o." },
    litellmModelId: { type: "string", description: "Deployment id returned by LiteLLM /model/new (or a deterministic placeholder when LiteLLM is unconfigured)." },
    upstreamModel: { type: "string", description: "Upstream model the deployment targets." },
    apiBase: { type: "string", nullable: true, description: "Optional non-default API base for self-hosted / proxied endpoints." },
    isDefault: { type: "boolean", description: "Whether this is the default model at its scope." },
    providerCredentialId: { type: "string", nullable: true, description: "The provider credential backing this model, when set." },
    generatedOutputCapabilities: { type: "array", items: { type: "string", enum: [GeneratedOutputCapability.ImagePng, GeneratedOutputCapability.CodeExecutionFiles] }, description: "Provider-native generated outputs this model route may use." },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

/** Operator write contract for a model route and its generated-output feature allowlist. */
export const _ModelDefinitionWriteSchema = {
  type: "object" as const,
  required: ["publicModelName", "upstreamModel"],
  properties: {
    scope: { type: "string", enum: ["global", "clusterTenant"], description: "Defaults to global when omitted." },
    clusterTenant: { type: "string", description: "Required when scope is clusterTenant." },
    publicModelName: { type: "string", description: "The routable public slug, e.g. openai/gpt-4o." },
    upstreamModel: { type: "string", description: "Upstream model the deployment targets." },
    apiBase: { type: "string", description: "Optional non-default API base." },
    isDefault: { type: "boolean", description: "Whether this is the default model at its scope." },
    providerCredentialId: { type: "string", description: "Provider credential backing this model." },
    generatedOutputCapabilities: { type: "array", items: { type: "string", enum: [GeneratedOutputCapability.ImagePng, GeneratedOutputCapability.CodeExecutionFiles] }, description: "Provider-native generated outputs this model route may use." },
  },
} as const;
