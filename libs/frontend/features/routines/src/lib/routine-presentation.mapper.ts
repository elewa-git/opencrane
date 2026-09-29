import { ScopeChipTones } from "@opencrane/elements/ui";
import { AgentRunTerminalReasons, RoutineFiringDisposition, RoutineFiringReasons, RoutineFiringTrigger, RoutineStatus, type RoutineCreationOptions, type RoutineDetails, type RoutineFiringPage, type RoutineListPage } from "@opencrane/state/routines";

import type { RoutineAudienceChoiceView, RoutineCapabilitiesView, RoutineDetailsView, RoutineHistoryRowView, RoutineListRowView, RoutineServiceChoiceView, RoutineStatusView } from "./routine-presentation.types";
import { _RoutineInstant } from "./routine-schedule";

/** Exhaustive lifecycle labels used by list and detail presentation. */
const _STATUS: Record<RoutineStatus, RoutineStatusView> =
{
	[RoutineStatus.Active]: { label: "Active", tone: ScopeChipTones.Success },
	[RoutineStatus.Paused]: { label: "Paused", tone: ScopeChipTones.Warning },
	[RoutineStatus.Retired]: { label: "Retired", tone: ScopeChipTones.Neutral },
};

/** Exhaustive firing-state labels used by history presentation. */
const _DISPOSITION: Record<RoutineFiringDisposition, RoutineStatusView> =
{
	[RoutineFiringDisposition.Preparing]: { label: "Preparing", tone: ScopeChipTones.Info },
	[RoutineFiringDisposition.Running]: { label: "Running", tone: ScopeChipTones.Info },
	[RoutineFiringDisposition.Waiting]: { label: "Waiting", tone: ScopeChipTones.Warning },
	[RoutineFiringDisposition.Completed]: { label: "Completed", tone: ScopeChipTones.Success },
	[RoutineFiringDisposition.Failed]: { label: "Failed", tone: ScopeChipTones.Danger },
	[RoutineFiringDisposition.Cancelled]: { label: "Cancelled", tone: ScopeChipTones.Neutral },
	[RoutineFiringDisposition.SkippedOverlap]: { label: "Skipped", tone: ScopeChipTones.Warning },
	[RoutineFiringDisposition.Refused]: { label: "Refused", tone: ScopeChipTones.Danger },
	[RoutineFiringDisposition.Uncertain]: { label: "Needs review", tone: ScopeChipTones.Warning },
};

/** Public refusal and overlap explanations. */
const _REASONS: Record<RoutineFiringReasons, string> =
{
	[RoutineFiringReasons.RoutineRetired]: "The routine was retired before this run started.",
	[RoutineFiringReasons.CurrentAuthorityOrAudienceRefused]: "Current access or execution checks refused this run.",
	[RoutineFiringReasons.UnfinishedFiring]: "Another firing was still unfinished.",
};

/** Public terminal run explanations. */
const _TERMINAL_REASONS: Record<AgentRunTerminalReasons, string> =
{
	[AgentRunTerminalReasons.Success]: "Completed successfully.",
	[AgentRunTerminalReasons.PolicyDenied]: "Execution policy refused the run.",
	[AgentRunTerminalReasons.BudgetExhausted]: "The run reached its budget limit.",
	[AgentRunTerminalReasons.RuntimeFailure]: "The execution runtime failed.",
	[AgentRunTerminalReasons.InvalidInput]: "The admitted input was invalid.",
	[AgentRunTerminalReasons.UserCancelled]: "The requester cancelled the run.",
};

/** Public trigger labels. */
const _TRIGGERS: Record<RoutineFiringTrigger, string> =
{
	[RoutineFiringTrigger.Automatic]: "Scheduled",
	[RoutineFiringTrigger.Manual]: "Run now",
};

/** Ownership labels supported by the public contract. */
const _OWNERSHIP: Record<RoutineDetails["ownership"], string> = { owner: "Created by you", audience: "Shared with you" };

