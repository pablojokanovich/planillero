# Archivo PDF online

La aplicación guarda cada PDF impreso en Supabase Storage y registra sus datos en la tabla `pdf_documents`. La página `archivo.html` muestra ese índice y permite buscar y abrir los documentos.

## Activación

1. Entrar al proyecto de Supabase configurado en `supabase-config.js`.
2. Abrir **SQL Editor**.
3. Copiar y ejecutar todo el contenido de `supabase-setup.sql` una sola vez.
4. Publicar juntos `index.html`, `inicio.css`, `inicio.js`, la carpeta `assets`, `planillero.html`, `archivo.html` y `supabase-config.js` en el mismo sitio web.

`index.html` es el menu principal con seis accesos grandes. El planillero esta en
`planillero.html`; Remitos abre `planillero.html?remito=manual` directamente.
Los borradores existentes se conservan en las mismas claves de almacenamiento.

Al imprimir desde el resumen, la impresión del navegador se abre inmediatamente y la copia PDF se genera y sube en segundo plano. El enlace **PDF ONLINE** abre el archivo web.

Si la configuración inicial ya se había ejecutado antes de incorporar el botón **ELIMINAR**, ejecutar también `supabase-enable-delete.sql` una sola vez. El borrado solicita confirmación y elimina tanto el objeto de Storage como su fila en `pdf_documents`.

Para compartir las categorías y equipos entre todos los navegadores, ejecutar una vez `supabase-enable-online-inventory.sql`. Al abrir el planillero por primera vez, la app copia automáticamente el inventario incluido en `planillero.html` a las tablas online. Desde ese momento, las altas y bajas del panel administrativo se guardan en Supabase; `localStorage` queda sólo como caché de respaldo sin conexión.

Para compartir el listado de Citaciones, ejecutar una vez `supabase-enable-freelancers.sql`. Al abrir `citaciones.html`, la app copia automáticamente los freelancers incluidos en el HTML si la tabla está vacía. Las altas y eliminaciones se sincronizan online y el navegador conserva una copia local de respaldo.

Si la tabla de freelancers fue creada antes de incorporar el tipo de alimentación, ejecutar una vez `supabase-enable-freelancer-food.sql`. Esto permite guardar online las opciones Común, Vegetariano y Sin TACC, además de las ediciones de cada operador.

Para usar la planilla online de deposito, ejecutar una vez `supabase-enable-deposito-checklists.sql` y publicar tambien `deposito.html`. Desde ese momento, cada PDF nuevo crea una checklist temporal de 60 dias con link para celular. En `archivo.html` aparece el boton **DEPOSITO** junto al PDF mientras la checklist no este vencida.

Las checklists ocupan muy poco espacio porque guardan texto, cantidades y checks. Si se quiere limpiar lo vencido, ejecutar en Supabase:

```sql
select public.delete_expired_deposit_checklists();
```

## Logistica y Eventos

`salidas.html` permite crear, editar y eliminar salidas, con carga, salida, origen,
chofer, modelo (Sprinter, Iveco o Mercedes Benz), y destinos ordenados con direccion
y hora estimada de llegada. La fecha de salida se carga una sola vez; el resto de los
campos son solo horas. Si el recorrido cruza medianoche, se calcula el dia siguiente
y se muestra junto a la hora. Una carga posterior a la hora de salida corresponde
al dia anterior. Los horarios se cargan como hora local de la operacion.

La vista de salidas presenta una lista compacta a la izquierda y un calendario mensual
a la derecha. Seleccionar un dia filtra la lista; Nueva salida usa esa fecha. Las salidas
del calendario se pueden abrir para editar. En celular, el calendario aparece encima
de la lista. Los filtros de camion, busqueda y rango de fechas se aplican a ambas vistas.
Mientras la pagina este visible, las salidas y los listados se actualizan automaticamente
cada cinco minutos, conservando la fecha seleccionada y los formularios en curso.

Para compartir las salidas entre equipos, ejecutar una vez `supabase-enable-logistica.sql`
en el SQL Editor de Supabase. Hasta activarlo, la pagina funciona con guardado local
y muestra ese estado. Los cambios pendientes se sincronizan al recuperar la conexion.
Las eliminaciones son logicas y tambien se sincronizan.

En Configuracion de Salida de camiones se agregan nuevos choferes y destinos habituales,
con direccion opcional. Los choferes iniciales son Jonathan Robles y Emanuel Ledesma.
Los destinos iniciales son Centro de Convenciones, La Rural, Sheraton Retiro,
Sheraton Greenville, BA Ferial y Deposito Central. Cada parada tambien admite Otro destino
para escribir uno manualmente sin agregarlo al listado habitual. Se conservan los choferes
y destinos de salidas anteriores, aunque no figuren en el listado actual.
Para compartir los nuevos listados, ejecutar ademas `supabase-enable-logistica-catalogo.sql`.
Hasta activarlo, las altas se guardan localmente y quedan pendientes de sincronizacion.

`eventos.html` lee automaticamente las planillas de `pdf_documents`, las agrupa por
numero de orden y las ordena por fecha de armado. La orden se identifica sin el prefijo
de anio `2026-` (por ejemplo, `2026-123` y `123` son la misma orden).
Al pasar el dia de desarme, el evento se oculta de la lista izquierda pero sigue en el
calendario historico; no se elimina ningun PDF. Sin fecha de desarme, permanece en la lista.
El dia actual se distingue con fondo y borde celeste y la etiqueta HOY. Los datos mas recientes
de cada orden tienen prioridad. Los registros sin numero de orden se separan por evento.

La agenda muestra tambien un calendario mensual con numero de orden, nombre, locacion
y etapa (armado/desarme). Cada evento ocupa los dias entre armado y desarme inclusive.
Al seleccionar un dia, la lista lateral muestra sus eventos aun pendientes de desarme;
al pulsar un evento pendiente se despliegan sus planillas. Ver todos vuelve a la lista de pendientes y permite
consultar los eventos sin fecha, que no se colocan en un dia arbitrario del calendario.

Publicar tambien `salidas.js`, `eventos.js`, `logistica.js`, `logistica.css` y
`logistica-nav.css`, junto a las nuevas paginas y la configuracion actualizada.
El enlace entre eventos y salidas queda pendiente de una siguiente etapa.

## Seguridad

Los avisos de nuevas salidas y su instalacion estan documentados en
`AVISOS-Y-SEGURIDAD.md`. La configuracion de destinatarios utiliza cuentas habilitadas,
no las claves de administracion incluidas en el HTML. El envio de mails requiere
desplegar la funcion y configurar un remitente/proveedor; no basta publicar el HTML.

La configuración incluida permite lectura y carga anónimas porque el planillero actual no tiene usuarios. Es apropiada para una herramienta interna con URL controlada, pero no para documentos confidenciales publicados en Internet. Para restringirla correctamente hay que incorporar Supabase Auth y cambiar las políticas de `anon` a `authenticated`.
