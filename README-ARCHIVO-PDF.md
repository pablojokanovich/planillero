# Archivo PDF online

La aplicación guarda cada PDF impreso en Supabase Storage y registra sus datos en la tabla `pdf_documents`. La página `archivo.html` muestra ese índice y permite buscar y abrir los documentos.

## Activación

1. Entrar al proyecto de Supabase configurado en `supabase-config.js`.
2. Abrir **SQL Editor**.
3. Copiar y ejecutar todo el contenido de `supabase-setup.sql` una sola vez.
4. Publicar juntos `index.html`, `archivo.html` y `supabase-config.js` en el mismo sitio web.

Al imprimir desde el resumen, la impresión del navegador se abre inmediatamente y la copia PDF se genera y sube en segundo plano. El enlace **PDF ONLINE** abre el archivo web.

Si la configuración inicial ya se había ejecutado antes de incorporar el botón **ELIMINAR**, ejecutar también `supabase-enable-delete.sql` una sola vez. El borrado solicita confirmación y elimina tanto el objeto de Storage como su fila en `pdf_documents`.

Para compartir las categorías y equipos entre todos los navegadores, ejecutar una vez `supabase-enable-online-inventory.sql`. Al abrir el planillero por primera vez, la app copia automáticamente el inventario incluido en `index.html` a las tablas online. Desde ese momento, las altas y bajas del panel administrativo se guardan en Supabase; `localStorage` queda sólo como caché de respaldo sin conexión.

Para compartir el listado de Citaciones, ejecutar una vez `supabase-enable-freelancers.sql`. Al abrir `citaciones.html`, la app copia automáticamente los freelancers incluidos en el HTML si la tabla está vacía. Las altas y eliminaciones se sincronizan online y el navegador conserva una copia local de respaldo.

Si la tabla de freelancers fue creada antes de incorporar el tipo de alimentación, ejecutar una vez `supabase-enable-freelancer-food.sql`. Esto permite guardar online las opciones Común, Vegetariano y Sin TACC, además de las ediciones de cada operador.

Para usar la planilla online de deposito, ejecutar una vez `supabase-enable-deposito-checklists.sql` y publicar tambien `deposito.html`. Desde ese momento, cada PDF nuevo crea una checklist temporal de 60 dias con link para celular. En `archivo.html` aparece el boton **DEPOSITO** junto al PDF mientras la checklist no este vencida.

Las checklists ocupan muy poco espacio porque guardan texto, cantidades y checks. Si se quiere limpiar lo vencido, ejecutar en Supabase:

```sql
select public.delete_expired_deposit_checklists();
```

## Seguridad

La configuración incluida permite lectura y carga anónimas porque el planillero actual no tiene usuarios. Es apropiada para una herramienta interna con URL controlada, pero no para documentos confidenciales publicados en Internet. Para restringirla correctamente hay que incorporar Supabase Auth y cambiar las políticas de `anon` a `authenticated`.
