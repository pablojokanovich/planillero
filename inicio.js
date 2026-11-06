'use strict';
window.AppAccess.ready.then(() => {
// Preserve old archive and remito links after moving the planner to its own page.
const homeParams = new URLSearchParams(window.location.search);
if (homeParams.get('remitoArchivo') === '1' || homeParams.get('remito') === 'manual' || window.location.hash === '#remito-manual') {
  window.location.replace(`planillero.html${window.location.search}${window.location.hash}`);
}
}).catch(() => {});
