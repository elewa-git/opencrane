# @opencrane/backend/agents/personal/personas — Personas

Owns approval and activation of a person's assistant persona. A completed onboarding interview,
its selected template, and the supporting insights must agree before the approved revision becomes
the active SOUL source for that person.

The public surface is `src/index.ts`; persistence is supplied through `PersonaAuthorityRepository`.
See [`../../README.md`](../../README.md) for the other personal-agent capabilities.
