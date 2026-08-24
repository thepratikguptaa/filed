drop index if exists chunks_embedding_idx;

delete from chunks;
delete from documents;

alter table chunks drop column if exists embedding;
alter table chunks add column embedding vector(384);

create index chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);
