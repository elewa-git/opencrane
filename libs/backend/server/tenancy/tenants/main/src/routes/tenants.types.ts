import type { TenantDatasetMembership } from "@opencrane/backend/server/retrieval";

/** Effective-contract response returned to tenant runtimes. */
export interface EffectiveContractResponse
{
  /** Versioned awareness contract marker. */
  contractVersion: string;
  /** Stable hash of the compiled payload. */
  contractId: string;
  /** Tenant metadata included in the contract. */
  tenant: {
    /** Tenant name. */
    name: string;
    /** Tenant team, when configured. */
    team: string | null;
    /** Effective policy reference tracked by the operator. */
    policyRef: string | null;
  };
  /** Awareness compiler output and runtime hints. */
  awareness: {
    /** Citation format required by the runtime. */
    citationFormat: "inline" | "footnote";
    /** Dataset memberships available to the tenant. */
    memberships: {
      /** Organization dataset bindings. */
      org: string[];
      /** Department/team dataset bindings. */
      team: string[];
      /** Project dataset bindings. */
      project: string[];
      /** Personal dataset bindings. */
      personal: string[];
    };
    /** Compiled awareness decisions, when configured. */
    grants: Array<{
      /** Awareness payload identifier. */
      payloadId: string;
      /** Winning access result. */
      access: "allow" | "deny";
    }>;
  };
  /** Compiled MCP server access list. */
  mcp: {
    /** Endpoint used by runtimes to refresh effective contract state. */
    gateway: string;
    /** Allowed server inventory. */
    servers: Array<{
      /** Stable server identifier. */
      id: string;
      /** Display name. */
      name: string;
      /** Transport mode. */
      transport: string;
      /** Upstream endpoint. */
      endpoint: string;
    }>;
  };
}

/** Request body for creating a new tenant. */
export interface CreateTenantRequest
{
  /** Unique tenant identifier. */
  name: string;
  /** Human-readable display name. */
  displayName: string;
  /** Contact email for the tenant owner. */
  email: string;
  /**
   * IdP-verified subject (OIDC `sub`) the workspace belongs to. Bound onto the CR spec + the
   * projection row so per-user grant inheritance (S4 `effective-contract` compiles over
   * `[tenantName, subject]`) has an owner to attribute to. Validated against the parent org's
   * `OrgMembership` before seeding (#126 S1): a non-member is rejected.
   */
  subject?: string;
  /** Optional team the tenant belongs to. */
  team?: string;
  /** Optional parent ClusterTenant (customer) this tenant attaches to (CRD `spec.clusterTenantRef`). */
  clusterTenantRef?: string;
  /** Optional resource limits for the tenant sandbox. */
  resources?: {
    /** CPU limit (e.g. "500m"). */
    cpu?: string;
    /** Memory limit (e.g. "256Mi"). */
    memory?: string;
  };
  /** Optional reference to an AccessPolicy by name. */
  policyRef?: string;

  /** Optional monthly budget used when provisioning a LiteLLM virtual key. */
  monthlyBudgetUsd?: number;
}

/** Response shape returned when querying tenant details. */
export interface TenantResponse
{
  /** Unique tenant identifier. */
  name: string;
  /** Human-readable display name. */
  displayName: string;
  /** Contact email for the tenant owner. */
  email: string;
  /** Optional team the tenant belongs to. */
  team?: string;
  /** Parent ClusterTenant (customer) this tenant attaches to, if any. */
  clusterTenantRef?: string;
  /** Current lifecycle phase (e.g. "Running", "Pending"). */
  phase: string;
  /** Assigned ingress hostname, if provisioned. */
  ingressHost?: string;
  /** ISO-8601 creation timestamp. */
  createdAt?: string;
}

/** Request body for updating tenant dataset memberships. */
export interface UpdateTenantDatasetsRequest extends TenantDatasetMembership
{
}

/** Response body for tenant dataset membership endpoints. */
export interface TenantDatasetsResponse extends TenantDatasetMembership
{
}

/** Dataset scope and subject fields read when building the membership response. */
export interface TenantDatasetMembershipSubjectRow
{
  /** Dataset scope persisted by the projection. */
  scope: "Org" | "Team" | "Department" | "Project" | "Personal";
  /** Dataset subject within the selected scope. */
  subject: string;
}

/** SQL projection row representing one tenant dataset membership. */
export interface TenantDatasetMembershipRow extends TenantDatasetMembershipSubjectRow
{
  /** Tenant owning the dataset membership. */
  tenant: string;
}
