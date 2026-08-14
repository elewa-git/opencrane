import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { ButtonModule } from "primeng/button";
import { BadgeModule } from "primeng/badge";

import { AvatarCircleComponent, AvatarSizes, AvatarTones, ScopeChipComponent, ScopeChipTones } from "@opencrane/elements/ui";
import { ConversationStatusLineComponent } from "@opencrane/elements/conversation";
import { AgentThreadAccessStates, type AgentThreadSummaryPresentation } from "@opencrane/state/conversation/agent-threads";

import { __AgentThreadSummaryStatusPresentation } from "./agent-thread.mapper";
import type { AgentThreadOpenIntent } from "./agent-thread-feature.types";

/** Compact child summary rendered directly beneath one root parent message. */
@Component({ selector: "wo-agent-thread-summary", standalone: true, imports: [AvatarCircleComponent, BadgeModule, ButtonModule, ConversationStatusLineComponent, ScopeChipComponent], templateUrl: "./agent-thread-summary.component.html", styleUrl: "./agent-thread-summary.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadSummaryComponent
{
	/** Exact parent group coordinate. */
	public readonly parentConversationId = input.required<string>();
	/** Exact root message coordinate used for restoration. */
	public readonly parentMessageId = input.required<string>();
	/** Opaque scroll anchor captured by the parent route coordinator. */
	public readonly parentScrollAnchor = input.required<string>();
	/** Authorized compact child projection. */
	public readonly summary = input.required<AgentThreadSummaryPresentation>();
	/** Emits exact navigation and restoration coordinates. */
	public readonly opened = output<AgentThreadOpenIntent>();
	/** Compact avatar size. */
	protected readonly avatarSize = AvatarSizes.Compact;
	/** Neutral avatar treatment for participant stacks. */
	protected readonly avatarTone = AvatarTones.Neutral;
	/** Restricted scope-chip treatment. */
	protected readonly restrictedTone = ScopeChipTones.Danger;
	/** Stable access vocabulary used by the template. */
	protected readonly accessStates = AgentThreadAccessStates;

	/** Derive a shared display-only status projection. */
	protected status() { return __AgentThreadSummaryStatusPresentation(this.summary()); }

	/** Emit an exact child route intent unless the current summary is restricted. */
	protected open(): void
	{
		const summary = this.summary();
		if (summary.access !== AgentThreadAccessStates.Available) return;
		this.opened.emit({ parentConversationId: this.parentConversationId(), childConversationId: summary.childConversationId, parentMessageId: this.parentMessageId(), parentScrollAnchor: this.parentScrollAnchor(), target: summary.target });
	}
}
