\set ON_ERROR_STOP on

-- The deployment owner supplies the source-baseline and SQL digests, silo, and OIDC issuer.
\if :{?source_baseline_sha256}
\else
\echo 'source_baseline_sha256 is required'
\quit
\endif
\if :{?migration_sql_sha256}
\else
\echo 'migration_sql_sha256 is required'
\quit
\endif
\if :{?migration_silo_id}
\else
\echo 'migration_silo_id is required'
\quit
\endif
\if :{?migration_oidc_issuer}
\else
\echo 'migration_oidc_issuer is required'
\quit
\endif
SELECT pg_advisory_lock(hashtextextended('opencrane:database-schema-migration', 0));

SELECT to_regclass('opencrane_migrations.schema_history') IS NOT NULL AS migration_history_exists \gset
\if :migration_history_exists
SELECT (
    to_regclass('absurd.queues') IS NOT NULL
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'membership_authority'
    )
    AND EXISTS (
        SELECT 1 FROM "opencrane_migrations"."schema_history"
        WHERE "migration_id" = '0.9.0-to-0.9.3'
    )
) AS migration_already_applied \gset
\else
SELECT FALSE AS migration_already_applied \gset
\endif

\if :migration_already_applied
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
\else

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('opencrane:database-schema-migration:0.9.0-to-0.9.3', 0));
SELECT set_config('opencrane.expected_migration_sql_sha256', :'migration_sql_sha256', true);
SELECT set_config('opencrane.migration_silo_id', :'migration_silo_id', true);
SELECT set_config('opencrane.migration_oidc_issuer', :'migration_oidc_issuer', true);

DO $$
BEGIN
    IF btrim(current_setting('opencrane.migration_silo_id')) = ''
       OR btrim(current_setting('opencrane.migration_oidc_issuer')) = '' THEN
        RAISE EXCEPTION 'migration_silo_id and migration_oidc_issuer must be non-empty' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS "opencrane_migrations";
REVOKE ALL ON SCHEMA "opencrane_migrations" FROM PUBLIC;
CREATE TABLE IF NOT EXISTS "opencrane_migrations"."schema_history" (
    "schema_version" TEXT PRIMARY KEY,
    "source_schema_version" TEXT NOT NULL,
    "source_baseline_sha256" TEXT NOT NULL CHECK ("source_baseline_sha256" ~ '^[0-9a-f]{64}$'),
    "target_baseline_sha256" TEXT NOT NULL CHECK ("target_baseline_sha256" ~ '^[0-9a-f]{64}$'),
    "sql_sha256" TEXT NOT NULL CHECK ("sql_sha256" ~ '^[0-9a-f]{64}$'),
    "migration_id" TEXT NOT NULL UNIQUE,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE "opencrane_migrations"."schema_history" FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron extension is missing after the privileged migration prerequisite' USING ERRCODE = 'OC900';
  END IF;
  IF NOT has_schema_privilege(current_user, 'cron', 'USAGE') THEN
    RAISE EXCEPTION 'application owner lacks pg_cron schema access after the privileged migration prerequisite' USING ERRCODE = 'OC900';
  END IF;
END;
$$;
-- Absurd installs a Postgres-native durable workflow system that can be dropped
-- into an existing database.
--
-- It bootstraps the `absurd` schema and database objects so that jobs, runs,
-- checkpoints, and workflow events all live alongside application data without
-- external services.
--
-- Each queue is materialized as its own set of tables that share a prefix:
-- * `t_` for tasks (what is to be run)
-- * `r_` for runs (attempts to run a task)
-- * `c_` for checkpoints (saved states)
-- * `e_` for emitted events
-- * `w_` for wait registrations
-- * `i_` for idempotency keys (partitioned queues only)
--
-- `create_queue`, `drop_queue`, and `list_queues` provide the management
-- surface for provisioning queues safely.
--
-- Task execution flows through `spawn_task`, which records the logical task and
-- its first run, and `claim_task`, which hands work to workers with leasing
-- semantics, state transitions, and cancellation checks.  Runtime routines
-- such as `complete_run`, `schedule_run`, and `fail_run` advance or retry work,
-- enforce attempt accounting, and keep the task and run tables synchronized.
--
-- Long-running or event-driven workflows rely on lightweight persistence
-- primitives.  Checkpoint helpers (`set_task_checkpoint_state`,
-- `get_task_checkpoint_state`, `get_task_checkpoint_states`) write arbitrary
-- JSON payloads keyed by task and step, while `await_event` and `emit_event`
-- coordinate sleepers and external signals so that tasks can suspend and resume
-- without losing context.  Events are uniquely indexed and use first-write-wins
-- semantics: the first emission per name is cached, later emits are ignored.

create schema if not exists absurd;

-- Returns either the actual current timestamp or a fake one if
-- the session sets `absurd.fake_now`.  This lets tests control time.
create function absurd.current_time ()
  returns timestamptz
  language plpgsql
  volatile
as $$
declare
  v_fake text;
begin
  v_fake := current_setting('absurd.fake_now', true);
  if v_fake is not null and length(trim(v_fake)) > 0 then
    return v_fake::timestamptz;
  end if;

  return clock_timestamp();
end;
$$;

-- Calculates a retry delay with a global maximum of one day. Invalid explicit
-- delays are rejected; exponential overflow saturates at the configured cap.
create function absurd.retry_delay_seconds (
  p_strategy jsonb,
  p_attempt integer
)
  returns double precision
  language plpgsql
  immutable
as $$
declare
  v_limit constant double precision := 86400;
  v_kind text;
  v_base double precision;
  v_factor double precision;
  v_max_seconds double precision;
  v_exponent integer := greatest(coalesce(p_attempt, 1) - 1, 0);
begin
  if p_strategy is null then
    return 0;
  end if;
  if jsonb_typeof(p_strategy) <> 'object' then
    raise exception sqlstate 'AB003'
      using message = 'retry_strategy must be a JSON object';
  end if;

  v_kind := coalesce(p_strategy->>'kind', 'none');
  if v_kind not in ('none', 'fixed', 'exponential') then
    raise exception sqlstate 'AB003'
      using message = format('Unsupported retry strategy kind "%s"', v_kind);
  end if;
  if v_kind = 'none' then
    return 0;
  end if;

  v_base := coalesce(
    (p_strategy->>'base_seconds')::double precision,
    case when v_kind = 'fixed' then 60 else 30 end
  );
  if v_base not between 0 and v_limit then
    raise exception sqlstate 'AB003'
      using message = 'retry_strategy.base_seconds must be between 0 and 86400';
  end if;
  if v_kind = 'fixed' then
    return v_base;
  end if;

  v_factor := coalesce((p_strategy->>'factor')::double precision, 2);
  v_max_seconds := coalesce(
    (p_strategy->>'max_seconds')::double precision,
    v_limit
  );
  if v_factor < 0 or v_factor::text in ('NaN', 'Infinity', '-Infinity') then
    raise exception sqlstate 'AB003'
      using message = 'retry_strategy.factor must be a finite non-negative number';
  end if;
  if v_max_seconds not between 0 and v_limit then
    raise exception sqlstate 'AB003'
      using message = 'retry_strategy.max_seconds must be between 0 and 86400';
  end if;
  if v_base = 0 then
    return 0;
  end if;

  begin
    return least(v_base * power(v_factor, v_exponent), v_max_seconds);
  exception
    when numeric_value_out_of_range then
      return case when v_factor < 1 then 0 else v_max_seconds end;
  end;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception sqlstate 'AB003'
      using message = 'retry_strategy contains an invalid number';
end;
$$;

create table if not exists absurd.queues (
  queue_name text primary key,
  created_at timestamptz not null default absurd.current_time(),
  storage_mode text not null default 'unpartitioned'
    check (storage_mode in ('unpartitioned', 'partitioned')),
  default_partition text not null default 'enabled'
    check (default_partition in ('enabled', 'disabled')),
  partition_lookahead interval not null default interval '28 days'
    check (partition_lookahead >= interval '0 seconds'),
  partition_lookback interval not null default interval '1 day'
    check (partition_lookback >= interval '0 seconds'),
  cleanup_ttl interval not null default interval '30 days'
    check (cleanup_ttl >= interval '0 seconds'),
  cleanup_limit integer not null default 1000
    check (cleanup_limit >= 1),
  detach_mode text not null default 'none'
    check (detach_mode in ('none', 'empty')),
  detach_min_age interval not null default interval '30 days'
    check (detach_min_age >= interval '0 seconds')
);

-- Returns the Absurd schema release version baked into this SQL file.
-- During development this is usually "main" and release automation replaces
-- it with the actual tag version.

create or replace function absurd.get_schema_version ()
  returns text
  language sql
as $$
  select '0.5.0'::text;
$$;

-- Queue names are used in generated table/index identifiers.
-- We intentionally cap UTF-8 byte length so generated explicit index names
-- (for instance r_<queue>_sai) stay within PostgreSQL's 63-byte identifier
-- limit. Character set is otherwise delegated to PostgreSQL quoted-ident rules.
create function absurd.validate_queue_name (p_queue_name text)
  returns text
  language plpgsql
as $$
begin
  if p_queue_name is null or p_queue_name = '' then
    raise exception 'Queue name must be provided';
  end if;

  if octet_length(p_queue_name) > 57 then
    raise exception 'Queue name "%" is too long (max 57 bytes).', p_queue_name;
  end if;

  return p_queue_name;
end;
$$;

create function absurd.ensure_queue_tables (p_queue_name text)
  returns void
  language plpgsql
as $$
declare
  v_storage_mode text := 'unpartitioned';
  v_t_suffix text;
  v_r_suffix text;
  v_c_suffix text;
  v_w_suffix text;
  v_t_idempotency_def text;
begin
  perform absurd.validate_queue_name(p_queue_name);

  select storage_mode into v_storage_mode
  from absurd.queues
  where queue_name = p_queue_name;

  v_storage_mode := coalesce(v_storage_mode, 'unpartitioned');

  if v_storage_mode not in ('unpartitioned', 'partitioned') then
    raise exception 'Unsupported queue storage mode "%"', v_storage_mode;
  end if;

  if v_storage_mode = 'partitioned' then
    v_t_suffix := 'partition by range (task_id)';
    v_r_suffix := 'partition by range (run_id)';
    v_c_suffix := 'partition by range (task_id)';
    v_w_suffix := 'partition by range (run_id)';
    v_t_idempotency_def := 'idempotency_key text';
  else
    v_t_suffix := 'with (fillfactor=70)';
    v_r_suffix := 'with (fillfactor=70)';
    v_c_suffix := 'with (fillfactor=70)';
    v_w_suffix := '';
    v_t_idempotency_def := 'idempotency_key text unique';
  end if;

  execute format(
    'create table if not exists absurd.%I (
        task_id uuid primary key,
        task_name text not null,
        params jsonb not null,
        headers jsonb,
        retry_strategy jsonb,
        max_attempts integer,
        cancellation jsonb,
        enqueue_at timestamptz not null default absurd.current_time(),
        first_started_at timestamptz,
        state text not null check (state in (''pending'', ''running'', ''sleeping'', ''completed'', ''failed'', ''cancelled'')),
        attempts integer not null default 0,
        last_attempt_run uuid,
        completed_payload jsonb,
        cancelled_at timestamptz,
        %s
     ) %s',
    't_' || p_queue_name,
    v_t_idempotency_def,
    v_t_suffix
  );

  execute format(
    'create table if not exists absurd.%I (
        run_id uuid primary key,
        task_id uuid not null,
        attempt integer not null,
        state text not null check (state in (''pending'', ''running'', ''sleeping'', ''completed'', ''failed'', ''cancelled'')),
        claimed_by text,
        claim_expires_at timestamptz,
        available_at timestamptz not null,
        wake_event text,
        event_payload jsonb,
        started_at timestamptz,
        completed_at timestamptz,
        failed_at timestamptz,
        result jsonb,
        failure_reason jsonb,
        created_at timestamptz not null default absurd.current_time()
     ) %s',
    'r_' || p_queue_name,
    v_r_suffix
  );

  execute format(
    'create table if not exists absurd.%I (
        task_id uuid not null,
        checkpoint_name text not null,
        state jsonb,
        status text not null default ''committed'',
        owner_run_id uuid,
        updated_at timestamptz not null default absurd.current_time(),
        primary key (task_id, checkpoint_name)
     ) %s',
    'c_' || p_queue_name,
    v_c_suffix
  );

  execute format(
    'create table if not exists absurd.%I (
        event_name text primary key,
        payload jsonb,
        emitted_at timestamptz not null default absurd.current_time()
     )',
    'e_' || p_queue_name
  );

  execute format(
    'create table if not exists absurd.%I (
        task_id uuid not null,
        run_id uuid not null,
        step_name text not null,
        event_name text not null,
        timeout_at timestamptz,
        created_at timestamptz not null default absurd.current_time(),
        primary key (run_id, step_name)
     ) %s',
    'w_' || p_queue_name,
    v_w_suffix
  );

  if v_storage_mode = 'partitioned' then
    execute format(
      'create table if not exists absurd.%I (
          idempotency_key text primary key,
          task_id uuid not null
       )',
      'i_' || p_queue_name
    );
  end if;

  execute format(
    'create index if not exists %I on absurd.%I (state, available_at)',
    ('r_' || p_queue_name) || '_sai',
    'r_' || p_queue_name
  );

  execute format(
    'create index if not exists %I on absurd.%I (task_id)',
    ('r_' || p_queue_name) || '_ti',
    'r_' || p_queue_name
  );

  execute format(
    'create index if not exists %I on absurd.%I (claim_expires_at)
      where state = ''running''
        and claim_expires_at is not null',
    ('r_' || p_queue_name) || '_cei',
    'r_' || p_queue_name
  );

  execute format(
    'create index if not exists %I on absurd.%I (event_name)',
    ('w_' || p_queue_name) || '_eni',
    'w_' || p_queue_name
  );

  execute format(
    'create index if not exists %I on absurd.%I (task_id)',
    ('w_' || p_queue_name) || '_ti',
    'w_' || p_queue_name
  );

  execute format(
    'create index if not exists %I on absurd.%I (emitted_at)',
    ('e_' || p_queue_name) || '_eai',
    'e_' || p_queue_name
  );

  if v_storage_mode = 'partitioned' then
    execute format(
      'create index if not exists %I on absurd.%I (task_id)',
      ('i_' || p_queue_name) || '_ti',
      'i_' || p_queue_name
    );

    perform absurd.ensure_partitions(p_queue_name);
  end if;
end;
$$;

-- Creates the queue with the given name and storage mode.
--
-- Existing queues are idempotent as long as the requested mode matches.
create function absurd.create_queue (
  p_queue_name text,
  p_storage_mode text
)
  returns void
  language plpgsql
as $$
declare
  v_storage_mode text;
  v_existing_mode text;
begin
  p_queue_name := absurd.validate_queue_name(p_queue_name);

  v_storage_mode := lower(trim(coalesce(p_storage_mode, '')));
  if v_storage_mode not in ('unpartitioned', 'partitioned') then
    raise exception 'Unsupported queue storage mode "%"', p_storage_mode;
  end if;

  insert into absurd.queues (queue_name, storage_mode)
  values (p_queue_name, v_storage_mode)
  on conflict (queue_name) do nothing;

  select storage_mode into v_existing_mode
  from absurd.queues
  where queue_name = p_queue_name;

  if v_existing_mode is null then
    raise exception 'Queue "%" was not found after create attempt', p_queue_name;
  end if;

  if v_existing_mode <> v_storage_mode then
    raise exception 'Queue "%" already exists with storage mode "%"', p_queue_name, v_existing_mode;
  end if;

  perform absurd.ensure_queue_tables(p_queue_name);
end;
$$;

-- Creates an unpartitioned queue (backward-compatible API).
create or replace function absurd.create_queue (p_queue_name text)
  returns void
  language plpgsql
as $$
begin
  perform absurd.create_queue(p_queue_name, 'unpartitioned');
end;
$$;

-- Drop a queue if it exists.
-- We intentionally don't validate the provided name here so legacy queues
-- created under older naming rules can still be removed.
create function absurd.drop_queue (p_queue_name text)
  returns void
  language plpgsql
as $$
declare
  v_existing_queue text;
begin
  select queue_name into v_existing_queue
  from absurd.queues
  where queue_name = p_queue_name;

  if v_existing_queue is null then
    return;
  end if;

  -- Remove queue-scoped maintenance jobs only when pg_cron is available.
  if to_regclass('cron.job') is not null and exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'unschedule'
  ) then
    perform absurd.disable_cron(p_queue_name);
  end if;

  execute format('drop table if exists absurd.%I cascade', 'i_' || p_queue_name);
  execute format('drop table if exists absurd.%I cascade', 'w_' || p_queue_name);
  execute format('drop table if exists absurd.%I cascade', 'e_' || p_queue_name);
  execute format('drop table if exists absurd.%I cascade', 'c_' || p_queue_name);
  execute format('drop table if exists absurd.%I cascade', 'r_' || p_queue_name);
  execute format('drop table if exists absurd.%I cascade', 't_' || p_queue_name);

  delete from absurd.queues where queue_name = p_queue_name;
end;
$$;

-- Lists all queues that currently exist.
create function absurd.list_queues ()
  returns table (queue_name text)
  language sql
as $$
  select queue_name from absurd.queues order by queue_name;
$$;

-- Returns queue maintenance policy metadata.
create function absurd.get_queue_policy (
  p_queue_name text
)
  returns table (
    queue_name text,
    storage_mode text,
    default_partition text,
    partition_lookahead interval,
    partition_lookback interval,
    cleanup_ttl interval,
    cleanup_limit integer,
    detach_mode text,
    detach_min_age interval
  )
  language sql
as $$
  select
    q.queue_name,
    q.storage_mode,
    q.default_partition,
    q.partition_lookahead,
    q.partition_lookback,
    q.cleanup_ttl,
    q.cleanup_limit,
    q.detach_mode,
    q.detach_min_age
  from absurd.queues q
  where q.queue_name = p_queue_name;
$$;

-- Updates queue maintenance policy metadata.
--
-- p_policy accepts optional keys:
-- * partition_lookahead (interval text)
-- * partition_lookback (interval text)
-- * cleanup_ttl (interval text, >= 0)
-- * cleanup_limit (integer >= 1)
-- * detach_mode ('none' | 'empty')
-- * detach_min_age (interval text)
-- * default_partition ('enabled' | 'disabled')
create function absurd.set_queue_policy (
  p_queue_name text,
  p_policy jsonb
)
  returns void
  language plpgsql
as $$
declare
  v_policy jsonb := coalesce(p_policy, '{}'::jsonb);
  v_unknown_key text;
  v_exists boolean := false;
  v_storage_mode text;
  v_default_partition text;
  v_previous_default_partition text;
  v_parent_prefix text;
  v_parent_table text;
  v_default_table text;
  v_default_attached boolean;
  v_default_has_rows boolean;

  v_partition_lookahead interval;
  v_partition_lookback interval;
  v_cleanup_ttl interval;
  v_cleanup_limit integer;
  v_detach_mode text;
  v_detach_min_age interval;
