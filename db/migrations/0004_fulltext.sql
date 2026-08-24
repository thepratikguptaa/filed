alter table chunks
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', text)) stored;

create index if not exists chunks_search_idx on chunks using gin (search_vector);
