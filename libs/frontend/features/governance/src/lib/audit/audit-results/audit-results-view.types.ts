/** Displays an audit row already mapped from an authorized API response. */
export interface AuditResultRowView
{
	/** Identifies the returned event for stable rendering. */
	readonly id: string;
	/** Shows the event time without using the browser clock to invent one. */
	readonly timestamp: string;
	/** Names the recorded action as display text. */
	readonly action: string;
	/** Identifies the resource included in the returned event. */
	readonly resource: string;
	/** Shows the returned event explanation as escaped text. */
	readonly message: string;
}
