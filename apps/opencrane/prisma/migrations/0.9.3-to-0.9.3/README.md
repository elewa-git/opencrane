# 0.9.3 MCP task repair

This repair adds the durable records used by Skills MCP tasks. It runs after the original
`0.9.0-to-0.9.3` transition. It checks that transition's exact database record, then saves its own
completion record. A later deploy reads that record and does nothing. It does not change the original
migration, so a database that already reached 0.9.3 receives the same task records as a newly
upgraded database.
