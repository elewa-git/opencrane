# Personal agent capabilities

Each package here owns one part of an employee's personal assistant:

- [`personas/`](personas/main/) approves the interview-informed persona that becomes the assistant's
  SOUL document.
- [`conversations/`](conversations/main/) records the ordered events that explain a run to the user.
- [`memory/`](memory/main/) records durable-memory metadata and provenance after the memory store
  accepts a fact.
- [`runs/`](runs/main/) owns logical run attempts and their workload assignments.

`apps/opencrane` is the intended composition boundary for these capabilities; they do not own HTTP
process setup or cluster administration. See [`../../README.md`](../../README.md) for the
product/control-plane split.