begin
  p_queue_name := absurd.validate_queue_name(p_queue_name);

  if jsonb_typeof(v_policy) <> 'object' then
    raise exception 'Queue policy must be a JSON object';
  end if;

  select k.key
    into v_unknown_key
    from jsonb_object_keys(v_policy) as k(key)
   where k.key not in (
      'partition_lookahead',
      'partition_lookback',
      'cleanup_ttl',
      'cleanup_limit',
      'detach_mode',
      'detach_min_age',
      'default_partition'
   )
   limit 1;

  if v_unknown_key is not null then
    raise exception 'Unsupported queue policy key "%"', v_unknown_key;
  end if;

  select exists (
    select 1
    from absurd.queues
    where queue_name = p_queue_name
  )
  into v_exists;

  if not v_exists then
    raise exception 'Queue "%" does not exist', p_queue_name;
  end if;

  select
    storage_mode,
    default_partition,
    partition_lookahead,
    partition_lookback,
    cleanup_ttl,
    cleanup_limit,
    detach_mode,
    detach_min_age
  into
    v_storage_mode,
    v_default_partition,
    v_partition_lookahead,
    v_partition_lookback,
    v_cleanup_ttl,
    v_cleanup_limit,
    v_detach_mode,
    v_detach_min_age
  from absurd.queues
  where queue_name = p_queue_name
  for update;

  if v_policy ? 'partition_lookahead' then
    v_partition_lookahead := (v_policy->>'partition_lookahead')::interval;
  end if;

  if v_policy ? 'partition_lookback' then
    v_partition_lookback := (v_policy->>'partition_lookback')::interval;
  end if;

  if v_policy ? 'cleanup_ttl' then
    v_cleanup_ttl := (v_policy->>'cleanup_ttl')::interval;
  end if;

  if v_policy ? 'cleanup_limit' then
    v_cleanup_limit := (v_policy->>'cleanup_limit')::integer;
  end if;

  if v_policy ? 'detach_mode' then
    v_detach_mode := lower(trim(coalesce(v_policy->>'detach_mode', '')));
  end if;

  if v_policy ? 'detach_min_age' then
    v_detach_min_age := (v_policy->>'detach_min_age')::interval;
  end if;

  v_previous_default_partition := v_default_partition;

  if v_policy ? 'default_partition' then
    v_default_partition := lower(trim(coalesce(v_policy->>'default_partition', '')));
  end if;

  if v_partition_lookahead < interval '0 seconds' then
    raise exception 'partition_lookahead must be non-negative';
  end if;

  if v_partition_lookback < interval '0 seconds' then
    raise exception 'partition_lookback must be non-negative';
  end if;

  if v_cleanup_ttl < interval '0 seconds' then
    raise exception 'cleanup_ttl must be non-negative';
  end if;

  if v_cleanup_limit < 1 then
    raise exception 'cleanup_limit must be at least 1';
  end if;

  if v_detach_mode not in ('none', 'empty') then
    raise exception 'Unsupported detach mode "%"', v_detach_mode;
  end if;

  if v_detach_min_age < interval '0 seconds' then
    raise exception 'detach_min_age must be non-negative';
  end if;

  if v_default_partition not in ('enabled', 'disabled') then
    raise exception 'Unsupported default_partition mode "%"', v_default_partition;
  end if;

  if v_storage_mode <> 'partitioned' and v_policy ? 'default_partition' then
    raise exception 'default_partition policy is only supported for partitioned queues';
  end if;

  update absurd.queues
     set default_partition = v_default_partition,
         partition_lookahead = v_partition_lookahead,
         partition_lookback = v_partition_lookback,
         cleanup_ttl = v_cleanup_ttl,
         cleanup_limit = v_cleanup_limit,
         detach_mode = v_detach_mode,
         detach_min_age = v_detach_min_age
   where queue_name = p_queue_name;

  if v_storage_mode = 'partitioned'
     and v_previous_default_partition <> v_default_partition then
    if v_default_partition = 'enabled' then
      perform absurd.ensure_partitions(p_queue_name);
    else
      foreach v_parent_prefix in array array['t', 'r', 'c', 'w'] loop
        v_parent_table := v_parent_prefix || '_' || p_queue_name;
        v_default_table := v_parent_table || '_d';

        select exists (
          select 1
          from pg_inherits inh
          join pg_class parent on parent.oid = inh.inhparent
          join pg_class child on child.oid = inh.inhrelid
          join pg_namespace n on n.oid = parent.relnamespace
          where n.nspname = 'absurd'
            and parent.relname = v_parent_table
            and child.relname = v_default_table
        )
        into v_default_attached;

        if not coalesce(v_default_attached, false) then
          continue;
        end if;

        -- Block out-of-window writes into the default partition while we
        -- validate emptiness and detach/drop it.
        execute format(
          'lock table absurd.%I in access exclusive mode',
          v_default_table
        );

        execute format(
          'select exists (select 1 from absurd.%I limit 1)',
          v_default_table
        )
        into v_default_has_rows;

        if coalesce(v_default_has_rows, false) then
          raise exception
            'Cannot disable default_partition for queue "%": default partition "%" is not empty',
            p_queue_name,
            v_default_table;
        end if;

        execute format(
          'alter table absurd.%I detach partition absurd.%I',
          v_parent_table,
          v_default_table
        );
        execute format('drop table if exists absurd.%I', v_default_table);
      end loop;
    end if;
  end if;
end;
$$;

-- Returns the current state and terminal payload (if any) for a task.
--
-- Non-terminal states (pending/running/sleeping) return result/failure_reason
-- as NULL. Completed tasks expose completed_payload as result. Failed tasks
-- expose the last run failure_reason.
create function absurd.get_task_result (
  p_queue_name text,
  p_task_id uuid
)
  returns table (
    task_id uuid,
    state text,
    result jsonb,
    failure_reason jsonb
  )
  language plpgsql
as $$
begin
  p_queue_name := absurd.validate_queue_name(p_queue_name);

  return query execute format(
    'select t.task_id,
            t.state,
            case when t.state = ''completed'' then t.completed_payload else null end as result,
            case when t.state = ''failed'' then r.failure_reason else null end as failure_reason
       from absurd.%I t
       left join absurd.%I r on r.run_id = t.last_attempt_run
      where t.task_id = $1',
    't_' || p_queue_name,
    'r_' || p_queue_name
  ) using p_task_id;
end;
$$;

-- Spawns a given task in a queue.
--
-- If an idempotency_key is provided in p_options, the function will check if a task
-- with that key already exists. If so, it returns the existing task_id with run_id
-- and attempt set to NULL to signal "already exists". This is race-safe via
-- INSERT ... ON CONFLICT DO NOTHING.
create function absurd.spawn_task (
  p_queue_name text,
  p_task_name text,
  p_params jsonb,
  p_options jsonb default '{}'::jsonb
)
  returns table (
    task_id uuid,
    run_id uuid,
    attempt integer,
    created boolean
  )
  language plpgsql
as $$
declare
  v_task_id uuid := absurd.portable_uuidv7();
  v_run_id uuid := absurd.portable_uuidv7();
  v_attempt integer := 1;
  v_headers jsonb;
  v_retry_strategy jsonb;
  v_max_attempts integer;
  v_cancellation jsonb;
  v_idempotency_key text;
  v_existing_task_id uuid;
  v_existing_run_id uuid;
  v_existing_attempt integer;
  v_row_count integer;
  v_storage_mode text := 'unpartitioned';
  v_task_inserted boolean := false;
  v_now timestamptz := absurd.current_time();
  v_params jsonb := coalesce(p_params, 'null'::jsonb);
begin
  if p_task_name is null or length(trim(p_task_name)) = 0 then
    raise exception 'task_name must be provided';
  end if;

  if p_options is not null then
    v_headers := p_options->'headers';
    v_retry_strategy := p_options->'retry_strategy';
    perform absurd.retry_delay_seconds(v_retry_strategy, 1);
    if p_options ? 'max_attempts' then
      v_max_attempts := (p_options->>'max_attempts')::int;
      if v_max_attempts is not null and v_max_attempts < 1 then
        raise exception 'max_attempts must be >= 1';
      end if;
    end if;
    v_cancellation := p_options->'cancellation';
    v_idempotency_key := p_options->>'idempotency_key';
  end if;

  if v_idempotency_key is not null then
    select storage_mode into v_storage_mode
    from absurd.queues
    where queue_name = p_queue_name;

    v_storage_mode := coalesce(v_storage_mode, 'unpartitioned');
    if v_storage_mode not in ('unpartitioned', 'partitioned') then
      raise exception 'Unsupported queue storage mode "%"', v_storage_mode;
    end if;

    if v_storage_mode = 'partitioned' then
      -- Reserve idempotency key via dedicated side table.
      execute format(
        'insert into absurd.%I (idempotency_key, task_id)
         values ($1, $2)
         on conflict (idempotency_key) do nothing',
        'i_' || p_queue_name
      )
      using v_idempotency_key, v_task_id;

      get diagnostics v_row_count = row_count;

      if v_row_count = 0 then
        execute format(
          'select i.task_id, t.last_attempt_run, t.attempts
             from absurd.%I i
             join absurd.%I t on t.task_id = i.task_id
            where i.idempotency_key = $1
              for key share of i',
          'i_' || p_queue_name,
          't_' || p_queue_name
        )
        into v_existing_task_id, v_existing_run_id, v_existing_attempt
        using v_idempotency_key;

        if v_existing_task_id is null then
          raise exception 'Idempotency key "%" in queue "%" was concurrently cleaned up', v_idempotency_key, p_queue_name
            using errcode = '40001',
                  hint = 'Retry spawn_task with the same idempotency key.';
        end if;

        if v_existing_run_id is null then
          raise exception 'Idempotency key "%" in queue "%" resolved to task "%" without a run', v_idempotency_key, p_queue_name, v_existing_task_id;
        end if;

        return query select v_existing_task_id, v_existing_run_id, v_existing_attempt, false;
        return;
      end if;
    else
      -- Unpartitioned queues keep the original unique(idempotency_key)
      -- behavior directly on t_<queue>.
      execute format(
        'insert into absurd.%I (task_id, task_name, params, headers, retry_strategy, max_attempts, cancellation, enqueue_at, first_started_at, state, attempts, last_attempt_run, completed_payload, cancelled_at, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, null, ''pending'', $9, $10, null, null, $11)
         on conflict (idempotency_key) do nothing',
        't_' || p_queue_name
      )
      using v_task_id, p_task_name, v_params, v_headers, v_retry_strategy, v_max_attempts, v_cancellation, v_now, v_attempt, v_run_id, v_idempotency_key;

      get diagnostics v_row_count = row_count;

      if v_row_count = 0 then
        execute format(
          'select task_id, last_attempt_run, attempts
             from absurd.%I
            where idempotency_key = $1',
          't_' || p_queue_name
        )
        into v_existing_task_id, v_existing_run_id, v_existing_attempt
        using v_idempotency_key;

        return query select v_existing_task_id, v_existing_run_id, v_existing_attempt, false;
        return;
      end if;

      v_task_inserted := true;
    end if;
  end if;

  if not v_task_inserted then
    execute format(
      'insert into absurd.%I (task_id, task_name, params, headers, retry_strategy, max_attempts, cancellation, enqueue_at, first_started_at, state, attempts, last_attempt_run, completed_payload, cancelled_at, idempotency_key)
       values ($1, $2, $3, $4, $5, $6, $7, $8, null, ''pending'', $9, $10, null, null, $11)',
      't_' || p_queue_name
    )
    using v_task_id, p_task_name, v_params, v_headers, v_retry_strategy, v_max_attempts, v_cancellation, v_now, v_attempt, v_run_id, v_idempotency_key;
  end if;

  execute format(
    'insert into absurd.%I (run_id, task_id, attempt, state, available_at, wake_event, event_payload, result, failure_reason)
     values ($1, $2, $3, ''pending'', $4, null, null, null, null)',
    'r_' || p_queue_name
  )
  using v_run_id, v_task_id, v_attempt, v_now;

  return query select v_task_id, v_run_id, v_attempt, true;
end;
$$;

-- Workers call this to reserve a task from a given queue
-- for a given reservation period in seconds.
create function absurd.claim_task (
  p_queue_name text,
  p_worker_id text,
  p_claim_timeout integer default 30,
  p_qty integer default 1
)
  returns table (
    run_id uuid,
    task_id uuid,
    attempt integer,
    task_name text,
    params jsonb,
    retry_strategy jsonb,
    max_attempts integer,
    headers jsonb,
    wake_event text,
    event_payload jsonb
  )
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_claim_timeout integer := greatest(coalesce(p_claim_timeout, 30), 0);
  v_worker_id text := coalesce(nullif(p_worker_id, ''), 'worker');
  v_qty integer := greatest(coalesce(p_qty, 1), 1);
  v_claim_until timestamptz := null;
  v_sql text;
  v_expired_run record;
  v_cancel_candidate record;
  v_expired_sweep_limit integer;
begin
  if v_claim_timeout > 0 then
    v_claim_until := v_now + make_interval(secs => v_claim_timeout);
  end if;

  -- Keep claim polling work bounded: process at most v_qty expired leases
  -- per claim call.
  v_expired_sweep_limit := greatest(v_qty, 1);

  -- Apply cancellation rules before claiming.
  --
  -- Use cancel_task() so lock order stays consistent (runs first, task second)
  -- with complete_run()/fail_run().
  for v_cancel_candidate in
    execute format(
      'select task_id
         from absurd.%I
        where state in (''pending'', ''sleeping'', ''running'')
          and (
            (
              (cancellation->>''max_delay'')::bigint is not null
              and first_started_at is null
              and extract(epoch from ($1 - enqueue_at)) >= (cancellation->>''max_delay'')::bigint
            )
            or
            (
              (cancellation->>''max_duration'')::bigint is not null
              and first_started_at is not null
              and extract(epoch from ($1 - first_started_at)) >= (cancellation->>''max_duration'')::bigint
            )
          )
        order by task_id',
      't_' || p_queue_name
    )
  using v_now
  loop
    perform absurd.cancel_task(p_queue_name, v_cancel_candidate.task_id);
  end loop;

  for v_expired_run in
    execute format(
      'select run_id,
              claimed_by,
              claim_expires_at,
              attempt
         from absurd.%I
        where state = ''running''
          and claim_expires_at is not null
          and claim_expires_at <= $1
        order by claim_expires_at, run_id
        limit $2
        for update skip locked',
      'r_' || p_queue_name
    )
  using v_now, v_expired_sweep_limit
  loop
    perform absurd.fail_run(
      p_queue_name,
      v_expired_run.run_id,
      jsonb_strip_nulls(jsonb_build_object(
        'name', '$ClaimTimeout',
        'message', 'worker did not finish task within claim interval',
        'workerId', v_expired_run.claimed_by,
        'claimExpiredAt', v_expired_run.claim_expires_at,
        'attempt', v_expired_run.attempt
      )),
      null
    );
  end loop;

  v_sql := format(
    'with candidate as (
        select r.run_id
          from absurd.%1$I r
          join absurd.%2$I t on t.task_id = r.task_id
         where r.state in (''pending'', ''sleeping'')
           and t.state in (''pending'', ''sleeping'', ''running'')
           and r.available_at <= $1
         order by r.available_at, r.run_id
         limit $2
         for update skip locked
     ),
     updated as (
        update absurd.%1$I r
           set state = ''running'',
               claimed_by = $3,
               claim_expires_at = $4,
               started_at = $1,
               available_at = $1
         where run_id in (select run_id from candidate)
         returning r.run_id, r.task_id, r.attempt
     ),
     task_upd as (
        update absurd.%2$I t
           set state = ''running'',
               attempts = greatest(t.attempts, u.attempt),
               first_started_at = coalesce(t.first_started_at, $1),
               last_attempt_run = u.run_id
          from updated u
         where t.task_id = u.task_id
         returning t.task_id
     ),
     wait_cleanup as (
        delete from absurd.%3$I w
         using updated u
        where w.run_id = u.run_id
          and w.timeout_at is not null
          and w.timeout_at <= $1
        returning w.run_id
     )
     select
       u.run_id,
       u.task_id,
       u.attempt,
       t.task_name,
       t.params,
       t.retry_strategy,
       t.max_attempts,
      t.headers,
      r.wake_event,
      r.event_payload
     from updated u
     join absurd.%1$I r on r.run_id = u.run_id
     join absurd.%2$I t on t.task_id = u.task_id
     order by r.available_at, u.run_id',
    'r_' || p_queue_name,
    't_' || p_queue_name,
    'w_' || p_queue_name
  );

  return query execute v_sql using v_now, v_qty, v_worker_id, v_claim_until;
end;
$$;

-- Markes a run as completed
create function absurd.complete_run (
  p_queue_name text,
  p_run_id uuid,
  p_state jsonb default null
)
  returns void
  language plpgsql
as $$
declare
  v_task_id uuid;
  v_state text;
  v_now timestamptz := absurd.current_time();
begin
  execute format(
    'select task_id, state
       from absurd.%I
      where run_id = $1
      for update',
    'r_' || p_queue_name
  )
  into v_task_id, v_state
  using p_run_id;

  if v_task_id is null then
    raise exception 'Run "%" not found in queue "%"', p_run_id, p_queue_name;
  end if;

  if v_state <> 'running' then
    if v_state = 'cancelled' then
      raise exception sqlstate 'AB001' using message = 'Task has been cancelled';
    end if;
    if v_state = 'failed' then
      raise exception sqlstate 'AB002' using message = format('Run "%s" has already failed in queue "%s"', p_run_id, p_queue_name);
    end if;
    raise exception 'Run "%" is not currently running in queue "%"', p_run_id, p_queue_name;
  end if;

  execute format(
    'update absurd.%I
        set state = ''completed'',
            completed_at = $2,
            result = $3
      where run_id = $1',
    'r_' || p_queue_name
  ) using p_run_id, v_now, p_state;

  execute format(
    'update absurd.%I
        set state = ''completed'',
            completed_payload = $2,
            last_attempt_run = $3
      where task_id = $1',
    't_' || p_queue_name
  ) using v_task_id, p_state, p_run_id;

  execute format(
    'delete from absurd.%I where run_id = $1',
    'w_' || p_queue_name
  ) using p_run_id;
end;
$$;

create function absurd.schedule_run (
  p_queue_name text,
  p_run_id uuid,
  p_wake_at timestamptz
)
  returns void
  language plpgsql
as $$
declare
  v_task_id uuid;
begin
  execute format(
    'select task_id
       from absurd.%I
      where run_id = $1
        and state = ''running''
      for update',
    'r_' || p_queue_name
  )
  into v_task_id
  using p_run_id;

  if v_task_id is null then
    raise exception 'Run "%" is not currently running in queue "%"', p_run_id, p_queue_name;
  end if;

  execute format(
    'update absurd.%I
        set state = ''sleeping'',
            claimed_by = null,
            claim_expires_at = null,
            available_at = $2,
            wake_event = null
      where run_id = $1',
    'r_' || p_queue_name
  ) using p_run_id, p_wake_at;

  execute format(
    'update absurd.%I
        set state = ''sleeping''
      where task_id = $1',
    't_' || p_queue_name
  ) using v_task_id;
end;
$$;

create function absurd.fail_run (
  p_queue_name text,
  p_run_id uuid,
  p_reason jsonb,
  p_retry_at timestamptz default null
)
  returns void
  language plpgsql
as $$
declare
  v_task_id uuid;
  v_attempt integer;
  v_run_state text;
  v_retry_strategy jsonb;
  v_max_attempts integer;
  v_now timestamptz := absurd.current_time();
  v_next_attempt integer;
  v_delay_seconds double precision := 0;
  v_next_available timestamptz;
  v_first_started timestamptz;
  v_cancellation jsonb;
  v_max_duration bigint;
  v_task_cancel boolean := false;
  v_new_run_id uuid;
  v_task_state_after text;
  v_recorded_attempt integer;
  v_last_attempt_run uuid := p_run_id;
  v_cancelled_at timestamptz := null;
