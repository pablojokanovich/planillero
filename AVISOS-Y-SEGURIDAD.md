# Avisos de salida de camiones

## Estado

La app incorpora avisos en pantalla y de escritorio, deteccion de nuevas salidas cada
cinco minutos y configuracion de destinatarios. El envio real de correos necesita
instalacion en Supabase, un remitente verificado y las claves del proveedor.
No se enviaron correos durante las pruebas.

El remitente de prueba elegido es `pjokanovich@congressrental.com`, usando Microsoft 365
(Outlook) mediante Microsoft Graph. `logistica@congressrental.com` aun no existe y no debe
usarse como remitente hasta que la empresa cree y habilite esa casilla.

## Computadoras

En Salida de camiones > Configuracion activar Notificar en esta computadora y aceptar
el permiso del navegador. Usar HTTPS. Los avisos detectan nuevas filas, no ediciones,
y no notifican todas las filas antiguas al abrir por primera vez. La pagina debe seguir
abierta; las pestanas en segundo plano pueden ser ralentizadas por el navegador.

## Instalacion de correo

1. Ejecutar `supabase-enable-avisos-salidas.sql`, despues de instalar Logistica.
2. Instalar los accesos siguiendo `ACCESOS.md`. El instalador incorpora la cuenta de
   administrador a `departure_notification_admins`. Nadie puede agregarse desde el navegador.
3. Un administrador de Microsoft 365 debe registrar una aplicacion de servidor en
   Microsoft Entra y autorizar el envio por Microsoft Graph. Limitar el permiso
   `Application Mail.Send` al buzon de prueba mediante Exchange Online Application RBAC.
   No combinarlo con un permiso global equivalente en Entra: los permisos se suman
   y ese permiso global anularia la restriccion por buzon. No se necesita permiso
   para leer el correo ni la contrasena personal de Outlook.
   Configurar en los secretos de la Edge Function `NOTIFICATION_PROVIDER=microsoft365`,
   `NOTIFICATION_FROM=pjokanovich@congressrental.com`, `M365_TENANT_ID`, `M365_CLIENT_ID`,
   `M365_CLIENT_SECRET` y `DEPARTURE_WEBHOOK_SECRET` (aleatorio, al menos 32 bytes).
   La plantilla `.env.example` es solo una referencia con valores vacios; no configura
   el servidor ni habilita el envio. No colocar secretos en HTML, JS publico ni chat.
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son propios del entorno Supabase.
4. Desplegar `supabase/functions/notify-departure` con la configuracion de `supabase/config.toml`.
   La funcion verifica `x-webhook-secret`, en lugar del JWT de un usuario.
5. Crear un Database Webhook para INSERT en `public.logistics_departures`, apuntando a
   `notify-departure`, con el encabezado `x-webhook-secret` y el mismo valor secreto.
6. Entrar a la app como administrador y abrir Configuracion > Avisos por correo.
   Agregar los destinatarios y activar/desactivar cada uno con su casillero.
7. Crear una salida desde la sesion habilitada y verificar la recepcion y el registro
   de Enviados de Outlook. Las pruebas locales usan simulaciones, nunca el buzon real.

Para cambiar al futuro buzon de logistica: primero crearlo, autorizarlo en el alcance
de la aplicacion de Microsoft, cambiar `NOTIFICATION_FROM` y actualizar el remitente
mostrado en la interfaz. La lista de destinatarios se mantiene.

Referencias oficiales:
- https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0
- https://learn.microsoft.com/en-us/graph/auth-v2-service
- https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac

Solo envian correo las salidas creadas por cuentas habilitadas. Las inserciones anonimas
no disparan correo: el servidor estampa el creador real y la funcion lo verifica, para
que el endpoint publico de la app anterior no pueda usarse para generar mails arbitrarios.
Las sesiones de administracion se guardan solo en sessionStorage y vencen; no se guardan
contrasenas. El listado de destinatarios no es legible ni modificable por anonimos.

Cada destinatario recibe un mensaje separado. Las aceptaciones quedan registradas para
evitar repetir envios que ya fueron registrados. Graph devuelve 202 Accepted, sin un ID
de mensaje ni confirmacion de entrega final; ese estado no garantiza la recepcion.
Graph no aplica las claves de idempotencia de Resend. Si Microsoft acepta un mail pero
falla el registro posterior, hay que revisar Enviados antes de reintentar para no duplicarlo.
El adaptador alternativo de Resend se conserva para instalaciones anteriores, con sus
claves de idempotencia de 24 horas. Revisar los errores de webhooks/funciones; este cambio
no instala una cola con reintentos automaticos ni garantiza entrega.

# Revision de seguridad del resto de la app

Esta revision es del codigo local, no una auditoria del Supabase desplegado.

- `supabase-setup.sql` configura el bucket planillas como PUBLICO y habilita consultas,
  inserciones y eliminaciones anonimas. Otros scripts permiten modificar inventario,
  freelancers, checklists y salidas sin iniciar sesion.
- Los antiguos pedidos de claves dentro de cada pagina se reemplazaron por el acceso
  unificado preparado en `ACCESOS.md`. Solo protege cuando se instala y activa en servidor.
- Los links de deposito incluyen tokens, pero las politicas actuales permiten leer las
  tablas de checklists como anonimo. El filtro del frontend no es un control de acceso.
- La clave publishable del proyecto no es un secreto. La proteccion debe estar en las
  politicas de la base de datos; reemplazar esa clave no corrige politicas permisivas.

## Recomendacion para informacion privada

1. Incorporar Supabase Auth en TODAS las paginas y peticiones, solo por invitacion,
   con roles de administrador, oficina y deposito; MFA para administradores.
2. Sustituir las politicas anonimas por RLS restringida a miembros autorizados y a
   las acciones permitidas para cada rol. Verificar con pruebas que un anonimo no
   pueda leer, insertar, editar ni borrar datos mediante llamadas directas a la API.
3. Convertir Storage a privado y reemplazar URLs publicas por descargas autenticadas
   o enlaces firmados de corta duracion. Dejar de usar `public_url` como acceso permanente.
4. Atender links de deposito con una funcion que valide token, vencimiento y checklist
   concreta, sin exponer lectura general de las tablas.
5. Usar HTTPS, copias de seguridad, registros de cambios y revocacion de usuarios.
   En equipos compartidos, borrar las copias locales al cerrar sesion y limitar sesiones.
   Un acceso por VPN o intranet puede ser una capa adicional, no reemplaza RLS.

Las politicas antiguas y el bucket publico solo se restringen al ejecutar la activacion
verificada de `ACCESOS.md`. Preparar archivos locales no modifica el servidor desplegado.
