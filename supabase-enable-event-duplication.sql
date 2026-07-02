-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Guarda una copia estructurada del evento junto a cada PDF nuevo para poder duplicarlo.

alter table public.pdf_documents
add column if not exists event_data jsonb;
