/**
 * Package-local opencrane-ui logger.
 *
 * Same component name as the operator's root logger so every line from this
 * domain package lands in the one `clustertenant-manager` stream, and the
 * AsyncLocalStorage mixin in `@opencrane/observability` still stamps the
 * active request's `requestId` / `trace_id`.
 */
import { ___CreateLogger } from "@opencrane/observability";
import type { Logger } from "@opencrane/observability";

/** Package-wide logger for this domain package. */
export const _log: Logger = ___CreateLogger("clustertenant-manager");
