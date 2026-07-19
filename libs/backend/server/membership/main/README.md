# @opencrane/backend/server/membership — Fleet membership

Owns verification of a person's current signed membership in an agent fleet. Callers receive an
explicit trusted or denied result, including the accepted revision and expiry when membership is
current.

The public surface is `src/index.ts`; `PrismaFleetMembershipAuthorityRepository` provides the
durable authority implementation. See [`../../README.md`](../../README.md) for the control-plane
map.
