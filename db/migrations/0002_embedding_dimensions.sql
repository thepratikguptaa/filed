drop index if exists chunks_embedding_idx;

alter table chunks drop column if exists embedding;
alter table chunks add column embedding vector(768);

create index chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);
