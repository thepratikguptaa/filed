create extension if not exists vector;

create table if not exists documents (
  id text primary key,
  cik text not null,
  company text not null,
  ticker text not null,
  filing_type text not null,
  fiscal_year int not null,
  period_end date,
  filed_date date,
  source_url text not null,
  content_hash text not null,
  chunk_count int not null default 0,
  ingested_at timestamptz not null default now()
);

create table if not exists chunks (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  company text not null,
  ticker text not null,
  filing_type text not null,
  fiscal_year int not null,
  section text,
  section_title text,
  position int not null,
  text text not null,
  token_count int not null,
  has_table boolean not null default false,
  content_hash text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists chunks_document_idx on chunks (document_id);
create index if not exists chunks_filter_idx on chunks (ticker, fiscal_year, section);
create index if not exists chunks_hash_idx on chunks (content_hash);

create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);
