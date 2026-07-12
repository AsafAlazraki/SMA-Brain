-- Autonomous learning provenance: the brain can now propose knowledge it
-- researched or mined itself (never auto-approved — still queue-gated for
-- Tony per guardrail 3). New source_type values on the queue, matching
-- source values on approved entries, and a source_ref that carries the
-- evidence (product ids, source URLs, verifier verdict) so Tony reviews with
-- the receipts in front of him.

alter table learning_queue drop constraint learning_queue_source_type_check;
alter table learning_queue add constraint learning_queue_source_type_check
  check (source_type in (
    'teach_session','blurt','correction','email_edit','email_mining','staff_suggestion',
    'autonomous_research','catalog_mining'
  ));

alter table knowledge_entries drop constraint knowledge_entries_source_check;
alter table knowledge_entries add constraint knowledge_entries_source_check
  check (source in ('seed','taught','correction','email_edit','manual','research','catalog'));

-- lets the resolver mark a gap answered once coverage lands, without needing
-- a human — 'answered' already exists in the status check, this is just a note
comment on column knowledge_gaps.status is
  'open | queued_for_teach | answered | dismissed. Autonomous resolver flips open→answered when retrieval starts covering it.';