begin
  execute format(
    'select r.task_id, r.attempt, r.state
       from absurd.%I r
      where r.run_id = $1
      for update',
    'r_' || p_queue_name
  )
  into v_task_id, v_attempt, v_run_state
  using p_run_id;

  if v_task_id is null then
    raise exception 'Run "%" cannot be failed in queue "%"', p_run_id, p_queue_name;
  end if;

  if v_run_state = 'cancelled' then
    raise exception sqlstate 'AB001' using message = 'Task has been cancelled';
  end if;

  if v_run_state = 'failed' then
    raise exception sqlstate 'AB002' using message = format('Run "%s" has already failed in queue "%s"', p_run_id, p_queue_name);
  end if;

  if v_run_state not in ('running', 'sleeping') then
    raise exception 'Run "%" cannot be failed in queue "%"', p_run_id, p_queue_name;
  end if;

  execute format(
    'select retry_strategy, max_attempts, first_started_at, cancellation
       from absurd.%I
      where task_id = $1
      for update',
    't_' || p_queue_name
  )
  into v_retry_strategy, v_max_attempts, v_first_started, v_cancellation
  using v_task_id;

  execute format(
    'update absurd.%I
        set state = ''failed'',
            wake_event = null,
            failed_at = $2,
            failure_reason = $3
      where run_id = $1',
    'r_' || p_queue_name
  ) using p_run_id, v_now, p_reason;

  v_next_attempt := v_attempt + 1;
  v_task_state_after := 'failed';
  v_recorded_attempt := v_attempt;

  if v_max_attempts is null or v_next_attempt <= v_max_attempts then
    if p_retry_at is not null then
      v_next_available := p_retry_at;
    else
      -- Legacy tasks may contain retry strategies that predate validation. If
      -- one is invalid, fail the task permanently rather than wedging the queue.
      begin
        v_delay_seconds := absurd.retry_delay_seconds(v_retry_strategy, v_attempt);
        v_next_available := v_now + (v_delay_seconds * interval '1 second');
      exception
        when sqlstate 'AB003' then
          v_next_available := null;
      end;
    end if;

    if v_next_available < v_now then
      v_next_available := v_now;
    end if;

    if v_cancellation is not null then
      v_max_duration := (v_cancellation->>'max_duration')::bigint;
      if v_max_duration is not null and v_first_started is not null then
        if extract(epoch from (v_next_available - v_first_started)) >= v_max_duration then
          v_task_cancel := true;
        end if;
      end if;
    end if;

    if not v_task_cancel and v_next_available is not null then
      v_task_state_after := case when v_next_available > v_now then 'sleeping' else 'pending' end;
      v_new_run_id := absurd.portable_uuidv7();
      v_recorded_attempt := v_next_attempt;
      v_last_attempt_run := v_new_run_id;
      execute format(
        'insert into absurd.%I (run_id, task_id, attempt, state, available_at, wake_event, event_payload, result, failure_reason)
         values ($1, $2, $3, $4, $5, null, null, null, null)',
        'r_' || p_queue_name
      )
      using v_new_run_id, v_task_id, v_next_attempt, v_task_state_after, v_next_available;
    end if;
  end if;

  if v_task_cancel then
    v_task_state_after := 'cancelled';
    v_cancelled_at := v_now;
    v_recorded_attempt := greatest(v_recorded_attempt, v_attempt);
    v_last_attempt_run := p_run_id;
  end if;

  execute format(
    'update absurd.%I
        set state = $2,
            attempts = greatest(attempts, $3),
            last_attempt_run = $4,
            cancelled_at = coalesce(cancelled_at, $5)
      where task_id = $1',
    't_' || p_queue_name
  ) using v_task_id, v_task_state_after, v_recorded_attempt, v_last_attempt_run, v_cancelled_at;

  execute format(
    'delete from absurd.%I where run_id = $1',
    'w_' || p_queue_name
  ) using p_run_id;
end;
$$;

-- Retries a failed task either by extending attempts on the same task or by
-- spawning a brand new task from the original inputs.
--
-- Options:
-- - spawn_new (boolean, default false): create a new task instead of retrying in-place.
-- - max_attempts (integer, optional): for in-place retry, defaults to
--   coalesce(current max_attempts, current attempts) + 1 and must be greater
--   than current attempts; for spawn_new it overrides copied max_attempts on
--   the new task.
create function absurd.retry_task (
  p_queue_name text,
  p_task_id uuid,
  p_options jsonb default '{}'::jsonb
)
  returns table (
    task_id uuid,
    run_id uuid,
    attempt integer,
    created boolean
  )
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_spawn_new boolean := false;
  v_requested_max_attempts integer;

  v_task_name text;
  v_params jsonb;
  v_headers jsonb;
  v_retry_strategy jsonb;
  v_task_max_attempts integer;
  v_cancellation jsonb;
  v_task_attempts integer;
  v_task_state text;

  v_new_run_id uuid;
  v_new_attempt integer;
  v_spawn_options jsonb;
begin
  if p_options is not null then
    if p_options ? 'spawn_new' then
      v_spawn_new := coalesce((p_options->>'spawn_new')::boolean, false);
    end if;
    if p_options ? 'max_attempts' then
      v_requested_max_attempts := (p_options->>'max_attempts')::int;
      if v_requested_max_attempts is not null and v_requested_max_attempts < 1 then
        raise exception 'max_attempts must be >= 1';
      end if;
    end if;
  end if;

  execute format(
    'select task_name,
            params,
            headers,
            retry_strategy,
            max_attempts,
            cancellation,
            attempts,
            state
       from absurd.%I
      where task_id = $1
      for update',
    't_' || p_queue_name
  )
  into v_task_name,
       v_params,
       v_headers,
       v_retry_strategy,
       v_task_max_attempts,
       v_cancellation,
       v_task_attempts,
       v_task_state
  using p_task_id;

  if v_task_state is null then
    raise exception 'Task "%" not found in queue "%"', p_task_id, p_queue_name;
  end if;

  if v_task_state <> 'failed' then
    raise exception 'Task "%" is not currently failed in queue "%"', p_task_id, p_queue_name;
  end if;

  if v_spawn_new then
    v_spawn_options := jsonb_strip_nulls(jsonb_build_object(
      'headers', v_headers,
      'retry_strategy', v_retry_strategy,
      'max_attempts', coalesce(v_requested_max_attempts, v_task_max_attempts),
      'cancellation', v_cancellation
    ));

    return query
      select s.task_id, s.run_id, s.attempt, s.created
        from absurd.spawn_task(p_queue_name, v_task_name, v_params, v_spawn_options) s;
    return;
  end if;

  if v_requested_max_attempts is null then
    v_requested_max_attempts := coalesce(v_task_max_attempts, v_task_attempts) + 1;
  end if;

  if v_requested_max_attempts <= v_task_attempts then
    raise exception 'max_attempts (%) must be greater than current attempts (%)',
      v_requested_max_attempts,
      v_task_attempts;
  end if;

  v_new_run_id := absurd.portable_uuidv7();
  v_new_attempt := v_task_attempts + 1;

  execute format(
    'insert into absurd.%I (run_id, task_id, attempt, state, available_at, wake_event, event_payload, result, failure_reason)
     values ($1, $2, $3, ''pending'', $4, null, null, null, null)',
    'r_' || p_queue_name
  )
  using v_new_run_id, p_task_id, v_new_attempt, v_now;

  execute format(
    'update absurd.%I
        set state = ''pending'',
            attempts = greatest(attempts, $2),
            max_attempts = $3,
            last_attempt_run = $4,
            cancelled_at = null
      where task_id = $1',
    't_' || p_queue_name
  )
  using p_task_id, v_new_attempt, v_requested_max_attempts, v_new_run_id;

  return query select p_task_id, v_new_run_id, v_new_attempt, false;
end;
$$;

create function absurd.set_task_checkpoint_state (
  p_queue_name text,
  p_task_id uuid,
  p_step_name text,
  p_state jsonb,
  p_owner_run uuid,
  p_extend_claim_by integer default null
)
  returns void
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_new_attempt integer;
  v_existing_attempt integer;
  v_existing_owner uuid;
  v_task_state text;
  v_run_state text;
begin
  if p_step_name is null or length(trim(p_step_name)) = 0 then
    raise exception 'step_name must be provided';
  end if;

  execute format(
    'select r.attempt, r.state, t.state
       from absurd.%I r
       join absurd.%I t on t.task_id = r.task_id
      where r.run_id = $1',
    'r_' || p_queue_name,
    't_' || p_queue_name
  )
  into v_new_attempt, v_run_state, v_task_state
  using p_owner_run;

  if v_new_attempt is null then
    raise exception 'Run "%" not found for checkpoint', p_owner_run;
  end if;

  if v_task_state = 'cancelled' then
    raise exception sqlstate 'AB001' using message = 'Task has been cancelled';
  end if;

  if v_run_state = 'failed' then
    raise exception sqlstate 'AB002' using message = format('Run "%s" has already failed in queue "%s"', p_owner_run, p_queue_name);
  end if;

  -- Extend the claim if requested
  if p_extend_claim_by is not null and p_extend_claim_by > 0 then
    execute format(
      'update absurd.%I
          set claim_expires_at = $2 + make_interval(secs => $3)
        where run_id = $1
          and state = ''running''
          and claim_expires_at is not null',
      'r_' || p_queue_name
    )
    using p_owner_run, v_now, p_extend_claim_by;
  end if;

  execute format(
    'select c.owner_run_id,
            r.attempt
       from absurd.%I c
       left join absurd.%I r on r.run_id = c.owner_run_id
      where c.task_id = $1
        and c.checkpoint_name = $2',
    'c_' || p_queue_name,
    'r_' || p_queue_name
  )
  into v_existing_owner, v_existing_attempt
  using p_task_id, p_step_name;

  if v_existing_owner is null or v_existing_attempt is null or v_new_attempt >= v_existing_attempt then
    execute format(
      'insert into absurd.%I (task_id, checkpoint_name, state, status, owner_run_id, updated_at)
       values ($1, $2, $3, ''committed'', $4, $5)
       on conflict (task_id, checkpoint_name)
       do update set state = excluded.state,
                     status = excluded.status,
                     owner_run_id = excluded.owner_run_id,
                     updated_at = excluded.updated_at',
      'c_' || p_queue_name
    ) using p_task_id, p_step_name, p_state, p_owner_run, v_now;
  end if;
end;
$$;

create function absurd.extend_claim (
  p_queue_name text,
  p_run_id uuid,
  p_extend_by integer
)
  returns void
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_task_state text;
  v_run_state text;
  v_claim_expires_at timestamptz;
begin
  if p_extend_by is null or p_extend_by <= 0 then
    raise exception 'extend_by must be > 0';
  end if;

  execute format(
    'select r.state,
            r.claim_expires_at,
            t.state
       from absurd.%I r
       join absurd.%I t on t.task_id = r.task_id
      where r.run_id = $1
      for update',
    'r_' || p_queue_name,
    't_' || p_queue_name
  )
  into v_run_state, v_claim_expires_at, v_task_state
  using p_run_id;

  if v_run_state is null then
    raise exception 'Run "%" not found in queue "%"', p_run_id, p_queue_name;
  end if;

  if v_task_state = 'cancelled' then
    raise exception sqlstate 'AB001' using message = 'Task has been cancelled';
  end if;

  if v_run_state <> 'running' then
    if v_run_state = 'failed' then
      raise exception sqlstate 'AB002' using message = format('Run "%s" has already failed in queue "%s"', p_run_id, p_queue_name);
    end if;
    raise exception 'Run "%" is not currently running in queue "%"', p_run_id, p_queue_name;
  end if;

  if v_claim_expires_at is null then
    raise exception 'Run "%" does not have an active claim in queue "%"', p_run_id, p_queue_name;
  end if;

  execute format(
    'update absurd.%I
        set claim_expires_at = $2 + make_interval(secs => $3)
      where run_id = $1',
    'r_' || p_queue_name
  )
  using p_run_id, v_now, p_extend_by;
end;
$$;

-- Returns one checkpoint by name. By default only committed checkpoint rows
-- are visible; pass p_include_pending = true to include pending rows.
create function absurd.get_task_checkpoint_state (
  p_queue_name text,
  p_task_id uuid,
  p_step_name text,
  p_include_pending boolean default false
)
  returns table (
    checkpoint_name text,
    state jsonb,
    status text,
    owner_run_id uuid,
    updated_at timestamptz
  )
  language plpgsql
as $$
begin
  return query execute format(
    'select checkpoint_name, state, status, owner_run_id, updated_at
       from absurd.%I
      where task_id = $1
        and checkpoint_name = $2
        and ($3 or status = ''committed'')',
    'c_' || p_queue_name
  ) using p_task_id, p_step_name, coalesce(p_include_pending, false);
end;
$$;

-- Returns committed checkpoints visible to the given run. The run must belong
-- to the provided task, and checkpoints from later attempts are hidden.
create function absurd.get_task_checkpoint_states (
  p_queue_name text,
  p_task_id uuid,
  p_run_id uuid
)
  returns table (
    checkpoint_name text,
    state jsonb,
    status text,
    owner_run_id uuid,
    updated_at timestamptz
  )
  language plpgsql
as $$
declare
  v_run_task_id uuid;
  v_run_attempt integer;
begin
  execute format(
    'select task_id, attempt
       from absurd.%I
      where run_id = $1',
    'r_' || p_queue_name
  )
  into v_run_task_id, v_run_attempt
  using p_run_id;

  if v_run_task_id is null then
    raise exception 'Run "%" not found in queue "%"', p_run_id, p_queue_name;
  end if;

  if v_run_task_id <> p_task_id then
    raise exception 'Run "%" does not belong to task "%" in queue "%"', p_run_id, p_task_id, p_queue_name;
  end if;

  return query execute format(
    'select c.checkpoint_name,
            c.state,
            c.status,
            c.owner_run_id,
            c.updated_at
       from absurd.%1$I c
       left join absurd.%2$I owner_run on owner_run.run_id = c.owner_run_id
      where c.task_id = $1
        and c.status = ''committed''
        and (owner_run.attempt is null or owner_run.attempt <= $2)
      order by c.updated_at asc',
    'c_' || p_queue_name,
    'r_' || p_queue_name
  ) using p_task_id, v_run_attempt;
end;
$$;

create function absurd.await_event (
  p_queue_name text,
  p_task_id uuid,
  p_run_id uuid,
  p_step_name text,
  p_event_name text,
  p_timeout integer default null
)
  returns table (
    should_suspend boolean,
    payload jsonb
  )
  language plpgsql
as $$
declare
  v_run_state text;
  v_existing_payload jsonb;
  v_event_payload jsonb;
  v_checkpoint_payload jsonb;
  v_resolved_payload jsonb;
  v_timeout_at timestamptz;
  v_available_at timestamptz;
  v_now timestamptz := absurd.current_time();
  v_task_state text;
  v_wake_event text;
begin
  if p_event_name is null or length(trim(p_event_name)) = 0 then
    raise exception 'event_name must be provided';
  end if;

  if p_timeout is not null then
    if p_timeout < 0 then
      raise exception 'timeout must be non-negative';
    end if;
    v_timeout_at := v_now + (p_timeout::double precision * interval '1 second');
  end if;

  v_available_at := coalesce(v_timeout_at, 'infinity'::timestamptz);

  execute format(
    'select state
       from absurd.%I
      where task_id = $1
        and checkpoint_name = $2',
    'c_' || p_queue_name
  )
  into v_checkpoint_payload
  using p_task_id, p_step_name;

  if v_checkpoint_payload is not null then
    return query select false, v_checkpoint_payload;
    return;
  end if;

  -- Ensure a row exists for this event so we can take a row-level lock.
  --
  -- We use payload IS NULL as the sentinel for "not emitted yet".  emit_event
  -- always writes a non-NULL payload (at minimum JSON null).
  --
  -- Lock ordering is important to avoid deadlocks: await_event locks the event
  -- row first (FOR SHARE) and then the run row (FOR UPDATE).  emit_event
  -- naturally locks the event row via its UPSERT before touching waits/runs.
  execute format(
    'insert into absurd.%I (event_name, payload, emitted_at)
     values ($1, null, ''epoch''::timestamptz)
     on conflict (event_name) do nothing',
    'e_' || p_queue_name
  ) using p_event_name;

  execute format(
    'select 1
       from absurd.%I
      where event_name = $1
      for share',
    'e_' || p_queue_name
  ) using p_event_name;

  execute format(
    'select r.state, r.event_payload, r.wake_event, t.state
       from absurd.%I r
       join absurd.%I t on t.task_id = r.task_id
      where r.run_id = $1
      for update',
    'r_' || p_queue_name,
    't_' || p_queue_name
  )
  into v_run_state, v_existing_payload, v_wake_event, v_task_state
  using p_run_id;

  if v_run_state is null then
    raise exception 'Run "%" not found while awaiting event', p_run_id;
  end if;

  if v_task_state = 'cancelled' then
    raise exception sqlstate 'AB001' using message = 'Task has been cancelled';
  end if;

  execute format(
    'select payload
       from absurd.%I
      where event_name = $1',
    'e_' || p_queue_name
  )
  into v_event_payload
  using p_event_name;

  if v_existing_payload is not null then
    execute format(
      'update absurd.%I
          set event_payload = null
        where run_id = $1',
      'r_' || p_queue_name
    ) using p_run_id;

    if v_event_payload is not null and v_event_payload = v_existing_payload then
      v_resolved_payload := v_existing_payload;
    end if;
  end if;

  if v_run_state <> 'running' then
    raise exception 'Run "%" must be running to await events', p_run_id;
  end if;

  if v_resolved_payload is null and v_event_payload is not null then
    v_resolved_payload := v_event_payload;
  end if;

  if v_resolved_payload is not null then
    execute format(
      'insert into absurd.%I (task_id, checkpoint_name, state, status, owner_run_id, updated_at)
       values ($1, $2, $3, ''committed'', $4, $5)
       on conflict (task_id, checkpoint_name)
       do update set state = excluded.state,
                     status = excluded.status,
                     owner_run_id = excluded.owner_run_id,
                     updated_at = excluded.updated_at',
      'c_' || p_queue_name
    ) using p_task_id, p_step_name, v_resolved_payload, p_run_id, v_now;
    return query select false, v_resolved_payload;
    return;
  end if;

  -- Detect if we resumed due to timeout: wake_event matches and payload is null
  if v_resolved_payload is null and v_wake_event = p_event_name and v_existing_payload is null then
    -- Resumed due to timeout; don't re-sleep and don't create a new wait
    execute format(
      'update absurd.%I set wake_event = null where run_id = $1',
      'r_' || p_queue_name
    ) using p_run_id;
    return query select false, null::jsonb;
    return;
  end if;

  execute format(
    'insert into absurd.%I (task_id, run_id, step_name, event_name, timeout_at, created_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (run_id, step_name)
     do update set event_name = excluded.event_name,
                   timeout_at = excluded.timeout_at,
                   created_at = excluded.created_at',
    'w_' || p_queue_name
  ) using p_task_id, p_run_id, p_step_name, p_event_name, v_timeout_at, v_now;

  execute format(
    'update absurd.%I
        set state = ''sleeping'',
            claimed_by = null,
            claim_expires_at = null,
            available_at = $3,
            wake_event = $2,
            event_payload = null
      where run_id = $1',
    'r_' || p_queue_name
  ) using p_run_id, p_event_name, v_available_at;

  execute format(
    'update absurd.%I
        set state = ''sleeping''
      where task_id = $1',
    't_' || p_queue_name
  ) using p_task_id;

  return query select true, null::jsonb;
  return;
end;
$$;

create function absurd.emit_event (
  p_queue_name text,
  p_event_name text,
  p_payload jsonb default null
)
  returns void
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_payload jsonb := coalesce(p_payload, 'null'::jsonb);
  v_emit_applied integer;
begin
  if p_event_name is null or length(trim(p_event_name)) = 0 then
    raise exception 'event_name must be provided';
  end if;

  -- Events are immutable once emitted: first write wins.
  --
  -- await_event() may pre-create a row with payload=NULL as a "not emitted"
  -- sentinel. We allow exactly one transition NULL -> JSON payload.
  execute format(
    'insert into absurd.%1$I as e (event_name, payload, emitted_at)
     values ($1, $2, $3)
     on conflict (event_name)
     do update set payload = excluded.payload,
                   emitted_at = excluded.emitted_at
      where e.payload is null',
    'e_' || p_queue_name
  ) using p_event_name, v_payload, v_now;

  get diagnostics v_emit_applied = row_count;

  -- Event was already emitted earlier; do not overwrite cached payload or
  -- re-run wakeup side effects.
  if v_emit_applied = 0 then
    return;
  end if;

  execute format(
    'with expired_waits as (
        delete from absurd.%1$I w
         where w.event_name = $1
           and w.timeout_at is not null
           and w.timeout_at <= $2
         returning w.run_id
     ),
     affected as (
        select run_id, task_id, step_name
          from absurd.%1$I
         where event_name = $1
           and (timeout_at is null or timeout_at > $2)
     ),
     updated_runs as (
        update absurd.%2$I r
           set state = ''pending'',
               available_at = $2,
               wake_event = null,
               event_payload = $3,
               claimed_by = null,
               claim_expires_at = null
         where r.run_id in (select run_id from affected)
           and r.state = ''sleeping''
         returning r.run_id, r.task_id
     ),
     checkpoint_upd as (
        insert into absurd.%3$I (task_id, checkpoint_name, state, status, owner_run_id, updated_at)
        select a.task_id, a.step_name, $3, ''committed'', a.run_id, $2
          from affected a
          join updated_runs ur on ur.run_id = a.run_id
        on conflict (task_id, checkpoint_name)
        do update set state = excluded.state,
                      status = excluded.status,
                      owner_run_id = excluded.owner_run_id,
                      updated_at = excluded.updated_at
     ),
     updated_tasks as (
        update absurd.%4$I t
           set state = ''pending''
         where t.task_id in (select task_id from updated_runs)
         returning task_id
     )
     delete from absurd.%5$I w
      where w.event_name = $1
        and w.run_id in (select run_id from updated_runs)',
    'w_' || p_queue_name,
    'r_' || p_queue_name,
    'c_' || p_queue_name,
    't_' || p_queue_name,
    'w_' || p_queue_name
  ) using p_event_name, v_now, v_payload;
