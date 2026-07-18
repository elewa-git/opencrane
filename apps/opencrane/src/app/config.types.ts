import type { _LoadOperatorConfig } from "./config.js";

/** Runtime configuration loaded by the OpenCrane tenant operator. */
export type OpenClawTenantOperatorConfig = ReturnType<typeof _LoadOperatorConfig>;
