-- Ejecutar en Supabase > SQL Editor para habilitar TARIMAS en el inventario compartido.
-- No agrega categorias ni equipos y conserva los permisos y datos existentes.
begin;
alter table public.inventory_categories drop constraint if exists inventory_categories_area_check;
alter table public.inventory_categories add constraint inventory_categories_area_check
  check (area in ('cctv', 'sonido', 'video', 'luces', 'tarimas'));
do $$ begin
  if to_regclass('public.inventory_combos') is not null then
    alter table public.inventory_combos drop constraint if exists inventory_combos_area_check;
    alter table public.inventory_combos add constraint inventory_combos_area_check
      check (area in ('cctv', 'sonido', 'video', 'luces', 'tarimas'));
  end if;
  if to_regclass('public.inventory_combo_items') is not null then
    alter table public.inventory_combo_items drop constraint if exists inventory_combo_items_item_area_check;
    alter table public.inventory_combo_items add constraint inventory_combo_items_item_area_check
      check (item_area in ('cctv', 'sonido', 'video', 'luces', 'tarimas'));
  end if;
end $$;
commit;
