// Todas las rutas /api/* las atiende el mismo manejador (ver server/api.js)
import { handle } from '../../server/api.js';

export const onRequest = (context) => handle(context.request, context.env);
