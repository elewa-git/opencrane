import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";

import { UiSessionSummary } from "../../../core/models/session.types.js";
import { UiIdentity } from "../../../core/models/ui-data.types.js";
import { AvatarComponent } from "../avatar/avatar.component.js";

/** Presentational application sidebar shared by Workspace and Settings routes. */
@Component({
	selector: "oc-app-sidebar",
	imports: [AvatarComponent],
	templateUrl: "./app-sidebar.component.html",
	styleUrl: "./app-sidebar.component.scss",
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppSidebarComponent
{
	/** Sessions rendered in owned and shared groups. */
	public readonly sessions = input.required<readonly UiSessionSummary[]>();

	/** Signed-in identity rendered in the footer. */
	public readonly identity = input.required<UiIdentity>();

	/** Currently selected session identifier. */
	public readonly selectedSessionId = input<string | null>(null);

	/** Whether the Settings route is active. */
	public readonly settingsActive = input<boolean>(false);

	/** Whether session rows are loading. */
	public readonly loading = input<boolean>(false);

	/** Optional recoverable session-list error. */
	public readonly error = input<string>();

	/** Emits a request to navigate to a new Session. */
	public readonly newSessionRequested = output<void>();

	/** Emits the selected Session identifier. */
	public readonly sessionSelected = output<string>();

	/** Emits a request to navigate to Settings. */
	public readonly settingsRequested = output<void>();

	/** Sessions owned by the current identity. */
	public readonly ownedSessions = computed(function _OwnedSessions(this: AppSidebarComponent): readonly UiSessionSummary[]
	{
		return this.sessions().filter(function _Owned(session: UiSessionSummary): boolean { return session.owned; });
	}.bind(this));

	/** Sessions shared with the current identity. */
	public readonly sharedSessions = computed(function _SharedSessions(this: AppSidebarComponent): readonly UiSessionSummary[]
	{
		return this.sessions().filter(function _Shared(session: UiSessionSummary): boolean { return !session.owned; });
	}.bind(this));
}
