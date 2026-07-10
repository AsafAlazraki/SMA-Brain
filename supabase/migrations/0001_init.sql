-- Tony's Brain — initial schema
-- Conventions: all tables RLS-enabled; roles via profiles.role ('admin'|'staff');
-- public (anon) access is Phase 2 and gets its own policies/RPCs later — nothing here grants anon.

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------- helpers (part 1) ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ---------- profiles ----------
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('admin','staff')),
  display_name text not null default '',
  prefs jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- is_admin() must be created AFTER profiles: sql-language bodies are validated at creation time.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.user_id = auth.uid() and p.role = 'admin');
$$;

alter table profiles enable row level security;
create policy "profiles: read own or admin" on profiles for select
  using (user_id = auth.uid() or is_admin());
create policy "profiles: admin manages" on profiles for all
  using (is_admin()) with check (is_admin());
create policy "profiles: self-update display/prefs" on profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid() and role = (select role from profiles where user_id = auth.uid()));

-- ---------- products (catalog) ----------
create table products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  brand text,
  model text,
  name text not null,
  category text,
  industries text[] not null default '{}',
  price_ex_gst numeric,
  currency text not null default 'AUD',
  specs jsonb not null default '{}',
  description text,
  url text,
  image_url text,
  status text not null default 'active' check (status in ('active','discontinued','hidden')),
  source text not null default 'scrape',
  scraped_at timestamptz,
  embedding vector(768),
  embed_model text,
  tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(name,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(brand,'') || ' ' || coalesce(model,'') || ' ' || coalesce(sku,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(category,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_tsv_idx on products using gin (tsv);
create index products_trgm_idx on products using gin ((coalesce(brand,'') || ' ' || coalesce(model,'') || ' ' || coalesce(name,'')) gin_trgm_ops);
create index products_embedding_idx on products using hnsw (embedding vector_cosine_ops);
create trigger products_touch before update on products for each row execute function touch_updated_at();
alter table products enable row level security;
create policy "products: staff read active" on products for select
  using (auth.uid() is not null and (status <> 'hidden' or is_admin()));
create policy "products: admin writes" on products for all
  using (is_admin()) with check (is_admin());

-- ---------- knowledge_entries (the Brain) ----------
create table knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  visibility text not null default 'internal' check (visibility in ('internal','public')),
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  source text not null default 'manual' check (source in ('seed','taught','correction','email_edit','manual')),
  version int not null default 1,
  supersedes_id uuid references knowledge_entries(id),
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  embedding vector(768),
  embed_model text,
  tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(content,'')), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_tsv_idx on knowledge_entries using gin (tsv);
create index knowledge_embedding_idx on knowledge_entries using hnsw (embedding vector_cosine_ops);
create index knowledge_status_idx on knowledge_entries (status, visibility);
create trigger knowledge_touch before update on knowledge_entries for each row execute function touch_updated_at();
alter table knowledge_entries enable row level security;
create policy "knowledge: staff read approved" on knowledge_entries for select
  using (auth.uid() is not null and (status = 'approved' or is_admin()));
create policy "knowledge: admin writes" on knowledge_entries for all
  using (is_admin()) with check (is_admin());

-- ---------- knowledge_gaps ----------
create table knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  normalized_question text not null,
  times_asked int not null default 1,
  asked_by uuid[] not null default '{}',
  status text not null default 'open' check (status in ('open','queued_for_teach','answered','dismissed')),
  resolved_by_entry_id uuid references knowledge_entries(id),
  first_asked_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now()
);
create unique index gaps_normalized_idx on knowledge_gaps (normalized_question);
alter table knowledge_gaps enable row level security;
create policy "gaps: staff read" on knowledge_gaps for select using (auth.uid() is not null);
create policy "gaps: staff insert" on knowledge_gaps for insert with check (auth.uid() is not null);
create policy "gaps: admin manages" on knowledge_gaps for update using (is_admin()) with check (is_admin());

-- ---------- conversations & messages ----------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'chat' check (mode in ('chat','draft','teach','blurt')),
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on conversations (user_id, updated_at desc);
create trigger conversations_touch before update on conversations for each row execute function touch_updated_at();
alter table conversations enable row level security;
create policy "conversations: own or admin" on conversations for select
  using (user_id = auth.uid() or is_admin());
create policy "conversations: own insert" on conversations for insert with check (user_id = auth.uid());
create policy "conversations: own update" on conversations for update using (user_id = auth.uid());

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null default '',
  tool_calls jsonb,
  cited_entry_ids uuid[] not null default '{}',
  cited_product_ids uuid[] not null default '{}',
  feedback text check (feedback in ('up','down','flag')),
  feedback_note text,
  voice_used boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on messages (conversation_id, created_at);
alter table messages enable row level security;
create policy "messages: via own conversation" on messages for select
  using (exists (select 1 from conversations c where c.id = conversation_id and (c.user_id = auth.uid() or is_admin())));
create policy "messages: insert via own conversation" on messages for insert
  with check (exists (select 1 from conversations c where c.id = conversation_id and c.user_id = auth.uid()));
create policy "messages: feedback update via own conversation" on messages for update
  using (exists (select 1 from conversations c where c.id = conversation_id and (c.user_id = auth.uid() or is_admin())));

-- ---------- email_drafts ----------
create table email_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete set null,
  user_id uuid not null references auth.users(id),
  customer_email_text text not null,
  mined_topics jsonb,            -- fast-model extraction of questions/themes (no PII beyond what's inherent)
  draft_text text not null,
  confidence_flags jsonb,        -- [{span, reason}] low-confidence sentences flagged in UI
  final_text text,               -- what staff actually copied out (set on "copy" or explicit confirm)
  edit_distance int,
  learned boolean not null default false,
  created_at timestamptz not null default now()
);
create index email_drafts_user_idx on email_drafts (user_id, created_at desc);
alter table email_drafts enable row level security;
create policy "drafts: own or admin" on email_drafts for select using (user_id = auth.uid() or is_admin());
create policy "drafts: own insert" on email_drafts for insert with check (user_id = auth.uid());
create policy "drafts: own update" on email_drafts for update using (user_id = auth.uid() or is_admin());

-- ---------- learning_queue ----------
create table learning_queue (
  id uuid primary key default gen_random_uuid(),
  proposed_title text not null,
  proposed_content text not null,
  proposed_tags text[] not null default '{}',
  proposed_visibility text not null default 'internal' check (proposed_visibility in ('internal','public')),
  source_type text not null check (source_type in ('teach_session','blurt','correction','email_edit','email_mining','staff_suggestion')),
  source_ref jsonb,              -- {conversation_id?, message_id?, email_draft_id?, teach_session_id?}
  conflict_entry_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected','merged')),
  resulting_entry_id uuid references knowledge_entries(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index learning_queue_status_idx on learning_queue (status, created_at);
alter table learning_queue enable row level security;
create policy "queue: staff read own, admin all" on learning_queue for select
  using (created_by = auth.uid() or is_admin());
create policy "queue: staff propose" on learning_queue for insert with check (auth.uid() is not null);
create policy "queue: admin reviews" on learning_queue for update using (is_admin()) with check (is_admin());

-- ---------- teach_sessions ----------
create table teach_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  kind text not null default 'interview' check (kind in ('interview','blurt')),
  transcript text not null default '',
  audio_path text,               -- supabase storage ref
  gaps_addressed uuid[] not null default '{}',
  cards_proposed int not null default 0,
  cards_approved int not null default 0,
  created_at timestamptz not null default now()
);
alter table teach_sessions enable row level security;
create policy "teach: admin only" on teach_sessions for all using (is_admin()) with check (is_admin());

-- ---------- style_profile (versioned) ----------
create table style_profile (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  tone_rules text not null default '',
  signoff text not null default '',
  phrases_preferred text[] not null default '{}',
  phrases_banned text[] not null default '{}',
  example_pairs jsonb not null default '[]',   -- [{before, after, note}]
  policies text not null default '',           -- freight/deposit/warranty wording etc.
  is_active boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create unique index style_profile_active_idx on style_profile (is_active) where is_active;
alter table style_profile enable row level security;
create policy "style: staff read active" on style_profile for select
  using (auth.uid() is not null and (is_active or is_admin()));
create policy "style: admin writes" on style_profile for all using (is_admin()) with check (is_admin());

-- ---------- app_settings (singleton) ----------
create table app_settings (
  id int primary key default 1 check (id = 1),
  self_learning_enabled boolean not null default true,
  voice_out_default boolean not null default true,
  public_bot_enabled boolean not null default false,
  extra jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into app_settings (id) values (1);
create trigger settings_touch before update on app_settings for each row execute function touch_updated_at();
alter table app_settings enable row level security;
create policy "settings: staff read" on app_settings for select using (auth.uid() is not null);
create policy "settings: admin writes" on app_settings for update using (is_admin()) with check (is_admin());

-- ---------- usage_events ----------
create table usage_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id),
  kind text not null,            -- chat_turn | draft | stt_seconds | tts_chars | teach | ingest ...
  model text,
  tokens_in int,
  tokens_out int,
  cost_estimate_usd numeric,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index usage_events_kind_idx on usage_events (kind, created_at);
alter table usage_events enable row level security;
create policy "usage: admin reads" on usage_events for select using (is_admin());
create policy "usage: authenticated insert" on usage_events for insert with check (auth.uid() is not null);

-- ---------- hybrid search RPCs ----------
-- RRF fusion of FTS and vector similarity. SECURITY INVOKER: RLS applies to the caller.
create or replace function search_knowledge(
  query_text text,
  query_embedding vector(768),
  match_count int default 8
) returns table (id uuid, title text, content text, tags text[], visibility text, score float)
language sql stable as $$
  with fts as (
    select ke.id, row_number() over (order by ts_rank_cd(ke.tsv, websearch_to_tsquery('english', query_text)) desc) as r
    from knowledge_entries ke
    where ke.status = 'approved' and ke.tsv @@ websearch_to_tsquery('english', query_text)
    limit 40
  ),
  vec as (
    select ke.id, row_number() over (order by ke.embedding <=> query_embedding) as r
    from knowledge_entries ke
    where ke.status = 'approved' and ke.embedding is not null
    order by ke.embedding <=> query_embedding
    limit 40
  ),
  fused as (
    select coalesce(f.id, v.id) as id,
           coalesce(1.0/(60+f.r), 0) + coalesce(1.0/(60+v.r), 0) as score
    from fts f full outer join vec v using (id)
  )
  select ke.id, ke.title, ke.content, ke.tags, ke.visibility, fu.score
  from fused fu join knowledge_entries ke on ke.id = fu.id
  order by fu.score desc
  limit match_count;
$$;

create or replace function search_products(
  query_text text,
  query_embedding vector(768),
  match_count int default 6
) returns table (id uuid, sku text, brand text, model text, name text, category text,
                 price_ex_gst numeric, url text, image_url text, description text, score float)
language sql stable as $$
  with fts as (
    select p.id, row_number() over (order by ts_rank_cd(p.tsv, websearch_to_tsquery('english', query_text)) desc) as r
    from products p
    where p.status = 'active' and p.tsv @@ websearch_to_tsquery('english', query_text)
    limit 40
  ),
  trgm as (  -- catches model-number near-misses: "LU2810" ~ "LU-2810"
    select p.id, row_number() over (order by similarity(coalesce(p.brand,'')||' '||coalesce(p.model,'')||' '||p.name, query_text) desc) as r
    from products p
    where p.status = 'active'
      and similarity(coalesce(p.brand,'')||' '||coalesce(p.model,'')||' '||p.name, query_text) > 0.15
    limit 40
  ),
  vec as (
    select p.id, row_number() over (order by p.embedding <=> query_embedding) as r
    from products p
    where p.status = 'active' and p.embedding is not null
    order by p.embedding <=> query_embedding
    limit 40
  ),
  fused as (
    select coalesce(f.id, t.id, v.id) as id,
           coalesce(1.0/(60+f.r),0) + coalesce(1.0/(60+t.r),0) + coalesce(1.0/(60+v.r),0) as score
    from fts f
    full outer join trgm t using (id)
    full outer join vec v using (id)
  )
  select p.id, p.sku, p.brand, p.model, p.name, p.category, p.price_ex_gst, p.url, p.image_url, p.description, fu.score
  from fused fu join products p on p.id = fu.id
  order by fu.score desc
  limit match_count;
$$;

-- ---------- role grants ----------
-- Table privileges for Supabase API roles; ROW access is still governed by RLS above.
-- service_role bypasses RLS by design (server-side only). anon gets nothing in v1 (Phase 2 adds scoped RPCs).
grant usage on schema public to anon, authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