end;
$$;

-- Manually cancels a task by its task_id.
-- Sets the task state to 'cancelled' and prevents any future runs.
-- Currently running code will detect cancellation at the next checkpoint or heartbeat.
create function absurd.cancel_task (
  p_queue_name text,
  p_task_id uuid
)
  returns void
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_task_state text;
begin
  -- Lock active runs before the task row so cancel_task() uses the same
  -- lock acquisition order as complete_run()/fail_run().
  execute format(
    'select run_id
       from absurd.%I
      where task_id = $1
        and state not in (''completed'', ''failed'', ''cancelled'')
      order by run_id
      for update',
    'r_' || p_queue_name
  ) using p_task_id;

  execute format(
    'select state
       from absurd.%I
      where task_id = $1
      for update',
    't_' || p_queue_name
  )
  into v_task_state
  using p_task_id;

  if v_task_state is null then
    raise exception 'Task "%" not found in queue "%"', p_task_id, p_queue_name;
  end if;

  if v_task_state in ('completed', 'failed', 'cancelled') then
    return;
  end if;

  execute format(
    'update absurd.%I
        set state = ''cancelled'',
            cancelled_at = coalesce(cancelled_at, $2)
      where task_id = $1',
    't_' || p_queue_name
  ) using p_task_id, v_now;

  execute format(
    'update absurd.%I
        set state = ''cancelled'',
            claimed_by = null,
            claim_expires_at = null
      where task_id = $1
        and state not in (''completed'', ''failed'', ''cancelled'')',
    'r_' || p_queue_name
  ) using p_task_id;

  execute format(
    'delete from absurd.%I where task_id = $1',
    'w_' || p_queue_name
  ) using p_task_id;
end;
$$;

-- Runs one cleanup batch for all queues (or one specific queue), using
-- per-queue policy stored in absurd.queues.
create function absurd.cleanup_all_queues (
  p_queue_name text default null
)
  returns table (
    queue_name text,
    tasks_deleted integer,
    events_deleted integer
  )
  language plpgsql
as $$
declare
  v_queue record;
  v_cleanup_ttl_seconds integer;
begin
  if p_queue_name is not null then
    p_queue_name := absurd.validate_queue_name(p_queue_name);

    if not exists (
      select 1
      from absurd.queues q
      where q.queue_name = p_queue_name
    ) then
      raise exception 'Queue "%" does not exist', p_queue_name;
    end if;
  end if;

  for v_queue in
    select
      q.queue_name,
      q.cleanup_ttl,
      q.cleanup_limit
    from absurd.queues q
    where p_queue_name is null or q.queue_name = p_queue_name
    order by q.queue_name
  loop
    v_cleanup_ttl_seconds := greatest(
      floor(extract(epoch from v_queue.cleanup_ttl))::integer,
      0
    );

    queue_name := v_queue.queue_name;
    tasks_deleted := absurd.cleanup_tasks(
      v_queue.queue_name,
      v_cleanup_ttl_seconds,
      v_queue.cleanup_limit
    );
    events_deleted := absurd.cleanup_events(
      v_queue.queue_name,
      v_cleanup_ttl_seconds,
      v_queue.cleanup_limit
    );
    return next;
  end loop;
end;
$$;

-- Cleans up old completed, failed, or cancelled tasks and their related data.
-- Deletes tasks whose terminal timestamp (completed_at, failed_at, or cancelled_at)
-- is older than the specified TTL in seconds.
--
-- Returns the number of tasks deleted.
create function absurd.cleanup_tasks (
  p_queue_name text,
  p_ttl_seconds integer,
  p_limit integer default 1000
)
  returns integer
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_cutoff timestamptz;
  v_deleted_count integer;
  v_storage_mode text := 'unpartitioned';
begin
  if p_ttl_seconds is null or p_ttl_seconds < 0 then
    raise exception 'TTL must be a non-negative number of seconds';
  end if;

  v_cutoff := v_now - (p_ttl_seconds * interval '1 second');

  select storage_mode into v_storage_mode
  from absurd.queues
  where queue_name = p_queue_name;

  v_storage_mode := coalesce(v_storage_mode, 'unpartitioned');

  if v_storage_mode = 'partitioned' then
    -- Delete in order: wait registrations, checkpoints, runs, idempotency keys,
    -- then tasks.
    execute format(
      'with eligible_tasks as (
          select t.task_id,
                 case
                   when t.state = ''completed'' then r.completed_at
                   when t.state = ''failed'' then r.failed_at
                   when t.state = ''cancelled'' then t.cancelled_at
                   else null
                 end as terminal_at
            from absurd.%1$I t
            left join absurd.%2$I r on r.run_id = t.last_attempt_run
           where t.state in (''completed'', ''failed'', ''cancelled'')
       ),
       to_delete as (
          select task_id
            from eligible_tasks
           where terminal_at is not null
             and terminal_at < $1
           order by terminal_at
           limit $2
       ),
       del_waits as (
          delete from absurd.%3$I w
           where w.task_id in (select task_id from to_delete)
       ),
       del_checkpoints as (
          delete from absurd.%4$I c
           where c.task_id in (select task_id from to_delete)
       ),
       del_runs as (
          delete from absurd.%2$I r
           where r.task_id in (select task_id from to_delete)
       ),
       del_idempotency as (
          delete from absurd.%5$I i
           where i.task_id in (select task_id from to_delete)
       ),
       del_tasks as (
          delete from absurd.%1$I t
           where t.task_id in (select task_id from to_delete)
           returning 1
       )
       select count(*) from del_tasks',
      't_' || p_queue_name,
      'r_' || p_queue_name,
      'w_' || p_queue_name,
      'c_' || p_queue_name,
      'i_' || p_queue_name
    )
    into v_deleted_count
    using v_cutoff, p_limit;
  else
    -- Unpartitioned queues keep idempotency key ownership on the task row,
    -- so no side-table cleanup is needed.
    execute format(
      'with eligible_tasks as (
          select t.task_id,
                 case
                   when t.state = ''completed'' then r.completed_at
                   when t.state = ''failed'' then r.failed_at
                   when t.state = ''cancelled'' then t.cancelled_at
                   else null
                 end as terminal_at
            from absurd.%1$I t
            left join absurd.%2$I r on r.run_id = t.last_attempt_run
           where t.state in (''completed'', ''failed'', ''cancelled'')
       ),
       to_delete as (
          select task_id
            from eligible_tasks
           where terminal_at is not null
             and terminal_at < $1
           order by terminal_at
           limit $2
       ),
       del_waits as (
          delete from absurd.%3$I w
           where w.task_id in (select task_id from to_delete)
       ),
       del_checkpoints as (
          delete from absurd.%4$I c
           where c.task_id in (select task_id from to_delete)
       ),
       del_runs as (
          delete from absurd.%2$I r
           where r.task_id in (select task_id from to_delete)
       ),
       del_tasks as (
          delete from absurd.%1$I t
           where t.task_id in (select task_id from to_delete)
           returning 1
       )
       select count(*) from del_tasks',
      't_' || p_queue_name,
      'r_' || p_queue_name,
      'w_' || p_queue_name,
      'c_' || p_queue_name
    )
    into v_deleted_count
    using v_cutoff, p_limit;
  end if;

  return v_deleted_count;
end;
$$;

-- Cleans up old emitted events.
-- Deletes events whose emitted_at timestamp is older than the specified TTL in seconds.
--
-- Returns the number of events deleted.
create function absurd.cleanup_events (
  p_queue_name text,
  p_ttl_seconds integer,
  p_limit integer default 1000
)
  returns integer
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_cutoff timestamptz;
  v_deleted_count integer;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 0 then
    raise exception 'TTL must be a non-negative number of seconds';
  end if;

  v_cutoff := v_now - (p_ttl_seconds * interval '1 second');

  execute format(
    'with to_delete as (
        select event_name
          from absurd.%I
         where emitted_at < $1
         order by emitted_at
         limit $2
     ),
     del_events as (
        delete from absurd.%I e
         where e.event_name in (select event_name from to_delete)
         returning 1
     )
     select count(*) from del_events',
    'e_' || p_queue_name,
    'e_' || p_queue_name
  )
  into v_deleted_count
  using v_cutoff, p_limit;

  return v_deleted_count;
end;
$$;

-- utility function to generate a uuidv7 even for older postgres versions.
create function absurd.portable_uuidv7 ()
  returns uuid
  language plpgsql
  volatile
as $$
declare
  ts_ms bigint;
  b bytea;
  rnd bytea;
  i int;
begin
  if to_regprocedure('pg_catalog.uuidv7()') is not null then
    return pg_catalog.uuidv7 ();
  end if;
  ts_ms := floor(extract(epoch from absurd.current_time()) * 1000)::bigint;
  rnd := uuid_send(pg_catalog.gen_random_uuid ());
  b := repeat(E'\\000', 16)::bytea;
  for i in 0..5 loop
    b := set_byte(b, i, ((ts_ms >> ((5 - i) * 8)) & 255)::int);
  end loop;
  for i in 6..15 loop
    b := set_byte(b, i, get_byte(rnd, i));
  end loop;
  b := set_byte(b, 6, ((get_byte(b, 6) & 15) | (7 << 4)));
  b := set_byte(b, 8, ((get_byte(b, 8) & 63) | 128));
  return encode(b, 'hex')::uuid;
end;
$$;

-- Extracts the embedded timestamp from a UUIDv7 value.
-- Returns NULL for non-v7 UUIDs.
create function absurd.uuidv7_timestamp (p_id uuid)
  returns timestamptz
  language sql
  immutable
  strict
as $$
  with bytes as (
    select uuid_send(p_id) as b
  ),
  decoded as (
    select
      (get_byte(b, 6) >> 4) as version,
      ((get_byte(b, 0)::bigint << 40) |
       (get_byte(b, 1)::bigint << 32) |
       (get_byte(b, 2)::bigint << 24) |
       (get_byte(b, 3)::bigint << 16) |
       (get_byte(b, 4)::bigint << 8)  |
        get_byte(b, 5)::bigint) as ts_ms
    from bytes
  )
  select case
           when version = 7 then 'epoch'::timestamptz + (ts_ms * interval '1 millisecond')
           else null
         end
  from decoded;
$$;

-- Returns the lowest UUIDv7 value representable for the given timestamp.
-- This is useful for time-window partition bounds over UUIDv7 keys.
create function absurd.uuidv7_floor (p_ts timestamptz)
  returns uuid
  language plpgsql
  immutable
  strict
as $$
declare
  ts_ms bigint := floor(extract(epoch from p_ts) * 1000)::bigint;
  b bytea;
  i int;
begin
  if ts_ms < 0 or ts_ms > 281474976710655 then
    raise exception 'Timestamp "%" is outside UUIDv7 supported range', p_ts;
  end if;

  b := repeat(E'\\000', 16)::bytea;
  for i in 0..5 loop
    b := set_byte(b, i, ((ts_ms >> ((5 - i) * 8)) & 255)::int);
  end loop;

  -- Set UUIDv7 version and RFC4122 variant; keep all randomness bits at 0.
  b := set_byte(b, 6, (7 << 4));
  b := set_byte(b, 8, 128);

  return encode(b, 'hex')::uuid;
end;
$$;

-- Buckets a timestamp to ISO week start (Monday 00:00) in UTC.
create function absurd.week_bucket_utc (p_ts timestamptz)
  returns timestamptz
  language sql
  immutable
  strict
as $$
  select date_trunc('week', p_ts at time zone 'UTC') at time zone 'UTC';
$$;

-- Returns a compact weekly partition tag in YWW format, where:
-- * Y = last digit of the ISO year in UTC
-- * WW = zero-padded ISO week number in UTC (01..53)
--
-- ISO weeks do not have week 0; days at year boundaries can belong
-- to week 52/53 of the previous ISO year.
--
-- Examples:
-- * 2024-01-01 UTC -> 401
-- * 2021-01-01 UTC -> 053 (ISO week 53 of ISO year 2020)
create function absurd.partition_week_tag (p_ts timestamptz)
  returns text
  language sql
  immutable
  strict
as $$
  with bucket as (
    select absurd.week_bucket_utc(p_ts) at time zone 'UTC' as ts
  )
  select
    ((extract(isoyear from ts)::int % 10)::text) ||
    lpad((extract(week from ts)::int)::text, 2, '0')
  from bucket;
$$;

-- Ensures weekly UUIDv7 partitions exist for partitioned queues.
--
-- Window selection is queue-policy driven:
-- * start = week_bucket_utc(now() - partition_lookback)
-- * end   = week_bucket_utc(now() + partition_lookahead)
create function absurd.ensure_partitions (
  p_queue_name text default null
)
  returns void
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_partition_tag text;
  v_uuid_from uuid;
  v_uuid_to uuid;
  v_queue record;
begin
  if p_queue_name is not null then
    p_queue_name := absurd.validate_queue_name(p_queue_name);

    if not exists (
      select 1
      from absurd.queues q
      where q.queue_name = p_queue_name
    ) then
      raise exception 'Queue "%" does not exist', p_queue_name;
    end if;
  end if;

  for v_queue in
    select
      queue_name,
      default_partition,
      partition_lookahead,
      partition_lookback
    from absurd.queues
    where storage_mode = 'partitioned'
      and (p_queue_name is null or queue_name = p_queue_name)
    order by queue_name
  loop
    v_window_start := absurd.week_bucket_utc(v_now - v_queue.partition_lookback);
    v_window_end := absurd.week_bucket_utc(v_now + v_queue.partition_lookahead);

    if v_queue.default_partition = 'enabled' then
      execute format(
        'create table if not exists absurd.%I partition of absurd.%I default',
        't_' || v_queue.queue_name || '_d',
        't_' || v_queue.queue_name
      );
      execute format(
        'create table if not exists absurd.%I partition of absurd.%I default',
        'r_' || v_queue.queue_name || '_d',
        'r_' || v_queue.queue_name
      );
      execute format(
        'create table if not exists absurd.%I partition of absurd.%I default',
        'c_' || v_queue.queue_name || '_d',
        'c_' || v_queue.queue_name
      );
      execute format(
        'create table if not exists absurd.%I partition of absurd.%I default',
        'w_' || v_queue.queue_name || '_d',
        'w_' || v_queue.queue_name
      );
    end if;

    v_week_start := v_window_start;
    while v_week_start <= v_window_end loop
      v_week_end := v_week_start + interval '7 days';
      v_partition_tag := absurd.partition_week_tag(v_week_start);
      v_uuid_from := absurd.uuidv7_floor(v_week_start);
      v_uuid_to := absurd.uuidv7_floor(v_week_end);

      execute format(
        'create table if not exists absurd.%I partition of absurd.%I
         for values from (%L::uuid) to (%L::uuid)',
        't_' || v_queue.queue_name || '_' || v_partition_tag,
        't_' || v_queue.queue_name,
        v_uuid_from,
        v_uuid_to
      );
      execute format(
        'create table if not exists absurd.%I partition of absurd.%I
         for values from (%L::uuid) to (%L::uuid)',
        'r_' || v_queue.queue_name || '_' || v_partition_tag,
        'r_' || v_queue.queue_name,
        v_uuid_from,
        v_uuid_to
      );
      execute format(
        'create table if not exists absurd.%I partition of absurd.%I
         for values from (%L::uuid) to (%L::uuid)',
        'c_' || v_queue.queue_name || '_' || v_partition_tag,
        'c_' || v_queue.queue_name,
        v_uuid_from,
        v_uuid_to
      );
      execute format(
        'create table if not exists absurd.%I partition of absurd.%I
         for values from (%L::uuid) to (%L::uuid)',
        'w_' || v_queue.queue_name || '_' || v_partition_tag,
        'w_' || v_queue.queue_name,
        v_uuid_from,
        v_uuid_to
      );

      v_week_start := v_week_end;
    end loop;
  end loop;
end;
$$;

-- Lists eligible partition tables for detach/drop planning.
--
-- This does not execute detach directly.
-- Callers should construct SQL locally from parent/partition names.
create function absurd.list_detach_candidates (
  p_queue_name text default null
)
  returns table (
    queue_name text,
    parent_table text,
    partition_table text
  )
  language plpgsql
as $$
declare
  v_now timestamptz := absurd.current_time();
  v_queue record;
  v_parent_prefix text;
  v_parent_table text;
  v_parent_oid oid;
  v_part record;
  v_upper_uuid uuid;
  v_upper_ts timestamptz;
  v_has_rows boolean;
begin
  if p_queue_name is not null then
    p_queue_name := absurd.validate_queue_name(p_queue_name);

    if not exists (
      select 1
      from absurd.queues q
      where q.queue_name = p_queue_name
    ) then
      raise exception 'Queue "%" does not exist', p_queue_name;
    end if;
  end if;

  for v_queue in
    select
      q.queue_name,
      q.detach_mode,
      q.detach_min_age
    from absurd.queues q
    where q.storage_mode = 'partitioned'
      and q.detach_mode = 'empty'
      and (p_queue_name is null or q.queue_name = p_queue_name)
    order by q.queue_name
  loop
    foreach v_parent_prefix in array array['t', 'r', 'c', 'w'] loop
      v_parent_table := v_parent_prefix || '_' || v_queue.queue_name;

      select c.oid
        into v_parent_oid
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'absurd'
         and c.relname = v_parent_table;

      if v_parent_oid is null then
        continue;
      end if;

      for v_part in
        select
          child.relname as partition_name,
          pg_get_expr(child.relpartbound, child.oid) as part_bound
        from pg_inherits inh
        join pg_class child on child.oid = inh.inhrelid
        where inh.inhparent = v_parent_oid
      loop
        if v_part.part_bound = 'DEFAULT' then
          continue;
        end if;

        select
          (regexp_match(v_part.part_bound, 'TO \(''([^'']+)''(::uuid)?\)'))[1]::uuid
          into v_upper_uuid;

        if v_upper_uuid is null then
          continue;
        end if;

        v_upper_ts := absurd.uuidv7_timestamp(v_upper_uuid);

        if v_upper_ts is null then
          continue;
        end if;

        if v_upper_ts >= (v_now - v_queue.detach_min_age) then
          continue;
        end if;

        execute format(
          'select exists (select 1 from absurd.%I limit 1)',
          v_part.partition_name
        )
        into v_has_rows;

        if coalesce(v_has_rows, false) then
          continue;
        end if;

        queue_name := v_queue.queue_name;
        parent_table := v_parent_table;
        partition_table := v_part.partition_name;
        return next;
      end loop;
    end loop;
  end loop;
end;
$$;

-- Drops a detached partition table if it is no longer attached.
--
-- Returns true when the table was dropped. If p_unschedule_job_name is
-- provided and pg_cron is available, the matching cron job is unscheduled
-- once the partition is gone. The paired detach job (if derivable from
-- p_unschedule_job_name) is unscheduled as soon as the partition is observed
-- detached so DETACH does not keep retrying.
create function absurd.drop_detached_partition (
  p_partition_table text,
  p_unschedule_job_name text default null
)
  returns boolean
  language plpgsql
as $$
declare
  v_partition_table text := nullif(trim(coalesce(p_partition_table, '')), '');
  v_partition_oid oid;
  v_is_attached boolean := false;
  v_detach_job_name text;
begin
  if p_unschedule_job_name like 'absurd_drop_run_%' then
    v_detach_job_name :=
      'absurd_detach_run_' || substr(p_unschedule_job_name, length('absurd_drop_run_') + 1);
  end if;

  if v_partition_table is null then
    raise exception 'partition table must be provided';
  end if;

  select c.oid
    into v_partition_oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'absurd'
     and c.relname = v_partition_table;

  if v_partition_oid is null then
    if p_unschedule_job_name is not null and to_regclass('cron.job') is not null then
      perform cron.unschedule(jobid)
        from cron.job
       where jobname in (p_unschedule_job_name, coalesce(v_detach_job_name, ''));
    end if;
    return false;
  end if;

  select exists (
    select 1
    from pg_inherits
    where inhrelid = v_partition_oid
  )
  into v_is_attached;

  if v_is_attached then
    return false;
  end if;

  -- Once detached, stop retrying detach runs immediately. Keep drop
  -- scheduled until the table is actually dropped.
  if v_detach_job_name is not null and to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid)
      from cron.job
     where jobname = v_detach_job_name;
  end if;

  execute format('drop table if exists absurd.%I', v_partition_table);

  if p_unschedule_job_name is not null and to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid)
      from cron.job
     where jobname = p_unschedule_job_name;
  end if;

  return true;
