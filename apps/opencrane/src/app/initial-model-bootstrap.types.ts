import type { _ProvisionByokKey } from "@opencrane/backend/server/gateways/model-routing";

import type { InitialModelBootstrapConfig } from "./config.types";

/** Dependencies the app composes for initial provider-key registration. */
export interface InitialModelBootstrapDependencies
{
	/** Deployment-frozen silo that owns initial provider projections. */
	readonly siloId: string;
	/** The main product database client, passed through the provider-custody authority. */
	readonly prisma: Parameters<typeof _ProvisionByokKey>[0]["prisma"];
	/** Release-local Kubernetes Secret custody client passed through the provider authority. */
	readonly coreApi: Parameters<typeof _ProvisionByokKey>[0]["coreApi"];
	/** Deployment-supplied initial credential, or null for intentionally unconfigured deployments. */
	readonly config: InitialModelBootstrapConfig | null;
	/** Release namespace in which provider credentials are held. */
	readonly namespace: string;
}
