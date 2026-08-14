import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { AvatarCircleComponent, AvatarSizes, AvatarTones } from "@opencrane/elements/ui";
import type { AgentThreadOriginPresentation } from "@opencrane/state/conversation/agent-threads";

/** Immutable parent-message origin shown at the start of a child Agent thread. */
@Component({ selector: "wo-agent-thread-origin", standalone: true, imports: [AvatarCircleComponent], templateUrl: "./agent-thread-origin.component.html", styleUrl: "./agent-thread-origin.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadOriginComponent
{
	/** Exact authorized root-message origin. */
	public readonly origin = input.required<AgentThreadOriginPresentation>();
	/** Shared compact avatar size. */
	protected readonly avatarSize = AvatarSizes.Small;
	/** Participant avatar treatment. */
	protected readonly avatarTone = AvatarTones.Blue;
}
