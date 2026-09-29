import { computed, inject, type Provider, type Signal } from "@angular/core";

import { SessionStore } from "@opencrane/state/core";
import { ROUTINE_GATEWAY, ROUTINE_SESSION } from "@opencrane/state/routines";
import { OpenCraneRoutineGateway } from "@opencrane/state/routines/adapter";

/** Binds routine transport and the current verified session identity at the browser app boundary. */
export function provideRoutineComposition(): Provider[]
{
	return [
		{ provide: ROUTINE_GATEWAY, useClass: OpenCraneRoutineGateway },
		{ provide: ROUTINE_SESSION, useFactory: _routineSession }
	];
}

/** Identifies the authenticated subject and silo without making identity a permission decision. */
function _routineSession(): Signal<string | null>
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
