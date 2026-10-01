import { provideHttpClient, withFetch } from "@angular/common/http";

/** Uses the ordinary credential policy in every non-Tier 2 browser build. */
export const OPENCRANE_HTTP_PROVIDER = provideHttpClient(withFetch());
