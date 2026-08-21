import type { Prisma } from "@prisma/client";

import type { BoundaryGrantResolver } from "./boundary-attachment-authority.types";
import { PrismaBoundaryGrantRepository } from "./prisma-boundary-grant-resolver";

/** Creates the boundary resolver on the caller's existing authority transaction. */
export function __CreatePrismaBoundaryGrantResolver(transaction: Prisma.TransactionClient): BoundaryGrantResolver
{
	return new PrismaBoundaryGrantRepository(transaction);
}
