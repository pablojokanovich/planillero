# Precarga desde la agenda CCTV

El calendario abre este generador en otra pestana con un fragmento
`#agenda=...`. No cambia el diseno ni importa equipos o bultos desde la agenda.
La precarga incluye orden, nombre, lugar, armado, fin, salas y operadores en
las notas. Las fechas ISO se convierten al formato DD-MM-AAAA del generador.

`agenda-import.js` valida la version y los campos antes de crear un borrador.
El fragmento se quita de la direccion una vez leido. Si el borrador actual es
del mismo evento se recupera sin reemplazar equipos ni cambios locales. Si es
de otro evento, se pide confirmacion y se guarda una copia en el mismo
almacenamiento bajo `cr_agenda_backup:<identificador>` antes de reemplazarlo.
Cancelar la confirmacion no modifica el borrador. Un fallo al guardar la copia
impide reemplazar el borrador anterior. No se escribe en Supabase al importar.

Pruebas del formato de importacion:

```sh
node --test tests/agenda-import.test.cjs
```
