# Accesos compartidos

Estado: preparado en los archivos, pendiente de instalar en Supabase. `APP_ACCESS_ENABLED`
permanece en `false` para conservar el ingreso actual hasta verificar ambos perfiles.
Mientras tanto, la aplicacion no esta protegida por estos accesos.

El administrador puede usar toda la app. Consulta puede abrir Planillas hechas y sus PDF,
Salida de camiones y Eventos cargados; no puede modificar datos ni generar remitos.
Las claves solicitadas se ingresan durante la instalacion, no se publican en JavaScript.
Las claves cortas elegidas son faciles de adivinar: conviene reemplazarlas por claves
largas despues de la prueba. Las cuentas compartidas no permiten identificar a cada persona.

## Instalacion por quien administra Supabase

1. Conservar una copia de seguridad. Instalar primero los esquemas de Archivo y Logistica
   y, si se usan avisos, su esquema. No volver a ejecutar despues scripts antiguos que
   habiliten acceso anonimo o hagan publico el bucket.
2. Ejecutar `supabase-enable-accesos.sql` en SQL Editor. Este paso prepara las tablas y
   la funcion de activacion, sin cerrar aun el acceso existente a los datos de la app.
3. Desactivar el registro publico de usuarios. Desplegar la funcion `app-access-login`
   usando `supabase/config.toml`. Configurar su secreto `APP_ALLOWED_ORIGINS` con el
   origen HTTPS real de la app (sin ruta; varios origenes separados por coma).
   La funcion usa las variables privadas de Supabase del servidor. No envia correos.
4. En una terminal privada del administrador, configurar `SUPABASE_SERVICE_ROLE_KEY`
   y `APP_ORIGIN` para el mismo sitio HTTPS y ejecutar `node tools/instalar-accesos.mjs`.
   Ingresar las dos claves elegidas cuando las solicite. No compartir la clave de servicio
   por chat ni guardarla en archivos publicos. El instalador prueba ambos ingresos antes
   de restringir permisos y activar el acceso en el archivo de configuracion.
5. Publicar los archivos actualizados de la app, incluido `supabase-config.js`, y verificar
   en ventanas privadas: administrador completo, consulta sin edicion, PDF autorizado y
   rechazo de lecturas anonimas y escrituras del perfil consulta desde la API.
   Estas ultimas pruebas requieren el servidor instalado; las pruebas locales son simuladas.
6. Quitar la clave de servicio del entorno al terminar. No publicar `tools`, `tests`,
   archivos SQL, `.env`, `.verification` ni el codigo de servidor en el alojamiento estatico.

La activacion cambia las politicas de los datos a autenticacion obligatoria, hace privado
el bucket `planillas` y habilita enlaces de PDF de cinco minutos. Los enlaces antiguos
de deposito tambien requieren administrador. Las copias de PDF ya descargadas no se revocan.
Cada sesion dura como maximo ocho horas en esta app. Al salir se eliminan las copias
locales de la app previa confirmacion si hay borradores.

La funcion aplica limites de intentos por IP y por perfil en ventanas de quince minutos.
No sustituye una contraseña larga ni MFA. Las claves se guardan con PBKDF2 y sal aleatoria
en una tabla privada; las cuentas internas tienen contraseñas aleatorias largas.

Si falla la instalacion antes de activar, no cambiar manualmente el indicador a `true`.
Si la activacion del servidor termino pero fallo la escritura/publicacion de configuracion,
publicar `APP_ACCESS_ENABLED: true` tras verificar ambos accesos. Ponerlo en `false` no
restaura los permisos anonimos del servidor. Conservar acceso administrativo a Supabase.

Documentacion: [Supabase Auth](https://supabase.com/docs/guides/auth),
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) y
[buckets privados](https://supabase.com/docs/guides/storage/buckets/fundamentals).
