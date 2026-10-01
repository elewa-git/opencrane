import { GovernanceReadStates, type GovernanceReadFeedback } from "./reporting-view.types";

/**
 * Keeps retained data visible only in supported successful or refresh states.
 * Called by: AuditResultsComponent, TokenUsageSummaryComponent and BudgetSummaryComponent templates.
 * @param state - Read state supplied by the feature mapper.
 * @returns Whether display data may render; unknown states return false.
 */
export function _CanShowReportingData(state: GovernanceReadStates): boolean
{
	return state === GovernanceReadStates.Ready || state === GovernanceReadStates.Refreshing || state === GovernanceReadStates.RetainedError;
}

/**
 * Identifies a pending read so presentational controls do not emit duplicate refresh intents.
 * Called by: AuditResultsComponent, TokenUsageSummaryComponent and BudgetSummaryComponent.
 * @param state - Read state supplied by the feature mapper.
 * @returns Whether the current read is still pending.
 */
export function _IsReportingPending(state: GovernanceReadStates): boolean
{
	return state === GovernanceReadStates.Loading || state === GovernanceReadStates.Refreshing;
}

/**
 * Explains denied, unavailable and stale reads without treating a private old value as current.
 * Called by: AuditResultsComponent, TokenUsageSummaryComponent and BudgetSummaryComponent templates.
 * @param feedback - Mapped state and display-safe error.
 * @returns Failure copy, or null when the latest read has no failure to explain.
 */
export function _ReportingReadError(feedback: GovernanceReadFeedback): string | null
{
	switch (feedback.state)
	{
		case GovernanceReadStates.Unauthenticated: return "Your session is unavailable. Sign in again to read this report.";
		case GovernanceReadStates.Forbidden: return "You do not have permission to view this report.";
		case GovernanceReadStates.Unavailable: return feedback.error ?? "This report is unavailable. Try refreshing it.";
		case GovernanceReadStates.RetainedError: return `${feedback.error ?? "This report could not be refreshed."} Previously loaded values remain visible and may be out of date.`;
		case GovernanceReadStates.Loading:
		case GovernanceReadStates.Ready:
		case GovernanceReadStates.Refreshing: return null;
		default: return "This report cannot be displayed. Try refreshing it.";
	}
}
