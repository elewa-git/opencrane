import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { MessageModule } from "primeng/message";

import { CollapsibleSectionComponent } from "@opencrane/elements/ui";
import { AgentThreadDeliveryKinds, type AgentThreadDeliveryPresentation } from "@opencrane/state/conversation/agent-threads";

/** Display-safe immediate-parent delivery with a named slot for its owning rich renderer. */
@Component({ selector: "wo-agent-thread-delivery", standalone: true, imports: [CollapsibleSectionComponent, MessageModule], templateUrl: "./agent-thread-delivery.component.html", styleUrl: "./agent-thread-delivery.component.scss", changeDetection: ChangeDetectionStrategy.OnPush })
export class AgentThreadDeliveryComponent
{
	/** Exact append-only delivery projection. */
	public readonly delivery = input.required<AgentThreadDeliveryPresentation>();
	/** Stable delivery vocabulary used by the template. */
	protected readonly kinds = AgentThreadDeliveryKinds;

	/** PrimeNG severity for the delivery's truthful outcome category. */
	protected severity(): "error" | "info" | "success" | "warn"
	{
		switch (this.delivery().kind)
		{
			case AgentThreadDeliveryKinds.Failure: return "error";
			case AgentThreadDeliveryKinds.Question:
			case AgentThreadDeliveryKinds.Approval: return "warn";
			case AgentThreadDeliveryKinds.Result:
			case AgentThreadDeliveryKinds.Asset: return "success";
			case AgentThreadDeliveryKinds.Status: return "info";
		}
	}
}
