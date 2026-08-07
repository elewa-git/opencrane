import { __CreateHttpObotAttemptKeyIssuer, __CreateHttpObotCustodyAdapter, __CreateObotSession, __UnavailableObotCustodyAdapter } from "@opencrane/backend/_server/obot-custody";

import type { OpenCraneObotConfig } from "../../app/config.types.js";
import type { ObotAdapters } from "./obot-adapters.factory.types.js";

/**
 * Compose the Obot custody and attempt-key authorities from frozen process configuration.
 *
 * With no configuration the fail-closed unavailable custody adapter is returned and no attempt-key
 * issuer exists, so runtime attempts carry no Obot credential and custody provisioning refuses
 * loudly instead of minting a local handle. With configuration, ONE authenticated session backs both
 * adapters so they always target the same Obot with the same mounted service credential.
 *
 * @param config - Optional Obot block read at startup; null leaves the feature off.
 * @returns The custody port and, when configured, the attempt-key issuer.
 */
export function _CreateObotAdapters(config: OpenCraneObotConfig | null): ObotAdapters
{
	if (config === null) return { custody: new __UnavailableObotCustodyAdapter(), attemptKeys: null };
	const session = __CreateObotSession({ baseUrl: config.gatewayUrl, requestTimeoutMilliseconds: config.requestTimeoutMilliseconds, serviceTokenFile: config.serviceTokenPath });
	return { custody: __CreateHttpObotCustodyAdapter(session), attemptKeys: __CreateHttpObotAttemptKeyIssuer(session) };
}
