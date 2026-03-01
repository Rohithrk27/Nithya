-- Expand prebuilt quest templates across daily, weekly, special, epic.
-- Idempotent: updates existing by (type,title) and inserts missing rows.

create extension if not exists pgcrypto;

alter table public.quests
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists type text,
  add column if not exists xp_reward integer not null default 0,
  add column if not exists stat_reward text,
  add column if not exists stat_reward_amount integer not null default 1,
  add column if not exists min_level_required integer not null default 0,
  add column if not exists progress_current integer not null default 0,
  add column if not exists progress_target integer not null default 100,
  add column if not exists status text not null default 'active',
  add column if not exists date date not null default current_date,
  add column if not exists expires_date date;

create index if not exists quests_type_level_title_idx
  on public.quests (type, min_level_required, title);

do $$
declare
  v_has_user_id boolean := false;
  v_user_id_required boolean := false;
  v_seed_user_id uuid := null;
  v_existing_id uuid;
  v_row record;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quests'
      and column_name = 'user_id'
  ) into v_has_user_id;

  if v_has_user_id then
    select (c.is_nullable = 'NO')
    into v_user_id_required
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'quests'
      and c.column_name = 'user_id'
    limit 1;

    begin
      execute 'select q.user_id from public.quests q where q.user_id is not null order by q.created_at desc nulls last limit 1'
      into v_seed_user_id;
    exception
      when undefined_column then
        v_seed_user_id := null;
    end;

    if v_seed_user_id is null then
      select u.id
      into v_seed_user_id
      from auth.users u
      order by u.created_at asc
      limit 1;
    end if;
  end if;

  for v_row in
    select *
    from (values
      ('daily',  'Hydration Protocol',      'Drink 8 glasses of water today.',                                   70,   'health',       1,   0,   1),
      ('daily',  'Deep Study Session',     'Focus on study or reading for 30 minutes.',                         85,   'intelligence', 1,   0,   1),
      ('daily',  'Movement Discipline',    'Complete at least one workout today.',                              90,   'strength',     1,   0,   1),
      ('daily',  'Career Sprint',          'Do one career-focused action today.',                               80,   'career',       1,   0,   1),
      ('daily',  'Social Pulse',           'Initiate one meaningful conversation.',                             75,   'social',       1,   0,   1),
      ('daily',  'Focus Sprint',           'Complete one uninterrupted 45-minute focus block.',                 88,   'consistency',  1,   0,   1),
      ('daily',  'Reflection Journal',     'Write a 10-minute reflection before sleep.',                        72,   'discipline',   1,   0,   1),
      ('daily',  'Inbox Zero Burst',       'Clear pending tasks/messages for 20 minutes.',                      78,   'career',       1,   0,   1),
      ('daily',  'Mindful Walk',           'Take a 20-minute mindful walk without distractions.',               74,   'health',       1,   0,   1),
      ('daily',  'Skill Repetition',       'Practice one core skill for 30 focused minutes.',                   86,   'intelligence', 1,   0,   1),
      ('daily',  'Early Start Protocol',   'Start your first key task within 30 minutes of wake-up.',          82,   'discipline',   1,   0,   1),
      ('daily',  'Zero Sugar Day',         'Avoid sugar-heavy foods for the full day.',                         84,   'health',       1,   0,   1),

      ('weekly', 'Iron Will Week',         'Complete all habits for 5 days this week.',                        420,  'discipline',   1,   0,   5),
      ('weekly', 'Scholar Momentum',       'Log 5 study blocks this week.',                                    390,  'intelligence', 1,   0,   5),
      ('weekly', 'Strength Rhythm',        'Finish 4 workouts this week.',                                     410,  'strength',     1,   0,   4),
      ('weekly', 'Social Circuit',         'Reach out to 5 people this week.',                                 360,  'social',       1,   0,   5),
      ('weekly', 'Career Pipeline',        'Complete 5 career-growth actions this week.',                      430,  'career',       1,   0,   5),
      ('weekly', 'Consistency Grid',       'Close 6 days with zero missed priority habits.',                   450,  'consistency',  1,   0,   6),
      ('weekly', 'Recovery Standard',      'Track sleep/recovery for 7 days this week.',                       380,  'health',       1,   0,   7),
      ('weekly', 'Focus Marathon',         'Complete 6 deep work sessions this week.',                         440,  'intelligence', 1,   0,   6),

      ('special','Special Quest Lv20',     'Maintain a 7-day consistency streak.',                             650,  'consistency',  1,   20,  7),
      ('special','Special Quest Lv40',     'Complete 14 focused sessions in one cycle.',                       820,  'discipline',   1,   40,  14),
      ('special','Special Quest Lv60',     'Complete 20 deep work blocks.',                                    980,  'career',       1,   60,  20),
      ('special','Special Quest Lv80',     'Track health goals for 21 days.',                                  1140, 'health',       1,   80,  21),
      ('special','Special Quest Lv100',    'Finish 30 study sessions at high focus.',                          1300, 'intelligence', 1,   100, 30),
      ('special','Special Quest Lv120',    'Sustain 30 days of on-time task starts.',                          1450, 'discipline',   1,   120, 30),
      ('special','Special Quest Lv140',    'Complete 35 strength/health checkpoints.',                         1600, 'strength',     1,   140, 35),
      ('special','Special Quest Lv160',    'Close 40 days with full consistency score.',                       1780, 'consistency',  1,   160, 40),
      ('special','Special Quest Lv180',    'Deliver 45 career-intelligence milestones.',                       1960, 'career',       1,   180, 45),

      ('epic',   'Epic Quest Lv100',       'Sustain elite discipline for 30 days.',                            5200, 'discipline',   1,   100, 30),
      ('epic',   'Epic Quest Lv200',       'Hit advanced multi-stat growth checkpoints.',                      7900, 'consistency',  1,   200, 40),
      ('epic',   'Epic Quest Lv300',       'Complete a full-system mastery cycle.',                            10800,'career',       1,   300, 50),
      ('epic',   'Epic Quest Lv400',       'Maintain mastery discipline across 60 days.',                      13200,'discipline',   1,   400, 60),
      ('epic',   'Epic Quest Lv500',       'Clear a top-tier progression gauntlet.',                           15800,'consistency',  1,   500, 70)
    ) as t(
      type,
      title,
      description,
      xp_reward,
      stat_reward,
      stat_reward_amount,
      min_level_required,
      progress_target
    )
  loop
    v_existing_id := null;

    update public.quests q
    set
      description = coalesce(v_row.description, q.description),
      type = lower(trim(coalesce(v_row.type, 'daily'))),
      xp_reward = greatest(0, coalesce(v_row.xp_reward, q.xp_reward, 0)),
      stat_reward = nullif(trim(coalesce(v_row.stat_reward, '')), ''),
      stat_reward_amount = greatest(1, coalesce(v_row.stat_reward_amount, q.stat_reward_amount, 1)),
      min_level_required = greatest(0, coalesce(v_row.min_level_required, q.min_level_required, 0)),
      progress_target = greatest(1, coalesce(v_row.progress_target, q.progress_target, 100)),
      progress_current = least(
        greatest(0, coalesce(q.progress_current, 0)),
        greatest(1, coalesce(v_row.progress_target, q.progress_target, 100))
      ),
      status = 'active',
      date = coalesce(q.date, current_date),
      expires_date = null
    where lower(trim(coalesce(q.title, ''))) = lower(v_row.title)
      and lower(coalesce(q.type, 'daily')) = lower(trim(coalesce(v_row.type, 'daily')))
    returning q.id
    into v_existing_id;

    if v_existing_id is not null then
      continue;
    end if;

    if v_has_user_id then
      if v_seed_user_id is null and v_user_id_required then
        raise notice 'Skipping quest seed for %, user_id required but no auth.users row available', v_row.title;
        continue;
      end if;

      insert into public.quests (
        user_id,
        title,
        description,
        type,
        xp_reward,
        stat_reward,
        stat_reward_amount,
        min_level_required,
        progress_target,
        progress_current,
        status,
        date,
        expires_date
      )
      values (
        v_seed_user_id,
        v_row.title,
        coalesce(v_row.description, ''),
        lower(trim(coalesce(v_row.type, 'daily'))),
        greatest(0, coalesce(v_row.xp_reward, 0)),
        nullif(trim(coalesce(v_row.stat_reward, '')), ''),
        greatest(1, coalesce(v_row.stat_reward_amount, 1)),
        greatest(0, coalesce(v_row.min_level_required, 0)),
        greatest(1, coalesce(v_row.progress_target, 100)),
        0,
        'active',
        current_date,
        null
      );
    else
      insert into public.quests (
        title,
        description,
        type,
        xp_reward,
        stat_reward,
        stat_reward_amount,
        min_level_required,
        progress_target,
        progress_current,
        status,
        date,
        expires_date
      )
      values (
        v_row.title,
        coalesce(v_row.description, ''),
        lower(trim(coalesce(v_row.type, 'daily'))),
        greatest(0, coalesce(v_row.xp_reward, 0)),
        nullif(trim(coalesce(v_row.stat_reward, '')), ''),
        greatest(1, coalesce(v_row.stat_reward_amount, 1)),
        greatest(0, coalesce(v_row.min_level_required, 0)),
        greatest(1, coalesce(v_row.progress_target, 100)),
        0,
        'active',
        current_date,
        null
      );
    end if;
  end loop;
end;
$$;