end;
$$;

-- Schedules per-parent one-at-a-time cron jobs for detach/drop.
--
-- For each parent table, only the oldest eligible partition is scheduled and
-- only when there is no active detach/drop job for that parent.
--
-- Detach jobs run the raw DETACH statement. They use CONCURRENTLY when
-- possible; if a parent still has an attached DEFAULT partition, they fall
-- back to non-concurrent DETACH (Postgres limitation).
--
-- Drop jobs poll via absurd.drop_detached_partition(); once a partition is
-- detached, that function unschedules the paired detach job immediately and
-- keeps retrying drop until the table is gone.
create function absurd.schedule_detach_jobs (
  p_queue_name text default null
)
  returns table (
    job_name text,
    job_id bigint,
    queue_name text,
    partition_table text,
    job_kind text
  )
  language plpgsql
as $$
declare
  v_scope text;
  v_candidate record;
  v_parent_key text;
  v_candidate_key text;
  v_detach_job_name text;
  v_drop_job_name text;
  v_detach_command text;
  v_drop_command text;
  v_parent_has_default_partition boolean;
  v_job_id bigint;
begin
  if p_queue_name is not null then
    p_queue_name := absurd.validate_queue_name(p_queue_name);
  end if;

  if to_regclass('cron.job') is null then
    raise exception 'pg_cron is not available (missing cron.job)';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'schedule'
  ) then
    raise exception 'pg_cron is not available (missing cron.schedule)';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'unschedule'
  ) then
    raise exception 'pg_cron is not available (missing cron.unschedule)';
  end if;

  v_scope := case
    when p_queue_name is null then 'all'
    else substr(md5(p_queue_name), 1, 12)
  end;

  for v_candidate in
    with candidates as (
      select
        c.*,
        absurd.uuidv7_timestamp(
          (regexp_match(
            pg_get_expr(child.relpartbound, child.oid),
            'TO \(''([^'']+)''(::uuid)?\)'
          ))[1]::uuid
        ) as upper_ts
      from absurd.list_detach_candidates(p_queue_name) c
      join pg_class child on child.relname = c.partition_table
      join pg_namespace n on n.oid = child.relnamespace
      where n.nspname = 'absurd'
    ),
    ranked as (
      select
        candidates.*,
        row_number() over (
          partition by candidates.parent_table
          order by candidates.upper_ts asc nulls last, candidates.partition_table asc
        ) as rn
      from candidates
    )
    select
      ranked.queue_name,
      ranked.parent_table,
      ranked.partition_table
    from ranked
    where ranked.rn = 1
    order by ranked.queue_name, ranked.parent_table, ranked.partition_table
  loop
    v_parent_key := substr(md5(v_candidate.parent_table), 1, 8);

    -- Only one active detach pipeline per parent table.
    if exists (
      select 1
      from cron.job
      where jobname like ('absurd_detach_run_%_' || v_parent_key || '_%')
         or jobname like ('absurd_drop_run_%_' || v_parent_key || '_%')
    ) then
      continue;
    end if;

    v_candidate_key := substr(
      md5(v_candidate.parent_table || ':' || v_candidate.partition_table),
      1,
      12
    );

    v_detach_job_name := format(
      'absurd_detach_run_%s_%s_%s',
      v_scope,
      v_parent_key,
      v_candidate_key
    );
    v_drop_job_name := format(
      'absurd_drop_run_%s_%s_%s',
      v_scope,
      v_parent_key,
      v_candidate_key
    );

    if not exists (
      select 1
      from cron.job
      where jobname = v_detach_job_name
         or jobname like ('absurd_detach_run_%_' || v_candidate_key)
    ) then
      select exists (
        select 1
        from pg_class parent
        join pg_namespace pn on pn.oid = parent.relnamespace
        join pg_inherits inh on inh.inhparent = parent.oid
        join pg_class child on child.oid = inh.inhrelid
        where pn.nspname = 'absurd'
          and parent.relname = v_candidate.parent_table
          and pg_get_expr(child.relpartbound, child.oid) = 'DEFAULT'
      )
      into v_parent_has_default_partition;

      v_detach_command := format(
        'alter table absurd.%I detach partition absurd.%I',
        v_candidate.parent_table,
        v_candidate.partition_table
      );

      if not coalesce(v_parent_has_default_partition, false) then
        v_detach_command := v_detach_command || ' concurrently';
      end if;

      execute 'select cron.schedule($1, $2, $3)'
        into v_job_id
        using v_detach_job_name, '* * * * *', v_detach_command;

      job_name := v_detach_job_name;
      job_id := v_job_id;
      queue_name := v_candidate.queue_name;
      partition_table := v_candidate.partition_table;
      job_kind := 'detach';
      return next;
    end if;

    if not exists (
      select 1
      from cron.job
      where jobname = v_drop_job_name
         or jobname like ('absurd_drop_run_%_' || v_candidate_key)
    ) then
      v_drop_command := format(
        'select absurd.drop_detached_partition(%L, %L);',
        v_candidate.partition_table,
        v_drop_job_name
      );

      execute 'select cron.schedule($1, $2, $3)'
        into v_job_id
        using v_drop_job_name, '* * * * *', v_drop_command;

      job_name := v_drop_job_name;
      job_id := v_job_id;
      queue_name := v_candidate.queue_name;
      partition_table := v_candidate.partition_table;
      job_kind := 'drop';
      return next;
    end if;
  end loop;
end;
$$;

-- Configures pg_cron jobs for partition provisioning, cleanup, and detach planning.
--
-- Detach planning schedules per-partition jobs (via absurd.schedule_detach_jobs)
-- that run raw DETACH statements and follow-up drop checks.
--
-- Requires pg_cron to be installed (or compatible cron schema/functions).
create function absurd.enable_cron (
  p_queue_name text default null,
  p_partition_schedule text default '5 * * * *',
  p_cleanup_schedule text default '17 * * * *',
  p_detach_schedule text default '29 * * * *'
)
  returns table (
    job_name text,
    job_id bigint
  )
  language plpgsql
as $$
declare
  v_queue_exists boolean := false;
  v_queue_literal text;
  v_partition_job_name text;
  v_cleanup_job_name text;
  v_detach_plan_job_name text;
  v_partition_command text;
  v_cleanup_command text;
  v_detach_plan_command text;
  v_partitions_job_id bigint;
  v_cleanup_job_id bigint;
  v_detach_plan_job_id bigint;
  v_existing_job_id bigint;
  v_job_suffix text;
begin
  if p_queue_name is not null then
    p_queue_name := absurd.validate_queue_name(p_queue_name);

    select exists (
      select 1
      from absurd.queues
      where queue_name = p_queue_name
    )
    into v_queue_exists;

    if not v_queue_exists then
      raise exception 'Queue "%" does not exist', p_queue_name;
    end if;
  end if;

  if p_partition_schedule is null or length(trim(p_partition_schedule)) = 0 then
    raise exception 'Partition schedule must be provided';
  end if;

  if p_cleanup_schedule is null or length(trim(p_cleanup_schedule)) = 0 then
    raise exception 'Cleanup schedule must be provided';
  end if;

  if p_detach_schedule is null or length(trim(p_detach_schedule)) = 0 then
    raise exception 'Detach schedule must be provided';
  end if;

  if to_regclass('cron.job') is null then
    raise exception 'pg_cron is not available (missing cron.job)';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'schedule'
  ) then
    raise exception 'pg_cron is not available (missing cron.schedule)';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'unschedule'
  ) then
    raise exception 'pg_cron is not available (missing cron.unschedule)';
  end if;

  v_queue_literal := case
    when p_queue_name is null then 'null::text'
    else quote_literal(p_queue_name)
  end;

  v_partition_command := format(
    'select absurd.ensure_partitions(%s);',
    v_queue_literal
  );

  v_cleanup_command := format(
    'select * from absurd.cleanup_all_queues(%s);',
    v_queue_literal
  );

  v_job_suffix := case
    when p_queue_name is null then 'all'
    else substr(md5(p_queue_name), 1, 12)
  end;

  v_partition_job_name := 'absurd_partitions_' || v_job_suffix;
  v_cleanup_job_name := 'absurd_cleanup_' || v_job_suffix;
  v_detach_plan_job_name := 'absurd_detach_plan_' || v_job_suffix;

  v_detach_plan_command := format(
    'select * from absurd.schedule_detach_jobs(%s);',
    v_queue_literal
  );

  for v_existing_job_id in
    execute 'select jobid from cron.job where jobname = $1'
    using v_partition_job_name
  loop
    execute 'select cron.unschedule($1)' using v_existing_job_id;
  end loop;

  for v_existing_job_id in
    execute 'select jobid from cron.job where jobname = $1'
    using v_cleanup_job_name
  loop
    execute 'select cron.unschedule($1)' using v_existing_job_id;
  end loop;

  for v_existing_job_id in
    execute 'select jobid from cron.job where jobname = $1'
    using v_detach_plan_job_name
  loop
    execute 'select cron.unschedule($1)' using v_existing_job_id;
  end loop;

  execute 'select cron.schedule($1, $2, $3)'
    into v_partitions_job_id
    using v_partition_job_name, p_partition_schedule, v_partition_command;

  execute 'select cron.schedule($1, $2, $3)'
    into v_cleanup_job_id
    using v_cleanup_job_name, p_cleanup_schedule, v_cleanup_command;

  execute 'select cron.schedule($1, $2, $3)'
    into v_detach_plan_job_id
    using v_detach_plan_job_name, p_detach_schedule, v_detach_plan_command;

  job_name := v_partition_job_name;
  job_id := v_partitions_job_id;
  return next;

  job_name := v_cleanup_job_name;
  job_id := v_cleanup_job_id;
  return next;

  job_name := v_detach_plan_job_name;
  job_id := v_detach_plan_job_id;
  return next;
end;
$$;

-- Removes pg_cron jobs previously installed by absurd.enable_cron.
--
-- If p_queue_name is null, this removes the global ('all') maintenance jobs
-- and global-scope detach/drop run jobs.
-- If p_queue_name is provided, this removes jobs for that specific queue scope,
-- including detach/drop run jobs.
create function absurd.disable_cron (
  p_queue_name text default null
)
  returns table (
    job_name text,
    job_id bigint
  )
  language plpgsql
as $$
declare
  v_job_suffix text;
  v_partition_job_name text;
  v_cleanup_job_name text;
  v_detach_plan_job_name text;
  v_detach_run_pattern text;
  v_drop_run_pattern text;
  v_existing_job record;
begin
  if p_queue_name is not null then
    p_queue_name := absurd.validate_queue_name(p_queue_name);
  end if;

  if to_regclass('cron.job') is null then
    raise exception 'pg_cron is not available (missing cron.job)';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'cron'
      and p.proname = 'unschedule'
  ) then
    raise exception 'pg_cron is not available (missing cron.unschedule)';
  end if;

  v_job_suffix := case
    when p_queue_name is null then 'all'
    else substr(md5(p_queue_name), 1, 12)
  end;

  v_partition_job_name := 'absurd_partitions_' || v_job_suffix;
  v_cleanup_job_name := 'absurd_cleanup_' || v_job_suffix;
  v_detach_plan_job_name := 'absurd_detach_plan_' || v_job_suffix;
  v_detach_run_pattern := 'absurd_detach_run_' || v_job_suffix || '_%';
  v_drop_run_pattern := 'absurd_drop_run_' || v_job_suffix || '_%';

  for v_existing_job in
    execute 'select jobid, jobname
               from cron.job
              where jobname = $1
                 or jobname = $2
                 or jobname = $3
                 or jobname like $4
                 or jobname like $5
              order by jobname, jobid'
    using v_partition_job_name,
          v_cleanup_job_name,
          v_detach_plan_job_name,
          v_detach_run_pattern,
          v_drop_run_pattern
  loop
    execute 'select cron.unschedule($1)' using v_existing_job.jobid;

    job_name := v_existing_job.jobname;
    job_id := v_existing_job.jobid;
    return next;
  end loop;
end;
$$;

CREATE TYPE "AuthorizationSubjectKind" AS ENUM ('group', 'principal');
CREATE TYPE "AuthorizationBoundaryKind" AS ENUM ('group', 'personal');
CREATE TYPE "AuthorizationBoundaryCoverage" AS ENUM ('exact', 'descendants');
CREATE TYPE "GroupMembershipAuthority" AS ENUM ('external', 'local');
CREATE TYPE "PrincipalProvenance" AS ENUM ('external', 'internal');

CREATE TABLE "principals" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "provenance" "PrincipalProvenance" NOT NULL DEFAULT 'external',
    "email" TEXT,
    "display_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "principals_pkey" PRIMARY KEY ("id")
);

INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "email", "display_name", "created_at", "updated_at")
SELECT membership."id", current_setting('opencrane.migration_silo_id'), current_setting('opencrane.migration_oidc_issuer'),
       membership."subject", 'external', membership."email", membership."display_name", membership."created_at", membership."updated_at"
FROM "org_memberships" membership;

INSERT INTO "principals" ("id", "silo_id", "issuer", "subject", "provenance", "email", "display_name", "created_at", "updated_at")
SELECT 'agent-service:' || service."id", service."silo_id", 'urn:opencrane:agent-service', service."id",
       'internal', NULL, service."name", service."created_at", service."updated_at"
FROM "agent_services" service
WHERE service."kind" = 'managed';

ALTER TABLE "principals" ADD CONSTRAINT "principals_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("issuer") <> '' AND btrim("subject") <> '' AND
    (("provenance" = 'external' AND "issuer" <> 'urn:opencrane:agent-service') OR
     ("provenance" = 'internal' AND "issuer" = 'urn:opencrane:agent-service' AND "email" IS NULL))
);
CREATE INDEX "principals_silo_id_email_idx" ON "principals"("silo_id", "email");
CREATE UNIQUE INDEX "principals_id_silo_id_key" ON "principals"("id", "silo_id");
CREATE UNIQUE INDEX "principals_silo_id_issuer_subject_key" ON "principals"("silo_id", "issuer", "subject");

ALTER TABLE "agent_services" ADD COLUMN "principal_id" TEXT;
UPDATE "agent_services" SET "principal_id" = 'agent-service:' || "id" WHERE "kind" = 'managed';
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_managed_principal_check" CHECK (
    ("kind" = 'managed' AND "principal_id" IS NOT NULL) OR ("kind" = 'personal' AND "principal_id" IS NULL)
);
CREATE UNIQUE INDEX "agent_services_principal_id_silo_id_key" ON "agent_services"("principal_id", "silo_id");
ALTER TABLE "agent_services" ADD CONSTRAINT "agent_services_principal_id_silo_id_fkey"
    FOREIGN KEY ("principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "enforce_agent_service_lifecycle"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    principal_issuer TEXT;
    principal_subject TEXT;
    principal_provenance "PrincipalProvenance";
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'draft' OR NEW."active_revision_id" IS NOT NULL THEN
            RAISE EXCEPTION 'a new AgentService must begin Draft without an active revision';
        END IF;
        IF (NEW."kind" = 'managed' AND NEW."principal_id" IS NULL)
            OR (NEW."kind" = 'personal' AND NEW."principal_id" IS NOT NULL) THEN
            RAISE EXCEPTION 'only managed AgentService rows require an internal Principal';
        END IF;
        IF NEW."principal_id" IS NOT NULL THEN
            SELECT "issuer", "subject", "provenance" INTO principal_issuer, principal_subject, principal_provenance
            FROM "principals" WHERE "id" = NEW."principal_id" AND "silo_id" = NEW."silo_id" FOR UPDATE;
            IF principal_provenance IS DISTINCT FROM 'internal'::"PrincipalProvenance"
                OR principal_issuer IS DISTINCT FROM 'urn:opencrane:agent-service'
                OR principal_subject IS DISTINCT FROM NEW."id" THEN
                RAISE EXCEPTION 'managed AgentService Principal has invalid internal provenance';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'AgentService rows cannot be deleted';
    END IF;
    IF OLD."state" = 'retired' THEN
        RAISE EXCEPTION 'a Retired AgentService is closed and cannot be changed';
    END IF;
    IF NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."kind" IS DISTINCT FROM OLD."kind"
        OR NEW."principal_id" IS DISTINCT FROM OLD."principal_id" THEN
        RAISE EXCEPTION 'AgentService silo identity is immutable';
    END IF;
    IF NEW."state" IS DISTINCT FROM OLD."state" AND NOT (
        (OLD."state" = 'draft' AND NEW."state" IN ('active', 'retired')) OR
        (OLD."state" = 'active' AND NEW."state" IN ('paused', 'retired')) OR
        (OLD."state" = 'paused' AND NEW."state" IN ('active', 'retired'))
    ) THEN
        RAISE EXCEPTION 'invalid AgentService lifecycle transition';
    END IF;
    IF NEW."state" = 'retired' AND NEW."active_revision_id" IS NOT NULL THEN
        RAISE EXCEPTION 'a Retired AgentService cannot retain an active revision';
    END IF;
    IF NEW."active_revision_id" IS DISTINCT FROM OLD."active_revision_id"
        AND NEW."state" NOT IN ('active', 'retired') THEN
        RAISE EXCEPTION 'the active revision pointer changes only on activation, rollover, or retirement';
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE "groups" ADD COLUMN "silo_id" TEXT;
ALTER TABLE "groups" ADD COLUMN "membership_authority" "GroupMembershipAuthority";
ALTER TABLE "groups" ADD COLUMN "parent_id" TEXT;
UPDATE "groups"
SET "silo_id" = current_setting('opencrane.migration_silo_id'),
    "membership_authority" = CASE WHEN "name" LIKE 'group:%' THEN 'external'::"GroupMembershipAuthority" ELSE 'local'::"GroupMembershipAuthority" END;
ALTER TABLE "groups" ALTER COLUMN "silo_id" SET NOT NULL;
ALTER TABLE "groups" ALTER COLUMN "membership_authority" SET NOT NULL;

CREATE TEMPORARY TABLE "_iam_principal_reference" (
    "reference" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    PRIMARY KEY ("reference", "principal_id")
) ON COMMIT DROP;
INSERT INTO "_iam_principal_reference" ("reference", "principal_id")
SELECT "id", "id" FROM "principals"
UNION
SELECT "subject", "id" FROM "principals"
UNION
SELECT lower("email"), "id" FROM "principals" WHERE "email" IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "artifacts" artifact
        WHERE (SELECT count(*) FROM "_iam_principal_reference" reference
               WHERE reference."reference" = artifact."owner_principal_id") <> 1
    ) THEN
        RAISE EXCEPTION 'every Artifact owner must resolve to exactly one Principal' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "mcp_server_installs" install
        WHERE (SELECT count(*) FROM "_iam_principal_reference" reference
               WHERE reference."reference" = install."user_id") <> 1
    ) THEN
        RAISE EXCEPTION 'every MCP install user must resolve to exactly one Principal' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT install."mcp_server_id", reference."principal_id"
        FROM "mcp_server_installs" install
        JOIN "_iam_principal_reference" reference ON reference."reference" = install."user_id"
        GROUP BY install."mcp_server_id", reference."principal_id"
        HAVING count(*) <> 1
    ) THEN
        RAISE EXCEPTION 'MCP installs collide after Principal projection' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

-- The reviewed cutover projects legacy owner references while the application lifecycle keeps owners immutable.
ALTER TABLE "artifacts" DISABLE TRIGGER "artifacts_closed_lifecycle";
UPDATE "artifacts" artifact
SET "owner_principal_id" = reference."principal_id"
FROM "_iam_principal_reference" reference
WHERE reference."reference" = artifact."owner_principal_id";
ALTER TABLE "artifacts" ENABLE TRIGGER "artifacts_closed_lifecycle";

UPDATE "mcp_server_installs" install
SET "user_id" = reference."principal_id"
FROM "_iam_principal_reference" reference
WHERE reference."reference" = install."user_id";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "mcp_server_installs" WHERE "credential_ref" IS NOT NULL OR "connection_status" IN ('connected', 'oauth-connected', 'activating', 'activation-failed')) THEN
        RAISE EXCEPTION 'MCP install custody state must be reconciled before the IAM cutover' USING ERRCODE = 'OC900';
    END IF;