/** Maps one authorized routine page into display-only rows. */
export function _RoutineListRows(page: RoutineListPage): readonly RoutineListRowView[]
{
	return page.items.map(item =>
	{
		const latest = item.lastFiring;
		const latestLabel = latest === null ? "No runs yet" : `${_DISPOSITION[latest.disposition].label} · ${_RoutineInstant(latest.finishedAt ?? latest.scheduledSlot, item.schedule.timezone, "In progress")}`;
		return { routineId: item.routineId, status: _STATUS[item.status], ownershipLabel: _OWNERSHIP[item.ownership], serviceLabel: item.selectedManagedService.displayName, scheduleLabel: `${item.schedule.expression} · ${item.schedule.timezone}`, nextOccurrenceLabel: _RoutineInstant(item.nextAutomaticOccurrence, item.schedule.timezone, item.status === RoutineStatus.Retired ? "Retired" : "Not scheduled"), lastFiringLabel: latestLabel };
	});
}

/** Maps authorized details into presentation that contains no private identity coordinates. */
export function _RoutineDetailsView(detail: RoutineDetails): RoutineDetailsView
{
	return { routineId: detail.routineId, status: _STATUS[detail.status], ownershipLabel: _OWNERSHIP[detail.ownership], serviceLabel: detail.selectedManagedService.displayName, scheduleLabel: `${detail.schedule.expression} · ${detail.schedule.timezone}`, nextOccurrenceLabel: _RoutineInstant(detail.nextAutomaticOccurrence, detail.schedule.timezone, _NextFallback(detail.status)), lastOccurrenceLabel: _RoutineInstant(detail.lastAutomaticOccurrence, detail.schedule.timezone), instruction: detail.instruction, audienceLabels: detail.audienceChoices.map(_AudienceLabel) };
}

/** Copies server command hints without granting any browser authority. */
export function _RoutineCapabilities(detail: RoutineDetails): RoutineCapabilitiesView
{
	return { ...detail.capabilities };
}

/** Maps creation choices into the controlled form contracts. */
export function _RoutineCreationChoices(options: RoutineCreationOptions): { readonly audience: readonly RoutineAudienceChoiceView[]; readonly services: readonly RoutineServiceChoiceView[] }
{
	return { audience: options.audienceChoices.map(choice => ({ participantRef: choice.participantRef, label: choice.displayName, isSelf: choice.isSelf })), services: options.managedServiceChoices.map(choice => ({ id: choice.managedServiceId, label: choice.displayName })) };
}

/** Maps authorized firing history into browser-safe result rows. */
export function _RoutineHistoryRows(page: RoutineFiringPage, timezone: string): readonly RoutineHistoryRowView[]
{
	return page.items.map(item =>
	{
		const reason = item.reason === null ? null : _REASONS[item.reason];
		const terminal = item.runTerminalReason === null ? null : _TERMINAL_REASONS[item.runTerminalReason];
		const reasonLabel = reason ?? terminal ?? "No terminal reason recorded.";
		const costLabel = item.actualCost === null ? "Not recorded" : `${item.actualCost.amount} ${item.actualCost.currency}`;
		return { firingId: item.firingId, triggerLabel: _TRIGGERS[item.trigger], disposition: _DISPOSITION[item.disposition], scheduledLabel: _RoutineInstant(item.scheduledSlot, timezone, "Manual request"), finishedLabel: _RoutineInstant(item.finishedAt, timezone, "In progress"), reasonLabel, costLabel, resultConversationId: item.resultConversationId };
	});
}

/** Selects empty next-occurrence copy from the durable lifecycle state. */
function _NextFallback(status: RoutineDetails["status"]): string { return status === RoutineStatus.Retired ? "Retired" : "Not scheduled"; }

/** Adds the self marker without exposing any private identity coordinate. */
function _AudienceLabel(choice: RoutineDetails["audienceChoices"][number]): string { return choice.isSelf ? `${choice.displayName} · You` : choice.displayName; }
