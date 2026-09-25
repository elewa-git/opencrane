import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { vi } from "vitest";

import { GOVERNANCE_READ_GATEWAY, GOVERNANCE_READER_IDENTITY, type GovernanceAuditPage, type GovernanceReadGateway } from "@opencrane/state/governance";

import { AuditStore } from "../../audit/audit.store";
import { UsageStore } from "../../usage/usage.store";
import { GovernanceReadContextStore } from "../governance-read-context.store";

/** Controls one completion without relying on transport timing. */
export function _DeferredGovernanceRead<Value>()
{
	let resolve!: (value: Value) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>(function _Pending(complete, fail) { resolve = complete; reject = fail; });
	return { promise, resolve, reject };
}

/** Builds independent reader mocks and provides the production store classes. */
export function _GovernanceStoreFixture(identity: string | null = "reader-a")
{
	const reader = signal<string | null>(identity);
	const gateway = {
		readAuditPage: vi.fn<GovernanceReadGateway["readAuditPage"]>().mockResolvedValue(_GovernanceAuditPage()),
		readTokenUsage: vi.fn<GovernanceReadGateway["readTokenUsage"]>().mockResolvedValue([]),
		readGlobalBudget: vi.fn<GovernanceReadGateway["readGlobalBudget"]>().mockResolvedValue({ currency: "USD", ceilingAmount: 0 }),
		readAccountBudgets: vi.fn<GovernanceReadGateway["readAccountBudgets"]>().mockResolvedValue([]),
	};
	TestBed.configureTestingModule({ providers: [AuditStore, UsageStore, GovernanceReadContextStore, { provide: GOVERNANCE_READ_GATEWAY, useValue: gateway }, { provide: GOVERNANCE_READER_IDENTITY, useValue: reader }] });
	return { reader, gateway, context: TestBed.inject(GovernanceReadContextStore) };
}

/** Creates distinguishable audit rows without inventing an API row identifier. */
export function _GovernanceAuditPage(messages: readonly string[] = [], nextCursor?: string): GovernanceAuditPage
{
	return { data: messages.map(message => ({ timestamp: "2026-09-22T09:00:00.000Z", action: "Updated", resource: "Group/group-1", message })), pagination: { limit: 100, hasMore: nextCursor !== undefined, ...(nextCursor === undefined ? {} : { nextCursor }) } };
}

/** Runs Angular resource scheduling until the supplied production-state assertions hold. */
export async function _WaitForGovernanceRead(assertion: () => void): Promise<void>
{
	await vi.waitFor(async function _Check()
	{
		TestBed.tick();
		await Promise.resolve();
		await Promise.resolve();
		TestBed.tick();
		assertion();
	});
}
