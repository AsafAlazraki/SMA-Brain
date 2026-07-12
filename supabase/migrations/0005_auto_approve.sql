-- Auto-approval: self-taught knowledge that clears the verifier can go LIVE
-- without waiting for Tony (his call, 2026-07-12). The adversarial verifier
-- becomes the gate; Tony reviews + corrects after the fact instead of before.
-- SMA-internal facts (prices/policies) are NEVER auto-approved — only Tony.
--
--   off      — everything still queues (original behaviour)
--   catalog  — verified catalogue-grounded cards auto-approve
--   external — catalogue + verified web-researched cards auto-approve
--   all      — anything that passes verify auto-approves
alter table app_settings
  add column if not exists auto_approve_mode text not null default 'off'
  check (auto_approve_mode in ('off', 'catalog', 'external', 'all'));

update app_settings set auto_approve_mode = 'external' where id = 1;

-- Evidence trail for auto-published cards so Tony reviews with receipts and
-- can spot/correct anything the brain taught itself. Null for hand-authored.
alter table knowledge_entries
  add column if not exists provenance jsonb;

-- Fast lookup of "what did the brain teach itself" (auto-approved = no human approver)
create index if not exists knowledge_entries_autolearned_idx
  on knowledge_entries (created_at desc)
  where approved_by is null and source in ('catalog', 'research');
