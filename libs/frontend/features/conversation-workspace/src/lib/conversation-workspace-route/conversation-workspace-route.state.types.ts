import type { NavigationExtras } from "@angular/router";

/**
 * Everything `Router.navigate` needs to open a child Agent thread and be able to come back.
 *
 * It is one object rather than two arguments so that the URL and the return coordinates are built
 * together and cannot drift: a caller cannot navigate to the child and forget the state that gets it
 * back to the right message.
 *
 * Used by: `_ConversationThreadRouteNavigation`, whose caller spreads this into `Router.navigate`.
 */
export interface ConversationThreadRouteNavigation
{
	/** Router command segments for the canonical breadcrumb child route. */
	readonly commands: readonly string[];
	/**
	 * Browser-history state consumed by the child route coordinator.
	 *
	 * Angular puts this on the history entry rather than in the URL, so the child gets its return
	 * coordinates without them being visible, shareable, or forgeable in the address bar.
	 */
	readonly extras: NavigationExtras;
}
