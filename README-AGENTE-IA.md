# Agente IA para planillas CCTV

## Qué incorpora

- Carga de una orden de servicio en PDF.
- Análisis visual y textual mediante OpenAI Responses API.
- Preguntas obligatorias antes de generar.
- Borrador editable separado por salas.
- Aplicación automática sobre el inventario CCTV existente.
- Estados `BORRADOR IA` y `APROBADA`.
- Una edición posterior a la aprobación devuelve la planilla a borrador.
- Historial técnico en Supabase.
- Botón para convertir una corrección confirmada en regla futura.

## Configuración inicial

1. Abrir Supabase > SQL Editor.
2. Ejecutar completo `supabase-enable-ai-planner.sql` una sola vez.
3. En Vercel > Project > Settings > Environment Variables crear:
   - `OPENAI_API_KEY`: clave secreta del proyecto de OpenAI.
   - `OPENAI_MODEL`: opcional. El valor predeterminado es `gpt-5.4-mini`.
4. Volver a desplegar el proyecto en Vercel para que tome la variable.

No colocar `OPENAI_API_KEY` en `supabase-config.js`, en el HTML ni en GitHub.

## Flujo de uso

1. Abrir el planillero y pulsar **GENERAR PLANILLA CON IA**.
2. Elegir una orden PDF de hasta 50 MB.
3. Responder todas las preguntas obligatorias.
4. Revisar el borrador previo y pulsar **APLICAR BORRADOR**.
5. Modificar cantidades u observaciones en el planillero normal.
6. Pulsar **APROBAR** cuando la planilla esté lista.
7. Para enseñar una corrección futura, pulsar **+ REGLA** y escribirla de manera concreta.

## Archivos principales

- `api/ai-plan.js`: función segura de Vercel que llama a OpenAI.
- `api/_cctv-rules.js`: reglas técnicas base de CCTV.
- `ai-planner.js`: flujo del navegador e integración con la planilla.
- `ai-planner.css`: interfaz del asistente.
- `supabase-enable-ai-planner.sql`: almacenamiento de órdenes, borradores, auditoría y reglas.

## Seguridad actual

La aplicación mantiene el mismo modelo de acceso público que el planillero existente. Cualquier persona con la URL puede generar y aprobar borradores. La clave de OpenAI permanece únicamente en Vercel. Si más adelante se incorporan usuarios, habrá que reemplazar las políticas `anon` por políticas `authenticated`.