END;
$$;
ALTER TABLE "mcp_server_installs" RENAME COLUMN "user_id" TO "principal_id";
ALTER TABLE "mcp_server_installs" DROP COLUMN "credential_ref";
ALTER TABLE "mcp_server_installs" DROP COLUMN "connected_account";
ALTER TABLE "mcp_server_installs" ALTER COLUMN "connection_status" DROP DEFAULT;
ALTER TYPE "McpConnectionStatus" RENAME TO "McpConnectionStatus_legacy";
CREATE TYPE "McpConnectionStatus" AS ENUM ('needs-credential', 'shared-key');
ALTER TABLE "mcp_server_installs" ALTER COLUMN "connection_status" TYPE "McpConnectionStatus" USING "connection_status"::TEXT::"McpConnectionStatus";
ALTER TABLE "mcp_server_installs" ALTER COLUMN "connection_status" SET DEFAULT 'needs-credential';
DROP TYPE "McpConnectionStatus_legacy";

CREATE TYPE "McpEraProbeStatus" AS ENUM ('not-required', 'pending', 'accepted', 'rejected');
CREATE TYPE "McpbValidationState" AS ENUM ('pending', 'verified', 'rejected');

CREATE TEMPORARY TABLE "_iam_group_reference" (
    "reference" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "legacy_scope" TEXT NOT NULL,
    "is_resource_share" BOOLEAN NOT NULL,
    PRIMARY KEY ("reference", "group_id")
) ON COMMIT DROP;
INSERT INTO "_iam_group_reference" ("reference", "group_id", "legacy_scope", "is_resource_share")
SELECT "id", "id", "scope"::TEXT, "name" LIKE 'resource:%' FROM "groups"
UNION
SELECT "name", "id", "scope"::TEXT, "name" LIKE 'resource:%' FROM "groups";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "groups" group_row
        WHERE jsonb_typeof(group_row."members") <> 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(group_row."members") member WHERE jsonb_typeof(member) <> 'string')
           OR EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(group_row."members") member("subject")
               GROUP BY member."subject" HAVING count(*) > 1
           )
    ) THEN
        RAISE EXCEPTION 'Group.members must be an array of unique subject strings' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "groups" group_row
        CROSS JOIN LATERAL jsonb_array_elements_text(group_row."members") member("subject")
        WHERE (SELECT count(*) FROM "_iam_principal_reference" reference WHERE reference."reference" = member."subject") <> 1
    ) THEN
        RAISE EXCEPTION 'every legacy group member must resolve to exactly one Principal' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "groups"
        WHERE "name" LIKE 'resource:%'
          AND ("scope"::TEXT <> 'personal' OR "name" !~ '^resource:(file|chat|dataset):.+$' OR jsonb_array_length("members") = 0)
    ) THEN
        RAISE EXCEPTION 'legacy resource share groups require personal scope, a supported resource kind, and an owner' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

CREATE TABLE "group_memberships" (
    "silo_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("group_id", "principal_id")
);
INSERT INTO "group_memberships" ("silo_id", "group_id", "principal_id", "created_at")
SELECT group_row."silo_id", group_row."id", reference."principal_id", group_row."created_at"
FROM "groups" group_row
CROSS JOIN LATERAL jsonb_array_elements_text(group_row."members") member("subject")
JOIN "_iam_principal_reference" reference ON reference."reference" = member."subject"
WHERE group_row."name" NOT LIKE 'resource:%';

CREATE SCHEMA IF NOT EXISTS "opencrane_migrations";
CREATE TABLE "opencrane_migrations"."group_claim_cutover" (
    "silo_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "source_claim" TEXT NOT NULL,
    "target_claim" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "migration_id" TEXT NOT NULL,
    "migration_sql_sha256" TEXT NOT NULL CHECK ("migration_sql_sha256" ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY ("silo_id", "issuer", "source_claim"),
    UNIQUE ("silo_id", "issuer", "target_claim")
);
REVOKE ALL ON TABLE "opencrane_migrations"."group_claim_cutover" FROM PUBLIC;
INSERT INTO "opencrane_migrations"."group_claim_cutover" (
    "silo_id", "issuer", "source_claim", "target_claim", "group_id", "migration_id", "migration_sql_sha256"
)
SELECT group_row."silo_id", current_setting('opencrane.migration_oidc_issuer'), group_row."name", 'group:' || group_row."id",
       group_row."id", '0.9.0-to-0.9.3', current_setting('opencrane.expected_migration_sql_sha256')
FROM "groups" group_row
WHERE group_row."membership_authority" = 'external';

CREATE TABLE "agent_revision_boundary_attachments" (
    "id" TEXT NOT NULL,
    "agent_revision_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "boundary_kind" "AuthorizationBoundaryKind" NOT NULL,
    "boundary_group_id" TEXT,
    "boundary_principal_id" TEXT,
    "boundary_coverage" "AuthorizationBoundaryCoverage" NOT NULL,
    CONSTRAINT "agent_revision_boundary_attachments_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "agent_revision_scope_attachments" attachment
        WHERE (attachment."subject_type"::TEXT = 'group' AND (
                  SELECT count(*) FROM "_iam_group_reference" reference
                  WHERE reference."reference" = attachment."subject_id" AND NOT reference."is_resource_share"
              ) <> 1)
           OR (attachment."subject_type"::TEXT = 'user' AND (
                  attachment."scope"::TEXT <> 'personal' OR
                  (SELECT count(*) FROM "_iam_principal_reference" reference WHERE reference."reference" = attachment."subject_id") <> 1
              ))
    ) THEN
        RAISE EXCEPTION 'every AgentRevision scope attachment must map to one group or personal Principal boundary' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

INSERT INTO "agent_revision_boundary_attachments" (
    "id", "agent_revision_id", "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage"
)
SELECT 'migration-boundary-' || md5(attachment."agent_revision_id" || ':' || attachment."scope"::TEXT || ':' || attachment."subject_type"::TEXT || ':' || attachment."subject_id"),
       attachment."agent_revision_id", service."silo_id",
       CASE WHEN attachment."subject_type"::TEXT = 'group' THEN 'group'::"AuthorizationBoundaryKind" ELSE 'personal'::"AuthorizationBoundaryKind" END,
       CASE WHEN attachment."subject_type"::TEXT = 'group' THEN group_reference."group_id" END,
       CASE WHEN attachment."subject_type"::TEXT = 'user' THEN principal_reference."principal_id" END,
       'exact'::"AuthorizationBoundaryCoverage"
FROM "agent_revision_scope_attachments" attachment
JOIN "agent_revisions" revision ON revision."id" = attachment."agent_revision_id"
JOIN "agent_services" service ON service."id" = revision."agent_service_id"
LEFT JOIN "_iam_group_reference" group_reference
       ON group_reference."reference" = attachment."subject_id" AND NOT group_reference."is_resource_share"
LEFT JOIN "_iam_principal_reference" principal_reference
       ON principal_reference."reference" = attachment."subject_id"
WHERE (attachment."subject_type"::TEXT = 'group' AND group_reference."group_id" IS NOT NULL)
   OR (attachment."subject_type"::TEXT = 'user' AND principal_reference."principal_id" IS NOT NULL);

DROP TRIGGER "authorization_grants_immutable" ON "authorization_grants";
ALTER TABLE "authorization_grants" DROP CONSTRAINT "authorization_grants_exact_check";
ALTER TABLE "authorization_grants" DROP CONSTRAINT "authorization_grants_scope_check";
DROP INDEX "authorization_grants_silo_id_subject_id_scope_kind_organiza_idx";
DROP INDEX "authorization_grant_exact_authority_key";
DROP INDEX "authorization_grant_null_scope_authority_key";

ALTER TABLE "authorization_grants" ADD COLUMN "subject_kind" "AuthorizationSubjectKind";
ALTER TABLE "authorization_grants" ADD COLUMN "subject_group_id" TEXT;
ALTER TABLE "authorization_grants" ADD COLUMN "subject_principal_id" TEXT;
ALTER TABLE "authorization_grants" ADD COLUMN "boundary_kind" "AuthorizationBoundaryKind";
ALTER TABLE "authorization_grants" ADD COLUMN "boundary_group_id" TEXT;
ALTER TABLE "authorization_grants" ADD COLUMN "boundary_principal_id" TEXT;
ALTER TABLE "authorization_grants" ADD COLUMN "boundary_coverage" "AuthorizationBoundaryCoverage";
ALTER TABLE "authorization_grants" ADD COLUMN "manager_id" TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "authorization_grants" grant_row
        WHERE (
            SELECT count(*) FROM (
                SELECT 'principal', reference."principal_id" FROM "_iam_principal_reference" reference
                 WHERE reference."reference" = grant_row."subject_id"
                UNION ALL
                SELECT 'group', reference."group_id" FROM "_iam_group_reference" reference
                 WHERE reference."reference" = grant_row."subject_id" AND NOT reference."is_resource_share"
            ) candidate
        ) <> 1
    ) THEN
        RAISE EXCEPTION 'every legacy AuthorizationGrant subject must resolve to exactly one Principal or Group' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "authorization_grants" grant_row
        WHERE (grant_row."scope_kind"::TEXT IN ('personal', 'direct-user') AND (
                   SELECT count(*) FROM "_iam_principal_reference" reference
                   WHERE reference."reference" = grant_row."scope_resource_id"
               ) <> 1)
           OR (grant_row."scope_kind"::TEXT NOT IN ('personal', 'direct-user') AND (
                   SELECT count(*) FROM "_iam_group_reference" reference
                   WHERE NOT reference."is_resource_share"
                     AND reference."legacy_scope" = CASE grant_row."scope_kind"::TEXT
                         WHEN 'organization' THEN 'org'
                         WHEN 'department' THEN 'department'
                         WHEN 'team' THEN 'team'
                         WHEN 'project' THEN 'project'
                     END
                     AND (
                         reference."reference" = CASE WHEN grant_row."scope_kind"::TEXT = 'organization' THEN grant_row."organization_id" ELSE grant_row."scope_resource_id" END
                         OR (grant_row."scope_kind"::TEXT = 'organization'
                             AND grant_row."organization_id" = current_setting('opencrane.migration_silo_id'))
                     )
               ) <> 1)
    ) THEN
        RAISE EXCEPTION 'every legacy AuthorizationGrant scope must resolve to exactly one stored boundary' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

UPDATE "authorization_grants" grant_row
SET "subject_kind" = CASE
        WHEN EXISTS (SELECT 1 FROM "_iam_principal_reference" reference WHERE reference."reference" = grant_row."subject_id")
        THEN 'principal'::"AuthorizationSubjectKind" ELSE 'group'::"AuthorizationSubjectKind" END,
    "subject_principal_id" = (
        SELECT reference."principal_id" FROM "_iam_principal_reference" reference WHERE reference."reference" = grant_row."subject_id"
    ),
    "subject_group_id" = (
        SELECT reference."group_id" FROM "_iam_group_reference" reference
        WHERE reference."reference" = grant_row."subject_id" AND NOT reference."is_resource_share"
    ),
    "boundary_kind" = CASE WHEN grant_row."scope_kind"::TEXT IN ('personal', 'direct-user')
        THEN 'personal'::"AuthorizationBoundaryKind" ELSE 'group'::"AuthorizationBoundaryKind" END,
    "boundary_principal_id" = CASE WHEN grant_row."scope_kind"::TEXT IN ('personal', 'direct-user') THEN (
        SELECT reference."principal_id" FROM "_iam_principal_reference" reference WHERE reference."reference" = grant_row."scope_resource_id"
    ) END,
    "boundary_group_id" = CASE WHEN grant_row."scope_kind"::TEXT NOT IN ('personal', 'direct-user') THEN (
        SELECT reference."group_id" FROM "_iam_group_reference" reference
        WHERE NOT reference."is_resource_share"
          AND reference."legacy_scope" = CASE grant_row."scope_kind"::TEXT
              WHEN 'organization' THEN 'org' WHEN 'department' THEN 'department' WHEN 'team' THEN 'team' WHEN 'project' THEN 'project' END
          AND (
              reference."reference" = CASE WHEN grant_row."scope_kind"::TEXT = 'organization' THEN grant_row."organization_id" ELSE grant_row."scope_resource_id" END
              OR (grant_row."scope_kind"::TEXT = 'organization' AND grant_row."organization_id" = current_setting('opencrane.migration_silo_id'))
          )
    ) END,
    "boundary_coverage" = 'exact'::"AuthorizationBoundaryCoverage";

ALTER TABLE "authorization_grants" ALTER COLUMN "subject_kind" SET NOT NULL;
ALTER TABLE "authorization_grants" ALTER COLUMN "boundary_kind" SET NOT NULL;
ALTER TABLE "authorization_grants" ALTER COLUMN "boundary_coverage" SET NOT NULL;
ALTER TABLE "authorization_grants" DROP COLUMN "subject_id";
ALTER TABLE "authorization_grants" DROP COLUMN "scope_kind";
ALTER TABLE "authorization_grants" DROP COLUMN "organization_id";
ALTER TABLE "authorization_grants" DROP COLUMN "scope_resource_id";

ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_exact_check" CHECK (
    btrim("silo_id") <> '' AND
    (("subject_kind" = 'group' AND "subject_group_id" IS NOT NULL AND "subject_principal_id" IS NULL) OR
     ("subject_kind" = 'principal' AND "subject_group_id" IS NULL AND "subject_principal_id" IS NOT NULL)) AND
    (("boundary_kind" = 'group' AND "boundary_group_id" IS NOT NULL AND "boundary_principal_id" IS NULL) OR
     ("boundary_kind" = 'personal' AND "boundary_group_id" IS NULL AND "boundary_principal_id" IS NOT NULL AND "boundary_coverage" = 'exact')) AND
    btrim("catalog_id") <> '' AND "catalog_revision" > 0 AND
    btrim("catalog_digest") <> '' AND "catalog_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("capability_id") <> '' AND
    btrim("resource_kind") NOT IN ('', '*') AND btrim("resource_id") NOT IN ('', '*') AND
    "priority" >= 0 AND btrim("created_by") <> ''
);
CREATE UNIQUE INDEX "authorization_grant_exact_authority_key" ON "authorization_grants"(
    "silo_id", "subject_kind", COALESCE("subject_group_id", ''), COALESCE("subject_principal_id", ''),
    "boundary_kind", COALESCE("boundary_group_id", ''), COALESCE("boundary_principal_id", ''), "boundary_coverage",
    "catalog_id", "catalog_revision", "capability_id", "resource_kind", COALESCE("resource_id", ''), "effect", "priority", COALESCE("manager_id", '')
);
CREATE INDEX "authorization_grants_silo_id_subject_kind_subject_group_id__idx" ON "authorization_grants"("silo_id", "subject_kind", "subject_group_id", "subject_principal_id");
CREATE INDEX "authorization_grants_silo_id_boundary_kind_boundary_group_i_idx" ON "authorization_grants"("silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage");
CREATE INDEX "authorization_grants_silo_id_manager_id_idx" ON "authorization_grants"("silo_id", "manager_id");

CREATE OR REPLACE FUNCTION "enforce_authorization_grant_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'AuthorizationGrant rows cannot be deleted'; END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
        OR NEW."subject_kind" IS DISTINCT FROM OLD."subject_kind"
        OR NEW."subject_group_id" IS DISTINCT FROM OLD."subject_group_id"
        OR NEW."subject_principal_id" IS DISTINCT FROM OLD."subject_principal_id"
        OR NEW."boundary_kind" IS DISTINCT FROM OLD."boundary_kind"
        OR NEW."boundary_group_id" IS DISTINCT FROM OLD."boundary_group_id"
        OR NEW."boundary_principal_id" IS DISTINCT FROM OLD."boundary_principal_id"
        OR NEW."boundary_coverage" IS DISTINCT FROM OLD."boundary_coverage"
        OR NEW."manager_id" IS DISTINCT FROM OLD."manager_id"
        OR NEW."catalog_id" IS DISTINCT FROM OLD."catalog_id" OR NEW."catalog_revision" IS DISTINCT FROM OLD."catalog_revision"
        OR NEW."catalog_digest" IS DISTINCT FROM OLD."catalog_digest" OR NEW."capability_id" IS DISTINCT FROM OLD."capability_id"
        OR NEW."resource_kind" IS DISTINCT FROM OLD."resource_kind" OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id"
        OR NEW."effect" IS DISTINCT FROM OLD."effect" OR NEW."priority" IS DISTINCT FROM OLD."priority"
        OR NEW."valid_from" IS DISTINCT FROM OLD."valid_from" OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
        OR NEW."created_by" IS DISTINCT FROM OLD."created_by" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'AuthorizationGrant authority fields are immutable';
    END IF;
    IF OLD."revoked_at" IS NOT NULL OR NEW."revoked_at" IS NULL THEN
        RAISE EXCEPTION 'AuthorizationGrant may be revoked exactly once';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "authorization_grants_immutable" BEFORE UPDATE OR DELETE ON "authorization_grants"
    FOR EACH ROW EXECUTE FUNCTION "enforce_authorization_grant_update"();

DROP TRIGGER "memory_datasets_closed_lifecycle" ON "memory_datasets";
ALTER TABLE "memory_datasets" DROP CONSTRAINT "memory_datasets_identity_check";
ALTER TABLE "memory_datasets" DROP CONSTRAINT "memory_datasets_scope_check";
DROP INDEX "memory_datasets_silo_id_scope_kind_organization_id_scope_re_key";
DROP INDEX "memory_datasets_exact_scope_key";
ALTER TABLE "memory_datasets" ADD COLUMN "boundary_kind" "AuthorizationBoundaryKind";
ALTER TABLE "memory_datasets" ADD COLUMN "boundary_group_id" TEXT;
ALTER TABLE "memory_datasets" ADD COLUMN "boundary_principal_id" TEXT;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "memory_datasets" dataset
        WHERE (dataset."scope_kind"::TEXT IN ('personal', 'direct-user') AND (
                  SELECT count(*) FROM "_iam_principal_reference" reference WHERE reference."reference" = dataset."scope_resource_id"
              ) <> 1)
           OR (dataset."scope_kind"::TEXT NOT IN ('personal', 'direct-user') AND (
                  SELECT count(*) FROM "_iam_group_reference" reference
                  WHERE NOT reference."is_resource_share"
                    AND reference."legacy_scope" = CASE dataset."scope_kind"::TEXT
                        WHEN 'organization' THEN 'org' WHEN 'department' THEN 'department' WHEN 'team' THEN 'team' WHEN 'project' THEN 'project' END
                    AND (reference."reference" = CASE WHEN dataset."scope_kind"::TEXT = 'organization' THEN dataset."organization_id" ELSE dataset."scope_resource_id" END
                         OR (dataset."scope_kind"::TEXT = 'organization' AND dataset."organization_id" = current_setting('opencrane.migration_silo_id')))
              ) <> 1)
    ) THEN
        RAISE EXCEPTION 'every legacy MemoryDataset scope must resolve to exactly one stored boundary' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

UPDATE "memory_datasets" dataset
SET "boundary_kind" = CASE WHEN dataset."scope_kind"::TEXT IN ('personal', 'direct-user')
        THEN 'personal'::"AuthorizationBoundaryKind" ELSE 'group'::"AuthorizationBoundaryKind" END,
    "boundary_principal_id" = CASE WHEN dataset."scope_kind"::TEXT IN ('personal', 'direct-user') THEN (
        SELECT reference."principal_id" FROM "_iam_principal_reference" reference WHERE reference."reference" = dataset."scope_resource_id"
    ) END,
    "boundary_group_id" = CASE WHEN dataset."scope_kind"::TEXT NOT IN ('personal', 'direct-user') THEN (
        SELECT reference."group_id" FROM "_iam_group_reference" reference
        WHERE NOT reference."is_resource_share"
          AND reference."legacy_scope" = CASE dataset."scope_kind"::TEXT
              WHEN 'organization' THEN 'org' WHEN 'department' THEN 'department' WHEN 'team' THEN 'team' WHEN 'project' THEN 'project' END
          AND (reference."reference" = CASE WHEN dataset."scope_kind"::TEXT = 'organization' THEN dataset."organization_id" ELSE dataset."scope_resource_id" END
               OR (dataset."scope_kind"::TEXT = 'organization' AND dataset."organization_id" = current_setting('opencrane.migration_silo_id')))
    ) END;
