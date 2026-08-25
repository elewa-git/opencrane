# Database adapters

This folder contains the Prisma repositories, transaction factories, row mappers, and revision writer for agent services.

The adapters translate between domain ports and database records. They use transaction boundaries supplied by their callers where a workflow must make several changes together. HTTP routing, process configuration, and request policy stay in the parent `src/` folder.
