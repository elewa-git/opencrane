import { OPENCRANE_LIVE_ROUTES } from "./app.routes.live";

/**
 * Supplies the unchanged live route table to builds that do not replace this composition module.
 *
 * Tier 2 replaces this module so a tab without its private launch credential cannot instantiate
 * guarded routes or start an authentication request. Production, development-live, and Tier 1
 * continue to import this entry and retain their existing route behaviour.
 */
export const APP_ROUTES = OPENCRANE_LIVE_ROUTES;
