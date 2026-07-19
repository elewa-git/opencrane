# Agent product capabilities

This namespace owns the backend capabilities that make an employee's assistant useful. They are
separate from the OpenCrane control plane so product behaviour does not become tangled with fleet,
identity, or deployment administration.

`personal/` is the current product family. It owns the personal assistant's approved persona,
conversation history, durable-memory catalogue, and logical run lifecycle.

See [`libs/backend/README.md`](../README.md) for the broader backend layout and dependency rules.