ALTER TABLE "memory_datasets" ALTER COLUMN "boundary_kind" SET NOT NULL;
ALTER TABLE "memory_datasets" DROP COLUMN "scope_kind";
ALTER TABLE "memory_datasets" DROP COLUMN "organization_id";
ALTER TABLE "memory_datasets" DROP COLUMN "scope_resource_id";
ALTER TABLE "memory_datasets" ADD CONSTRAINT "memory_datasets_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("cognee_dataset_id") <> '' AND btrim("created_by") <> '' AND
    (("boundary_kind" = 'group' AND "boundary_group_id" IS NOT NULL AND "boundary_principal_id" IS NULL) OR
     ("boundary_kind" = 'personal' AND "boundary_group_id" IS NULL AND "boundary_principal_id" IS NOT NULL))
);
CREATE INDEX "memory_datasets_silo_id_boundary_kind_boundary_group_id_bou_idx" ON "memory_datasets"("silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id");
CREATE UNIQUE INDEX "memory_datasets_exact_boundary_key"
    ON "memory_datasets"("silo_id", "boundary_kind", COALESCE("boundary_group_id", ''), COALESCE("boundary_principal_id", ''));
CREATE OR REPLACE FUNCTION "enforce_memory_dataset_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'MemoryDataset catalog rows cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."boundary_kind" IS DISTINCT FROM OLD."boundary_kind" OR NEW."boundary_group_id" IS DISTINCT FROM OLD."boundary_group_id" OR NEW."boundary_principal_id" IS DISTINCT FROM OLD."boundary_principal_id" OR NEW."cognee_dataset_id" IS DISTINCT FROM OLD."cognee_dataset_id" OR NEW."created_by" IS DISTINCT FROM OLD."created_by" OR NEW."created_at" IS DISTINCT FROM OLD."created_at") THEN RAISE EXCEPTION 'MemoryDataset authority is immutable'; END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" = 'retired' THEN RAISE EXCEPTION 'retired MemoryDataset is closed'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "memory_datasets_closed_lifecycle" BEFORE UPDATE OR DELETE ON "memory_datasets"
    FOR EACH ROW EXECUTE FUNCTION "enforce_memory_dataset_lifecycle"();

ALTER TABLE "mcp_servers" ADD COLUMN "silo_id" TEXT;
UPDATE "mcp_servers" SET "silo_id" = current_setting('opencrane.migration_silo_id');
ALTER TABLE "mcp_servers" ALTER COLUMN "silo_id" SET NOT NULL;
ALTER TABLE "mcp_servers" ADD COLUMN "registration_key_digest" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "registration_digest" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "era_probe_status" "McpEraProbeStatus" NOT NULL DEFAULT 'not-required';
ALTER TABLE "mcp_servers" ADD COLUMN "era_protocol_version" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "era_probe_evidence_digest" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "era_probe_failure_code" TEXT;
ALTER TABLE "mcp_servers" ADD COLUMN "era_probe_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "mcp_servers" ADD COLUMN "era_probed_at" TIMESTAMP(3);

CREATE TABLE "mcp_registration_claims" (
    "silo_id" TEXT NOT NULL,
    "identity_digest" TEXT NOT NULL,
    "touched_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mcp_registration_claims_pkey" PRIMARY KEY ("silo_id", "identity_digest")
);
ALTER TABLE "mcp_registration_claims" ADD CONSTRAINT "mcp_registration_claims_identity_check" CHECK (
    btrim("silo_id") <> '' AND "identity_digest" ~ '^sha256:[0-9a-f]{64}$'
);

CREATE TABLE "mcpb_validation_claims" (
    "silo_id" TEXT NOT NULL,
    "identity_digest" TEXT NOT NULL,
    "touched_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mcpb_validation_claims_pkey" PRIMARY KEY ("silo_id", "identity_digest")
);
ALTER TABLE "mcpb_validation_claims" ADD CONSTRAINT "mcpb_validation_claims_identity_check" CHECK (
    btrim("silo_id") <> '' AND "identity_digest" ~ '^sha256:[0-9a-f]{64}$'
);

CREATE TABLE "mcpb_validations" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "artifact_revision_id" TEXT NOT NULL,
    "content_address" TEXT NOT NULL,
    "byte_length" BIGINT NOT NULL,
    "media_type" TEXT NOT NULL,
    "submission_key_digest" TEXT NOT NULL,
    "submission_digest" TEXT NOT NULL,
    "accepted_manifest_version" TEXT NOT NULL DEFAULT '0.3',
    "state" "McpbValidationState" NOT NULL DEFAULT 'pending',
    "manifest_name" TEXT,
    "bundle_version" TEXT,
    "manifest_digest" TEXT,
    "publisher" TEXT,
    "signer_fingerprint" TEXT,
    "failure_code" TEXT,
    "created_by_principal_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mcpb_validations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "mcpb_validations_silo_id_submission_key_digest_key" ON "mcpb_validations"("silo_id", "submission_key_digest");
CREATE INDEX "mcpb_validations_silo_id_state_created_at_idx" ON "mcpb_validations"("silo_id", "state", "created_at");
ALTER TABLE "mcpb_validations" ADD CONSTRAINT "mcpb_validations_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("artifact_id") <> '' AND btrim("artifact_revision_id") <> '' AND
    btrim("created_by_principal_id") <> '' AND btrim("media_type") <> '' AND "byte_length" >= 0 AND
    "accepted_manifest_version" = '0.3' AND "content_address" ~ '^sha256:[0-9a-f]{64}$' AND
    "submission_key_digest" ~ '^sha256:[0-9a-f]{64}$' AND "submission_digest" ~ '^sha256:[0-9a-f]{64}$'
);
ALTER TABLE "mcpb_validations" ADD CONSTRAINT "mcpb_validations_result_check" CHECK (
    ("state" = 'pending' AND "manifest_name" IS NULL AND "bundle_version" IS NULL AND "manifest_digest" IS NULL AND "publisher" IS NULL AND "signer_fingerprint" IS NULL AND "failure_code" IS NULL AND "completed_at" IS NULL)
    OR ("state" = 'verified' AND btrim("manifest_name") <> '' AND btrim("bundle_version") <> '' AND "manifest_digest" ~ '^sha256:[0-9a-f]{64}$' AND btrim("publisher") <> '' AND "signer_fingerprint" ~ '^sha256:[0-9a-f]{64}$' AND "failure_code" IS NULL AND "completed_at" IS NOT NULL)
    OR ("state" = 'rejected' AND "manifest_name" IS NULL AND "bundle_version" IS NULL AND "manifest_digest" IS NULL AND "publisher" IS NULL AND "signer_fingerprint" IS NULL AND "failure_code" IN ('artifact_mismatch', 'bundle_too_large', 'invalid_archive', 'invalid_manifest', 'invalid_signature', 'unsupported_manifest_version') AND "completed_at" IS NOT NULL)
);
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_registration_digest_check" CHECK (
    ("registration_key_digest" IS NULL AND "registration_digest" IS NULL)
    OR ("registration_key_digest" ~ '^sha256:[0-9a-f]{64}$' AND "registration_digest" ~ '^sha256:[0-9a-f]{64}$')
);
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_era_probe_evidence_check" CHECK (
    ("era_probe_status" = 'not-required' AND "era_probe_attempts" = 0 AND "registration_key_digest" IS NULL AND "registration_digest" IS NULL AND "era_protocol_version" IS NULL AND "era_probe_evidence_digest" IS NULL AND "era_probe_failure_code" IS NULL AND "era_probed_at" IS NULL)
    OR ("era_probe_status" = 'pending' AND "era_probe_attempts" >= 0 AND "registration_key_digest" IS NOT NULL AND "registration_digest" IS NOT NULL AND "era_protocol_version" IS NULL AND "era_probe_evidence_digest" IS NULL AND "era_probe_failure_code" IS NULL AND "era_probed_at" IS NULL)
    OR ("era_probe_status" = 'accepted' AND "era_probe_attempts" >= 1 AND "registration_key_digest" IS NOT NULL AND "registration_digest" IS NOT NULL AND btrim("era_protocol_version") <> '' AND "era_probe_evidence_digest" ~ '^sha256:[0-9a-f]{64}$' AND "era_probe_failure_code" IS NULL AND "era_probed_at" IS NOT NULL)
    OR ("era_probe_status" = 'rejected' AND "era_probe_attempts" >= 1 AND "registration_key_digest" IS NOT NULL AND "registration_digest" IS NOT NULL AND "era_probe_evidence_digest" ~ '^sha256:[0-9a-f]{64}$' AND "era_probed_at" IS NOT NULL AND ((btrim("era_protocol_version") <> '' AND "era_probe_failure_code" IS NULL) OR ("era_protocol_version" IS NULL AND "era_probe_failure_code" IN ('unsafe_endpoint', 'invalid_response', 'retry_exhausted'))))
);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "mcp_server_access_policies" WHERE "everyone_in_org") THEN
        RAISE EXCEPTION 'everyoneInOrg MCP policy has no deterministic least-privilege grant projection' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "mcp_server_access_users" access_user
        WHERE (SELECT count(*) FROM "_iam_principal_reference" reference WHERE reference."reference" = access_user."user_id") <> 1
    ) THEN
        RAISE EXCEPTION 'every MCP access user must resolve to exactly one Principal' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "mcp_server_access_policies" policy
        CROSS JOIN LATERAL unnest(COALESCE(policy."groups", ARRAY[]::TEXT[])) group_reference("reference")
        WHERE (SELECT count(*) FROM "_iam_group_reference" reference
               WHERE reference."reference" = group_reference."reference" AND NOT reference."is_resource_share") <> 1
    ) THEN
        RAISE EXCEPTION 'every MCP access group must resolve to exactly one Group' USING ERRCODE = 'OC900';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "mcp_server_access_policies" policy
        WHERE (EXISTS (SELECT 1 FROM "mcp_server_access_users" access_user WHERE access_user."access_policy_id" = policy."id")
               OR cardinality(COALESCE(policy."groups", ARRAY[]::TEXT[])) > 0)
          AND (SELECT count(*) FROM "_iam_group_reference" reference
               WHERE reference."legacy_scope" = 'org' AND NOT reference."is_resource_share") <> 1
    ) THEN
        RAISE EXCEPTION 'MCP policies require exactly one legacy organization Group boundary' USING ERRCODE = 'OC900';
    END IF;
END;
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "capability_catalog_revisions"
        WHERE ("catalog_id" = 'opencrane-resource-sharing' AND ("revision" <> 1 OR "digest" <> 'sha256:03c84ee77c531ddc95d5c379e195e12d94aed9129783a07105066a875d24c775' OR "capabilities" <> '[{"id":"resource:read","actions":["read"]}]'::jsonb))
           OR ("catalog_id" = 'opencrane-core' AND ("revision" <> 1 OR "digest" <> 'sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6' OR "capabilities" <> '[{"id":"mcp-server:use","actions":["use"]}]'::jsonb))
           OR ("id" = 'capability-catalog-resource-sharing-v1' AND "catalog_id" <> 'opencrane-resource-sharing')
           OR ("id" = 'capability-catalog-opencrane-core-v1' AND "catalog_id" <> 'opencrane-core')
    ) THEN
        RAISE EXCEPTION 'existing capability catalog rows conflict with the reviewed 0.9.3 seeds' USING ERRCODE = 'OC900';
    END IF;
END;
$$;
INSERT INTO "capability_catalog_revisions" ("id", "catalog_id", "revision", "digest", "capabilities", "created_by") VALUES
('capability-catalog-resource-sharing-v1', 'opencrane-resource-sharing', 1, 'sha256:03c84ee77c531ddc95d5c379e195e12d94aed9129783a07105066a875d24c775', '[{"id":"resource:read","actions":["read"]}]'::jsonb, 'system:target-baseline'),
('capability-catalog-opencrane-core-v1', 'opencrane-core', 1, 'sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6', '[{"id":"mcp-server:use","actions":["use"]}]'::jsonb, 'system:target-baseline')
ON CONFLICT DO NOTHING;

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage", "manager_id",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind", "resource_id",
    "effect", "priority", "valid_from", "require_approval", "created_by", "created_at"
)
SELECT 'migration-mcp-user-' || md5(policy."id" || ':' || access_user."user_id"), server."silo_id",
       'principal', NULL, principal_reference."principal_id", 'group', organization_group."group_id", NULL, 'exact', 'mcp-access-editor',
       'opencrane-core', 1, 'sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6',
       'mcp-server:use', 'mcp-server', server."id", 'allow', 0, policy."created_at", false,
       'migration:0.9.0-to-0.9.3', policy."created_at"
FROM "mcp_server_access_policies" policy
JOIN "mcp_servers" server ON server."id" = policy."mcp_server_id"
JOIN "mcp_server_access_users" access_user ON access_user."access_policy_id" = policy."id"
JOIN "_iam_principal_reference" principal_reference ON principal_reference."reference" = access_user."user_id"
CROSS JOIN LATERAL (
    SELECT reference."group_id" FROM "_iam_group_reference" reference
    WHERE reference."legacy_scope" = 'org' AND NOT reference."is_resource_share"
) organization_group;

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_group_id", "subject_principal_id",
    "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage", "manager_id",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind", "resource_id",
    "effect", "priority", "valid_from", "require_approval", "created_by", "created_at"
)
SELECT 'migration-mcp-group-' || md5(policy."id" || ':' || group_name."reference"), server."silo_id",
       'group', group_reference."group_id", NULL, 'group', organization_group."group_id", NULL, 'exact', 'mcp-access-editor',
       'opencrane-core', 1, 'sha256:b437ba0e9642ea867d58011ca828aa863b0e1a21528f91d567bccec74c71bff6',
       'mcp-server:use', 'mcp-server', server."id", 'allow', 0, policy."created_at", false,
       'migration:0.9.0-to-0.9.3', policy."created_at"
FROM "mcp_server_access_policies" policy
JOIN "mcp_servers" server ON server."id" = policy."mcp_server_id"
CROSS JOIN LATERAL unnest(COALESCE(policy."groups", ARRAY[]::TEXT[])) group_name("reference")
JOIN "_iam_group_reference" group_reference ON group_reference."reference" = group_name."reference" AND NOT group_reference."is_resource_share"
CROSS JOIN LATERAL (
    SELECT reference."group_id" FROM "_iam_group_reference" reference
    WHERE reference."legacy_scope" = 'org' AND NOT reference."is_resource_share"
) organization_group;

CREATE TABLE "resource_shares" (
    "id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "resource_kind" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "owner_principal_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "resource_shares_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "resource_share_recipients" (
    "silo_id" TEXT NOT NULL,
    "resource_share_id" TEXT NOT NULL,
    "principal_id" TEXT NOT NULL,
    "granted_by_principal_id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_share_recipients_pkey" PRIMARY KEY ("resource_share_id", "principal_id")
);

INSERT INTO "resource_shares" ("id", "silo_id", "resource_kind", "resource_id", "owner_principal_id", "created_at", "updated_at")
SELECT group_row."id", group_row."silo_id", split_part(group_row."name", ':', 2), substring(group_row."name" from '^[^:]+:[^:]+:(.+)$'),
       owner_reference."principal_id", group_row."created_at", group_row."updated_at"
FROM "groups" group_row
CROSS JOIN LATERAL (SELECT value #>> '{}' AS subject FROM jsonb_array_elements(group_row."members") WITH ORDINALITY member(value, ordinal) WHERE ordinal = 1) owner_member
JOIN "_iam_principal_reference" owner_reference ON owner_reference."reference" = owner_member.subject
WHERE group_row."name" LIKE 'resource:%';

INSERT INTO "authorization_grants" (
    "id", "silo_id", "subject_kind", "subject_principal_id", "boundary_kind", "boundary_principal_id", "boundary_coverage", "manager_id",
    "catalog_id", "catalog_revision", "catalog_digest", "capability_id", "resource_kind", "resource_id",
    "effect", "priority", "valid_from", "require_approval", "created_by", "created_at"
)
SELECT 'migration-resource-share-' || md5(group_row."id" || ':' || recipient_reference."principal_id"), group_row."silo_id",
       'principal', recipient_reference."principal_id", 'personal', owner_reference."principal_id", 'exact', 'resource-share-editor',
       'opencrane-resource-sharing', 1, 'sha256:03c84ee77c531ddc95d5c379e195e12d94aed9129783a07105066a875d24c775',
       'resource:read', split_part(group_row."name", ':', 2), substring(group_row."name" from '^[^:]+:[^:]+:(.+)$'),
       'allow', 0, group_row."created_at", false, owner_reference."principal_id", group_row."created_at"
FROM "groups" group_row
CROSS JOIN LATERAL jsonb_array_elements(group_row."members") WITH ORDINALITY owner_member(value, ordinal)
JOIN "_iam_principal_reference" owner_reference ON owner_reference."reference" = (owner_member.value #>> '{}') AND owner_member.ordinal = 1
CROSS JOIN LATERAL jsonb_array_elements(group_row."members") WITH ORDINALITY recipient_member(value, ordinal)
JOIN "_iam_principal_reference" recipient_reference ON recipient_reference."reference" = (recipient_member.value #>> '{}') AND recipient_member.ordinal > 1
WHERE group_row."name" LIKE 'resource:%';

INSERT INTO "resource_share_recipients" ("silo_id", "resource_share_id", "principal_id", "granted_by_principal_id", "grant_id", "created_at")
SELECT share."silo_id", share."id", grant_row."subject_principal_id", share."owner_principal_id", grant_row."id", grant_row."created_at"
FROM "resource_shares" share
JOIN "authorization_grants" grant_row
  ON grant_row."manager_id" = 'resource-share-editor'
 AND grant_row."boundary_principal_id" = share."owner_principal_id"
 AND grant_row."resource_kind" = share."resource_kind"
 AND grant_row."resource_id" = share."resource_id";

DELETE FROM "groups" WHERE "name" LIKE 'resource:%';

DROP INDEX "groups_scope_idx";
DROP INDEX "mcp_servers_scope_idx";
DROP INDEX "verified_fleet_membership_assertions_silo_id_subject_id_sco_idx";
ALTER TABLE "groups" DROP COLUMN "members";
ALTER TABLE "groups" DROP COLUMN "scope";
ALTER TABLE "mcp_servers" DROP COLUMN "scope";
ALTER TABLE "verified_fleet_membership_assertions" DROP COLUMN "scope_kind";
ALTER TABLE "verified_fleet_membership_assertions" DROP COLUMN "organization_id";
ALTER TABLE "verified_fleet_membership_assertions" DROP COLUMN "scope_resource_id";
ALTER TABLE "verified_fleet_membership_assertions" ADD CONSTRAINT "verified_fleet_membership_assertions_exact_check" CHECK (
    btrim("assertion_id") <> '' AND btrim("silo_id") <> '' AND btrim("subject_id") <> ''
);

DROP TABLE "agent_revision_scope_attachments";
DROP TABLE "mcp_server_access_users";
DROP TABLE "mcp_server_access_policies";
DROP TABLE "mcp_server_credentials";

DROP INDEX "groups_name_key";
DROP INDEX "mcp_servers_name_key";
DROP INDEX "mcp_server_installs_user_id_idx";
DROP INDEX "mcp_server_installs_mcp_server_id_user_id_key";

CREATE INDEX "agent_revision_boundary_attachments_agent_revision_id_bound_idx" ON "agent_revision_boundary_attachments"("agent_revision_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage");
CREATE INDEX "agent_revision_boundary_attachments_silo_id_boundary_kind_idx" ON "agent_revision_boundary_attachments"("silo_id", "boundary_kind");
CREATE INDEX "groups_silo_id_parent_id_idx" ON "groups"("silo_id", "parent_id");
CREATE INDEX "groups_silo_id_membership_authority_idx" ON "groups"("silo_id", "membership_authority");
CREATE UNIQUE INDEX "groups_id_silo_id_key" ON "groups"("id", "silo_id");
CREATE UNIQUE INDEX "groups_silo_id_name_key" ON "groups"("silo_id", "name");
CREATE INDEX "group_memberships_silo_id_principal_id_idx" ON "group_memberships"("silo_id", "principal_id");
CREATE UNIQUE INDEX "mcp_servers_silo_id_name_key" ON "mcp_servers"("silo_id", "name");
CREATE UNIQUE INDEX "mcp_servers_silo_id_registration_key_digest_key" ON "mcp_servers"("silo_id", "registration_key_digest");
CREATE INDEX "mcp_server_installs_principal_id_idx" ON "mcp_server_installs"("principal_id");
CREATE UNIQUE INDEX "mcp_server_installs_mcp_server_id_principal_id_key" ON "mcp_server_installs"("mcp_server_id", "principal_id");
CREATE INDEX "verified_fleet_membership_assertions_silo_id_subject_id_idx" ON "verified_fleet_membership_assertions"("silo_id", "subject_id");
CREATE UNIQUE INDEX "resource_shares_id_silo_id_key" ON "resource_shares"("id", "silo_id");
CREATE UNIQUE INDEX "resource_shares_silo_id_resource_kind_resource_id_key" ON "resource_shares"("silo_id", "resource_kind", "resource_id");
CREATE UNIQUE INDEX "resource_share_recipients_grant_id_key" ON "resource_share_recipients"("grant_id");
CREATE INDEX "resource_share_recipients_silo_id_principal_id_idx" ON "resource_share_recipients"("silo_id", "principal_id");

ALTER TABLE "agent_revision_boundary_attachments" ADD CONSTRAINT "agent_revision_boundary_attachments_exact_boundary_check" CHECK (
    btrim("agent_revision_id") <> '' AND btrim("silo_id") <> '' AND
    (("boundary_kind" = 'group' AND "boundary_group_id" IS NOT NULL AND "boundary_principal_id" IS NULL) OR
     ("boundary_kind" = 'personal' AND "boundary_group_id" IS NULL AND "boundary_principal_id" IS NOT NULL AND "boundary_coverage" = 'exact'))
);
ALTER TABLE "mcp_server_installs" DROP CONSTRAINT "mcp_server_installs_mcp_server_id_fkey";
ALTER TABLE "mcp_server_installs" ADD CONSTRAINT "mcp_server_installs_mcp_server_id_fkey" FOREIGN KEY ("mcp_server_id") REFERENCES "mcp_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mcp_server_installs" ADD CONSTRAINT "mcp_server_installs_principal_id_fkey" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "groups" ADD CONSTRAINT "groups_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("name") <> '' AND ("parent_id" IS NULL OR btrim("parent_id") <> '')
);
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("group_id") <> '' AND btrim("principal_id") <> ''
);
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("resource_kind") NOT IN ('', '*') AND btrim("resource_id") NOT IN ('', '*') AND btrim("owner_principal_id") <> ''
);
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_identity_check" CHECK (
    btrim("silo_id") <> '' AND btrim("resource_share_id") <> '' AND btrim("principal_id") <> '' AND btrim("granted_by_principal_id") <> '' AND btrim("grant_id") <> ''
);

