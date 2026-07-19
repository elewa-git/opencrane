-- A target run's execution subject is immutable after admission.
CREATE FUNCTION "enforce_agent_run_execution_subject_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."execution_subject_id" IS DISTINCT FROM OLD."execution_subject_id" THEN
        RAISE EXCEPTION 'AgentRun execution subject is immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "agent_runs_execution_subject_immutable"
    BEFORE UPDATE OF "execution_subject_id" ON "agent_runs"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_run_execution_subject_immutable"();

-- A stale bootstrap may never transition a later run attempt to Running.
CREATE FUNCTION "enforce_bootstrap_current_run_attempt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    current_attempt INTEGER;
    current_state "AgentRunState";
BEGIN
    IF OLD."consumed_at" IS NULL AND NEW."consumed_at" IS NOT NULL THEN
        SELECT "attempt", "state" INTO current_attempt, current_state
        FROM "agent_runs"
        WHERE "id" = NEW."run_id"
        FOR UPDATE;
        IF current_attempt IS DISTINCT FROM NEW."attempt" OR current_state IS DISTINCT FROM 'assigned'::"AgentRunState" THEN
            RAISE EXCEPTION 'WorkloadBootstrap must consume only the current Assigned run attempt';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "workload_bootstraps_current_run_attempt"
    BEFORE UPDATE OF "consumed_at" ON "workload_bootstraps"
    FOR EACH ROW EXECUTE FUNCTION "enforce_bootstrap_current_run_attempt"();
