# Archivo PDF online

La aplicación guarda cada PDF impreso en Supabase Storage y registra sus datos en la tabla `pdf_documents`. La página `archivo.html` muestra ese índice y permite buscar y abrir los documentos.

## Activación

1. Entrar al proyecto de Supabase configurado en `supabase-config.js`.
2. Abrir **SQL Editor**.
3. Copiar y ejecutar todo el contenido de `supabase-setup.sql` una sola vez.
4. Publicar juntos `index.html`, `archivo.html` y `supabase-config.js` en el mismo sitio web.

Al imprimir desde el resumen, la impresión del navegador se abre inmediatamente y la copia PDF se genera y sube en segundo plano. El enlace **PDF ONLINE** abre el archivo web.

## Seguridad

La configuración incluida permite lectura y carga anónimas porque el planillero actual no tiene usuarios. Es apropiada para una herramienta interna con URL controlada, pero no para documentos confidenciales publicados en Internet. Para restringirla correctamente hay que incorporar Supabase Auth y cambiar las políticas de `anon` a `authenticated`.
