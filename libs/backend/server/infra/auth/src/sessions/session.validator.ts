import { z } from "zod";

import type { AuthUser } from "./session.types";

/** Validates stored identity fields before authentication middleware receives them. */
export const _AuthUserSchema: z.ZodType<AuthUser> = z.object({ sub: z.string().min(1).max(2048), issuer: z.string().url().max(2048), groups: z.array(z.string().max(2048)).max(256), siloId: z.string().min(1).max(2048).optional(), authorizationExpiresAt: z.string().datetime({ offset: true }), isPlatformOperator: z.boolean(), email: z.string().max(2048).optional(), emailVerified: z.boolean().optional(), name: z.string().max(2048).optional(), picture: z.string().max(4096).optional(), authenticatedAt: z.string().datetime({ offset: true }) }).strict();
