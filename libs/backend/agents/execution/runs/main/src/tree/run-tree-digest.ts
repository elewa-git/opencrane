import { ___DigestCanonicalJson } from "@opencrane/util";

import type { RunTreeChildCommand, RunTreeReservationCommand, RunTreeRootCommand } from "./run-tree.types";

/** Binds root initialization to its original trusted server ceiling; retries cannot replace it. */
export function _RootAdmissionDigest(command: RunTreeRootCommand): string
{
	return ___DigestCanonicalJson({ rootAdmission: { ...command, effectiveCostCapMicros: command.effectiveCostCapMicros.toString() } });
}

/** Binds a child allocation to its parent, resource portion and original deadline. */
export function _ChildAdmissionDigest(command: RunTreeChildCommand): string
{
	return ___DigestCanonicalJson({ childAdmission: { ...command, deadlineAt: command.deadlineAt.toISOString(), resources: { ...command.resources, costMicros: command.resources.costMicros.toString() } } });
}

/** Binds a local debit to its saved request, including an integer-exact spending amount. */
export function _ReservationDigest(command: RunTreeReservationCommand): string
{
	return ___DigestCanonicalJson({ reservation: { ...command, resources: { ...command.resources, costMicros: command.resources.costMicros.toString() } } });
}
