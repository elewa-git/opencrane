import { computed, inject, type Provider, type Signal } from "@angular/core";

import { SessionStore } from "@opencrane/state/core";
import { GOVERNANCE_READ_GATEWAY, GOVERNANCE_READER_IDENTITY } from "@opencrane/state/governance";
import { OpenCraneGovernanceReadGateway } from "@opencrane/state/governance/adapter";

/** Binds protected reporting reads and identity selection at the browser app boundary. */
export function provideGovernanceReads(): Provider[]
{
	return [
		{ provide: GOVERNANCE_READ_GATEWAY, useClass: OpenCraneGovernanceReadGateway },
		{ provide: GOVERNANCE_READER_IDENTITY, useFactory: _readerIdentity }
	];
}

/** Separates account identities without turning session role hints into read authority. */
function _readerIdentity(): Signal<string | null>
{
	const session = inject(SessionStore);
	return computed(function _Identity()
	{
		const user = session.user();
		if (!session.authenticated() || user === undefined)
			return null;
		return JSON.stringify([user.sub, user.clusterTenant ?? null]);
	});
}
