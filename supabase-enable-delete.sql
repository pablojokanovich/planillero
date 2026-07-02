-- Ejecutar una sola vez en Supabase > SQL Editor si supabase-setup.sql
-- ya había sido ejecutado antes de agregar el botón ELIMINAR.

grant delete on table public.pdf_documents to anon;

drop policy if exists "PDF records can be deleted" on public.pdf_documents;
create policy "PDF records can be deleted"
on public.pdf_documents for delete to anon
using (true);

drop policy if exists "Planillero PDFs can be deleted" on storage.objects;
create policy "Planillero PDFs can be deleted"
on storage.objects for delete to anon
using (
  bucket_id = 'planillas'
  and lower(storage.extension(name)) = 'pdf'
);