ALTER TABLE "agent_revision_boundary_attachments" ADD CONSTRAINT "agent_revision_boundary_attachments_agent_revision_id_fkey" FOREIGN KEY ("agent_revision_id") REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_revision_boundary_attachments" ADD CONSTRAINT "agent_revision_boundary_attachments_boundary_group_id_silo_fkey" FOREIGN KEY ("boundary_group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_revision_boundary_attachments" ADD CONSTRAINT "agent_revision_boundary_attachments_boundary_principal_id__fkey" FOREIGN KEY ("boundary_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_subject_group_id_silo_id_fkey" FOREIGN KEY ("subject_group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_subject_principal_id_silo_id_fkey" FOREIGN KEY ("subject_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_boundary_group_id_silo_id_fkey" FOREIGN KEY ("boundary_group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "authorization_grants" ADD CONSTRAINT "authorization_grants_boundary_principal_id_silo_id_fkey" FOREIGN KEY ("boundary_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "groups" ADD CONSTRAINT "groups_parent_id_silo_id_fkey" FOREIGN KEY ("parent_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_silo_id_fkey" FOREIGN KEY ("group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_principal_id_silo_id_fkey" FOREIGN KEY ("principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_datasets" ADD CONSTRAINT "memory_datasets_boundary_group_id_silo_id_fkey" FOREIGN KEY ("boundary_group_id", "silo_id") REFERENCES "groups"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memory_datasets" ADD CONSTRAINT "memory_datasets_boundary_principal_id_silo_id_fkey" FOREIGN KEY ("boundary_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_shares" ADD CONSTRAINT "resource_shares_owner_principal_id_silo_id_fkey" FOREIGN KEY ("owner_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_resource_share_id_silo_id_fkey" FOREIGN KEY ("resource_share_id", "silo_id") REFERENCES "resource_shares"("id", "silo_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_principal_id_silo_id_fkey" FOREIGN KEY ("principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_granted_by_principal_id_silo_id_fkey" FOREIGN KEY ("granted_by_principal_id", "silo_id") REFERENCES "principals"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_share_recipients" ADD CONSTRAINT "resource_share_recipients_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "authorization_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "agent_revision_boundary_attachments_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "agent_revision_boundary_attachments"
    FOR EACH ROW EXECUTE FUNCTION "enforce_agent_revision_assignment_immutability"();

CREATE FUNCTION "enforce_resource_share_immutability"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'ResourceShare rows cannot be deleted; revoke recipients instead';
	END IF;
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
		OR NEW."resource_kind" IS DISTINCT FROM OLD."resource_kind"
		OR NEW."resource_id" IS DISTINCT FROM OLD."resource_id"
		OR NEW."owner_principal_id" IS DISTINCT FROM OLD."owner_principal_id"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'ResourceShare authority fields are immutable';
	END IF;
	RETURN NEW;
END;
$$;
CREATE TRIGGER "resource_shares_immutable" BEFORE UPDATE OR DELETE ON "resource_shares"
    FOR EACH ROW EXECUTE FUNCTION "enforce_resource_share_immutability"();

CREATE FUNCTION "enforce_resource_share_recipient_authority"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'ResourceShareRecipient rows cannot be updated';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	IF NOT EXISTS (
		SELECT 1
		FROM "resource_shares" share
		JOIN "authorization_grants" grant_row ON grant_row."id" = NEW."grant_id"
		WHERE share."id" = NEW."resource_share_id"
		  AND share."silo_id" = NEW."silo_id"
		  AND grant_row."silo_id" = NEW."silo_id"
		  AND grant_row."manager_id" = 'resource-share-editor'
		  AND grant_row."subject_kind" = 'principal'
		  AND grant_row."subject_group_id" IS NULL
		  AND grant_row."subject_principal_id" = NEW."principal_id"
		  AND grant_row."boundary_kind" = 'personal'
		  AND grant_row."boundary_group_id" IS NULL
		  AND grant_row."boundary_principal_id" = share."owner_principal_id"
		  AND grant_row."boundary_coverage" = 'exact'
		  AND grant_row."resource_kind" = share."resource_kind"
		  AND grant_row."resource_id" = share."resource_id"
		  AND grant_row."effect" = 'allow'
		  AND grant_row."revoked_at" IS NULL
		  AND grant_row."created_by" = NEW."granted_by_principal_id"
	) THEN
		RAISE EXCEPTION 'ResourceShareRecipient must link its exact active manager-owned grant';
	END IF;
	RETURN NEW;
END;
$$;
CREATE TRIGGER "resource_share_recipients_authority" BEFORE INSERT OR UPDATE ON "resource_share_recipients"
    FOR EACH ROW EXECUTE FUNCTION "enforce_resource_share_recipient_authority"();

CREATE FUNCTION "enforce_group_hierarchy"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	creates_cycle BOOLEAN;
BEGIN
	PERFORM pg_advisory_xact_lock(hashtextextended('opencrane:group-hierarchy:' || NEW."silo_id", 0));
	IF NEW."parent_id" IS NULL THEN
		RETURN NEW;
	END IF;

	WITH RECURSIVE ancestors("id", "parent_id", "silo_id", "path") AS (
		SELECT parent."id", parent."parent_id", parent."silo_id", ARRAY[parent."id"]
		FROM "groups" parent
		WHERE parent."id" = NEW."parent_id" AND parent."silo_id" = NEW."silo_id"
		UNION ALL
		SELECT parent."id", parent."parent_id", parent."silo_id", ancestors."path" || parent."id"
		FROM "groups" parent
		JOIN ancestors ON parent."id" = ancestors."parent_id" AND parent."silo_id" = ancestors."silo_id"
		WHERE NOT parent."id" = ANY(ancestors."path")
	)
	SELECT EXISTS (SELECT 1 FROM ancestors WHERE "id" = NEW."id" AND "silo_id" = NEW."silo_id") INTO creates_cycle;

    IF creates_cycle THEN
        RAISE EXCEPTION 'group hierarchy cannot contain a cycle' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "groups_hierarchy_guard" AFTER INSERT OR UPDATE OF "parent_id" ON "groups"
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "enforce_group_hierarchy"();

CREATE OR REPLACE FUNCTION "enforce_personal_configuration_change_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_silo TEXT; profile_user TEXT; active_persona TEXT; conversation_silo TEXT; conversation_service TEXT; conversation_mode "ConversationMode";
        run_silo TEXT; run_conversation TEXT; run_service TEXT; run_user TEXT; service_silo TEXT; service_kind "AgentServiceKind"; active_agent TEXT;
        refresh_change TEXT; applied_revision_profile TEXT; applied_revision_service TEXT; applied_revision_parent TEXT; applied_model_alias TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PersonalConfigurationChange rows cannot be deleted'; END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."state" <> 'proposed' THEN RAISE EXCEPTION 'PersonalConfigurationChange must begin as Proposed'; END IF;
        SELECT "silo_id", "user_id", "active_revision_id" INTO profile_silo, profile_user, active_persona
          FROM "persona_profiles" WHERE "id" = NEW."persona_profile_id" FOR UPDATE;
        SELECT "silo_id", "agent_service_id", "mode" INTO conversation_silo, conversation_service, conversation_mode
          FROM "conversations" WHERE "id" = NEW."source_conversation_id" FOR UPDATE;
        IF NOT EXISTS (SELECT 1 FROM "conversation_participants" WHERE "conversation_id" = NEW."source_conversation_id" AND "user_id" = NEW."user_id" AND "access_ended_position" IS NULL) THEN
            RAISE EXCEPTION 'PersonalConfigurationChange source conversation requires the initiating participant with current access';
        END IF;
        SELECT "silo_id", "conversation_id", "agent_service_id", "delegated_user_id" INTO run_silo, run_conversation, run_service, run_user
          FROM "agent_runs" WHERE "id" = NEW."source_run_id" FOR UPDATE;
        SELECT "silo_id", "kind", "active_revision_id" INTO service_silo, service_kind, active_agent
          FROM "agent_services" WHERE "id" = NEW."agent_service_id" FOR UPDATE;
        IF profile_silo IS DISTINCT FROM NEW."silo_id" OR profile_user IS DISTINCT FROM NEW."user_id"
           OR conversation_silo IS DISTINCT FROM NEW."silo_id" OR conversation_service IS DISTINCT FROM NEW."agent_service_id" OR conversation_mode IS DISTINCT FROM 'agent_session'
           OR run_silo IS DISTINCT FROM NEW."silo_id" OR run_conversation IS DISTINCT FROM NEW."source_conversation_id"
           OR run_service IS DISTINCT FROM NEW."agent_service_id" OR run_user IS DISTINCT FROM NEW."user_id"
           OR service_silo IS DISTINCT FROM NEW."silo_id" OR service_kind IS DISTINCT FROM 'personal'
           OR active_persona IS DISTINCT FROM NEW."expected_persona_revision_id" OR active_agent IS DISTINCT FROM NEW."expected_agent_revision_id" THEN
            RAISE EXCEPTION 'PersonalConfigurationChange provenance or active-revision fence conflict';
        END IF;
        IF NEW."source_message_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "conversation_messages" WHERE "id" = NEW."source_message_id" AND "conversation_id" = NEW."source_conversation_id") THEN
            RAISE EXCEPTION 'PersonalConfigurationChange source message must belong to its source conversation';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
       OR NEW."persona_profile_id" IS DISTINCT FROM OLD."persona_profile_id" OR NEW."agent_service_id" IS DISTINCT FROM OLD."agent_service_id"
       OR NEW."source_conversation_id" IS DISTINCT FROM OLD."source_conversation_id" OR NEW."source_run_id" IS DISTINCT FROM OLD."source_run_id"
       OR NEW."source_message_id" IS DISTINCT FROM OLD."source_message_id" OR NEW."requested_patch" IS DISTINCT FROM OLD."requested_patch"
       OR NEW."requested_patch_digest" IS DISTINCT FROM OLD."requested_patch_digest" OR NEW."expected_persona_revision_id" IS DISTINCT FROM OLD."expected_persona_revision_id"
       OR NEW."expected_agent_revision_id" IS DISTINCT FROM OLD."expected_agent_revision_id" OR NEW."proposed_at" IS DISTINCT FROM OLD."proposed_at" THEN
        RAISE EXCEPTION 'PersonalConfigurationChange proposal evidence is immutable';
    END IF;
    IF OLD."state" <> 'proposed' AND (NEW."decided_at" IS DISTINCT FROM OLD."decided_at" OR NEW."decided_by" IS DISTINCT FROM OLD."decided_by" OR NEW."rejection_reason" IS DISTINCT FROM OLD."rejection_reason") THEN
        RAISE EXCEPTION 'PersonalConfigurationChange decision evidence is immutable';
    END IF;
    IF OLD."state" = 'proposed' AND NEW."state" IN ('accepted', 'rejected') THEN RETURN NEW; END IF;
    IF OLD."state" = 'accepted' AND NEW."state" = 'applied' THEN
        IF NEW."requested_patch" = '{"kind":"persona_refresh"}'::jsonb THEN
            IF NEW."applied_persona_revision_id" IS NULL OR NEW."applied_agent_revision_id" IS NOT NULL THEN
                RAISE EXCEPTION 'persona_refresh requires an approved persona revision only';
            END IF;
            SELECT revision."persona_profile_id", interview."refresh_configuration_change_id"
              INTO applied_revision_profile, refresh_change
              FROM "persona_revisions" revision JOIN "persona_interviews" interview ON interview."id" = revision."interview_id"
              WHERE revision."id" = NEW."applied_persona_revision_id" AND revision."state" = 'approved' FOR UPDATE OF revision, interview;
            IF applied_revision_profile IS DISTINCT FROM NEW."persona_profile_id" OR refresh_change IS DISTINCT FROM NEW."id" THEN
                RAISE EXCEPTION 'applied persona refresh must use its exact approved interview-derived revision';
            END IF;
        ELSIF NEW."requested_patch"->>'kind' = 'model_alias' THEN
            IF NEW."applied_persona_revision_id" IS NOT NULL OR NEW."applied_agent_revision_id" IS NULL THEN
                RAISE EXCEPTION 'model_alias requires a published personal AgentRevision only';
            END IF;
            SELECT profile."active_revision_id" INTO active_persona
              FROM "persona_profiles" profile
              WHERE profile."id" = NEW."persona_profile_id" AND profile."silo_id" = NEW."silo_id" AND profile."user_id" = NEW."user_id"
              FOR UPDATE OF profile;
            IF active_persona IS DISTINCT FROM NEW."expected_persona_revision_id" THEN
                RAISE EXCEPTION 'applied model_alias must preserve the proposal persona revision';
            END IF;
            SELECT revision."agent_service_id", revision."parent_revision_id", definition."public_model_name"
              INTO applied_revision_service, applied_revision_parent, applied_model_alias
              FROM "agent_revisions" revision JOIN "model_definitions" definition ON definition."id" = revision."model_definition_id"
              WHERE revision."id" = NEW."applied_agent_revision_id" AND revision."state" = 'published' FOR UPDATE OF revision, definition;
            IF applied_revision_service IS DISTINCT FROM NEW."agent_service_id" OR applied_revision_parent IS DISTINCT FROM NEW."expected_agent_revision_id"
               OR applied_model_alias IS DISTINCT FROM NEW."requested_patch"->>'modelAlias'
               OR NOT EXISTS (SELECT 1 FROM "agent_services" service WHERE service."id" = NEW."agent_service_id" AND service."kind" = 'personal' AND service."state" = 'active' AND service."active_revision_id" = NEW."applied_agent_revision_id") THEN
                RAISE EXCEPTION 'applied model_alias must activate its exact published personal AgentRevision';
            END IF;
            IF EXISTS (
                SELECT 1 FROM "agent_revisions" child JOIN "agent_revisions" parent ON parent."id" = NEW."expected_agent_revision_id"
                WHERE child."id" = NEW."applied_agent_revision_id" AND (
                    child."prompt_policy_version" IS DISTINCT FROM parent."prompt_policy_version"
                    OR child."persona_revision_id" IS DISTINCT FROM parent."persona_revision_id"
                    OR child."persona_revision_id" IS DISTINCT FROM active_persona
                    OR child."budget" IS DISTINCT FROM parent."budget"
                )
            ) OR EXISTS (
                (SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id"
                 EXCEPT SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id")
                UNION ALL
                (SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id"
                 EXCEPT SELECT "skill_id", "skill_revision_id" FROM "agent_revision_skill_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id")
            ) OR EXISTS (
                (SELECT "integration_id", "silo_id", "custody_reference_id", "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id"
                 EXCEPT SELECT "integration_id", "silo_id", "custody_reference_id", "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id")
                UNION ALL
                (SELECT "integration_id", "silo_id", "custody_reference_id", "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id"
                 EXCEPT SELECT "integration_id", "silo_id", "custody_reference_id", "tool_definitions" FROM "agent_revision_integration_assignments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id")
            ) OR EXISTS (
				(SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id"
				 EXCEPT SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id")
				UNION ALL
				(SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."applied_agent_revision_id"
				 EXCEPT SELECT "silo_id", "boundary_kind", "boundary_group_id", "boundary_principal_id", "boundary_coverage" FROM "agent_revision_boundary_attachments" WHERE "agent_revision_id" = NEW."expected_agent_revision_id")
            ) THEN
                RAISE EXCEPTION 'applied model_alias may change only its model definition';
            END IF;
        ELSE
            RAISE EXCEPTION 'PersonalConfigurationChange has an unsupported applied patch';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PersonalConfigurationChange has an invalid lifecycle transition';
END;
$$;

DROP TYPE "AuthorizationScopeKind";
DROP TYPE "GrantScope";
DROP TYPE "GrantSubjectType";
DROP TYPE "FleetMembershipScopeKind";

CREATE FUNCTION public."fail_absurd_task_terminal"(
    p_queue_name TEXT,
    p_task_id UUID,
    p_reason JSONB
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_run_id UUID;
    v_attempt INTEGER;
BEGIN
    IF p_queue_name IS NULL OR btrim(p_queue_name) = '' OR NOT EXISTS (
        SELECT 1 FROM absurd.queues WHERE queue_name = p_queue_name
    ) THEN
        RAISE EXCEPTION 'Terminal workflow failure requires an existing Absurd queue';
    END IF;
    IF jsonb_typeof(p_reason) <> 'object' THEN
        RAISE EXCEPTION 'Terminal workflow failure reason must be a JSON object';
    END IF;

    EXECUTE format(
        'SELECT run_id, attempt
           FROM absurd.%I
          WHERE task_id = $1
            AND state IN (''running'', ''sleeping'')
          ORDER BY attempt DESC
          LIMIT 1
          FOR UPDATE',
        'r_' || p_queue_name
    )
    INTO v_run_id, v_attempt
    USING p_task_id;

    IF v_run_id IS NULL THEN
        RAISE EXCEPTION 'Absurd task % has no active run in queue %', p_task_id, p_queue_name;
    END IF;

    EXECUTE format(
        'UPDATE absurd.%I
            SET max_attempts = $2
          WHERE task_id = $1
            AND state NOT IN (''completed'', ''failed'', ''cancelled'')',
        't_' || p_queue_name
    )
    USING p_task_id, v_attempt;

    PERFORM absurd.fail_run(p_queue_name, v_run_id, p_reason, NULL);
END;
$$;

SELECT absurd.create_queue('control-plane');

INSERT INTO "opencrane_migrations"."schema_history" (
    "schema_version", "source_schema_version", "source_baseline_sha256",
    "target_baseline_sha256", "sql_sha256", "migration_id"
) VALUES (
    '0.9.3', '0.9.0', :'source_baseline_sha256',
    '7fa60a4bb68888a69ff2c9cdf23cd85e972c9521f9a51dacd564dead15b0c949',
    :'migration_sql_sha256', '0.9.0-to-0.9.3'
);

COMMIT;
SELECT pg_advisory_unlock(hashtextextended('opencrane:database-schema-migration', 0));
\endif
