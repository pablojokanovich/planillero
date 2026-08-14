-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Habilita editar metadatos de planillas y reemplazar PDFs existentes.

grant update on table public.pdf_documents to anon;

drop policy if exists "PDF records can be updated" on public.pdf_documents;
create policy "PDF records can be updated"
on public.pdf_documents for update to anon
using (true)
with check (
  storage_path like '____/__/%.pdf'
  and file_size >= 0
  and total_units >= 0
);

drop policy if exists "Planillero can replace PDFs" on storage.objects;
create policy "Planillero can replace PDFs"
on storage.objects for update to anon
using (
  bucket_id = 'planillas'
  and lower(storage.extension(name)) = 'pdf'
)
with check (
  bucket_id = 'planillas'
  and lower(storage.extension(name)) = 'pdf'
);
