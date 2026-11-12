# Urdaibai E.T. · Estadísticas de balonmano

Web privada (solo con usuario y contraseña) para anotar y consultar estadísticas de los equipos del club.
Funciona en el móvil como una app (PWA), también **sin conexión** (se sincroniza al volver la cobertura),
en **euskera** (por defecto) y **castellano**.

- **Alojamiento gratuito en Cloudflare**: Pages (la web) + Functions (la API) + D1 (la base de datos). No hay servidor que mantener.
- Sin proceso de compilación: lo que hay en `public/` se publica tal cual.

## Qué hace

- **Vista sencilla** (pensada para delegados): 7 botones de equipo (Posesión, Gol, Lanzamiento fallado, Pérdida, Gol en contra, Parada, Lanzamiento contrario fallado), contadores siempre visibles, botón *Deshacer* y parte (1ª/2ª). Tocando un contador se corrige el total a mano.
- **Vista "Más detalle"** (igual que el Excel del club): eliges jugador/a y tocas **Gol, Contragol, Fuera/poste, Parada (del portero rival), Contrafallo**, **pérdidas** (Pase, Pisando, F. ataque, Pasos), **recuperaciones** (Robo, Chapa) y **2´**. Eliges portero/a y tocas **Parada, Gol, Fuera/poste, Contrapase OK/fallo** y, aparte, **Penaltis** (parada/gol/fuera). Al lado de cada botón sale cuántas lleva ese jugador. La **portería 3×3** se sigue pidiendo (opcional, se puede desactivar) y la zona del campo es opcional.
- **Se pueden mezclar** las dos vistas en el mismo partido **sin duplicar**: cada hecho es un único evento; los contadores se calculan siempre desde los eventos. Los lanzamientos anotados en sencillo quedan "pendientes de completar" y al detallarlos se completa **el mismo** evento.
- Relaciones automáticas (solo estas): Gol → +lanzamiento · Gol en contra → +lanzamiento contrario · Parada → +lanzamiento contrario. Las posesiones **solo** se anotan con su botón.
- Porcentajes con los colores del Excel del club (editables por el administrador): efectividad ofensiva (goles ÷ posesiones), % pérdidas, % efectividad de lanzamiento, % paradas (paradas ÷ (goles en contra + paradas), también por portero).
- **Permisos por equipo**: cada usuario solo ve y anota los equipos que le asigna el administrador (uno, varios o todos). Se comprueba siempre en el servidor.
- **Importar** jugadores y estadísticas (simples o avanzadas) desde CSV o Excel con vista previa, lista de errores y decisión sobre duplicados; plantillas descargables. **Exportar** a Excel y CSV.
- **Informes** por partido, por partidos (tabla + gráfico de evolución) y por temporada (totales, mejores/peores, jugadores, porteros, mapas de zonas y portería); PDF con *Imprimir → Guardar como PDF*.
- **Uso del plan gratuito** (*Más → Uso del plan gratuito*): solo lo ve el **propietario** (el primer administrador creado), aunque haya más administradores. Muestra el porcentaje que queda de peticiones diarias, filas leídas/escritas y tamaño de la base de datos de Cloudflare, y el tamaño del repositorio de GitHub.
- Correcciones fáciles: deshacer, lista de eventos editable, reabrir/editar partidos, papelera recuperable, registro de cambios, temporadas cerrables, partidos de prueba (no cuentan en informes).

## Estructura

```
public/        Web (HTML, CSS, JS, PWA, iconos)  → Cloudflare Pages
functions/     Punto de entrada de la API        → Pages Functions (/api/*)
server/        Lógica de la API (sin dependencias)
migrations/    SQL de la base de datos D1
scripts/       Servidor local, creación del primer administrador
test/          Pruebas automáticas
wrangler.toml  Configuración de Cloudflare (D1)
```

## Probarlo en tu ordenador

Necesitas [Node.js](https://nodejs.org) 22 o superior.

```bash
npm install
npm run dev
```

Abre <http://localhost:8788> y entra con `admin` / `admin123` (solo para pruebas locales; usa una base SQLite en `.dev/`).
Pruebas automáticas: `npm test`.

## Publicarlo en Cloudflare (paso a paso)

Todo cabe en el plan gratuito. Necesitas una cuenta de Cloudflare y el repositorio en GitHub.

### 1. Subir el proyecto a GitHub
Crea un repositorio y sube todo el contenido de esta carpeta (el `.gitignore` ya excluye `node_modules`).

### 2. Crear la base de datos D1
En tu ordenador, dentro de la carpeta del proyecto (la primera vez te pedirá iniciar sesión en Cloudflare):

```bash
npm install
npx wrangler login
npx wrangler d1 create urdaibai-stats
```

El comando muestra un `database_id`. **Cópialo en `wrangler.toml`**, en la línea `database_id = "..."`, y sube ese cambio a GitHub.

### 3. Crear las tablas
```bash
npx wrangler d1 migrations apply urdaibai-stats --remote
```

### 4. Crear el primer administrador
Elige tu usuario y una contraseña de al menos 6 caracteres (mejor larga):

```bash
node scripts/create-admin.mjs mi_usuario mi_contraseña_larga
```

Imprime una sentencia `INSERT ...`. Ejecútala en la base de datos (cópiala entera entre comillas):

```bash
npx wrangler d1 execute urdaibai-stats --remote --command "PEGA_AQUI_LA_SENTENCIA"
```

(Alternativa: en el panel de Cloudflare → *Storage & Databases → D1 → urdaibai-stats → Console*, pega la sentencia y ejecútala.)
Después ya puedes crear el resto de usuarios desde la propia web (*Más → Administración → Usuarios*).

### 5. Conectar Cloudflare Pages con GitHub
1. Panel de Cloudflare → *Workers & Pages* → *Create* → pestaña *Pages* → *Connect to Git* y elige el repositorio.
2. Configuración de compilación: **Framework preset: None**, **Build command**: *(vacío)*, **Build output directory**: `public`.
3. *Save and Deploy*.

### 6. Enlazar la base de datos con Pages
Si el despliegue no ha cogido el enlace desde `wrangler.toml`: proyecto de Pages → *Settings → Bindings → Add → D1 database*,
nombre de variable **`DB`** y selecciona `urdaibai-stats` (hazlo en *Production* y, si quieres, en *Preview*). Vuelve a desplegar (*Deployments → Retry deployment*).

### 7. Usarla
Abre la dirección `https://<tu-proyecto>.pages.dev`, entra con el administrador y:
1. **Más → Administración → Equipos**: crea los equipos del club.
2. **Usuarios**: crea los delegados y marca qué equipos puede ver cada uno.
3. **Jugadores**: añádelos a mano o impórtalos (*Más → Importar*).
4. En el móvil: *Añadir a pantalla de inicio* para instalarla como app.

Cada vez que hagas *push* a GitHub, Cloudflare vuelve a publicar la web automáticamente. Las migraciones nuevas de `migrations/` se aplican con el comando del paso 3.

## Actualizar una instalación que ya está publicada

Cuando recibas una versión nueva con archivos nuevos en `migrations/`, el orden importa:

1. **Primero** aplica las migraciones a la base de datos: `npx wrangler d1 migrations apply urdaibai-stats --remote` (la 0003 reconstruye la tabla de eventos conservando todo lo anotado; haz antes una copia con el comando de «Copia de seguridad»)
2. **Después** sube los archivos a GitHub (Cloudflare republica solo).

Si lo haces al revés, la web puede dar error hasta que se aplique la migración.

## Notas importantes

- **Euskera**: los textos en euskera (`public/js/strings.js`, segunda columna de cada entrada) deben ser **revisados por una persona euskaldun** del club antes de usarlos en serio.
- **PDF**: se genera con la función del navegador (*PDF / imprimir → Guardar como PDF*); no hay servidor que lo cree.
- **Límites gratuitos de Cloudflare** (orientativos, comprueba los vigentes; la pantalla de uso los lee de `FREE_LIMITS` en `server/api.js`): 100.000 peticiones/día de Functions, 5 millones de filas leídas y 100.000 escritas al día en D1, y 5 GB de base de datos. Un club con varios equipos queda muy lejos de esos límites.
- **Seguridad**: contraseñas con PBKDF2-SHA256, sesiones en base de datos con cookie `HttpOnly`, bloqueo tras 5 intentos fallidos en 10 minutos, comprobación de origen contra CSRF y cabeceras de seguridad (`public/_headers`). Todo el contenido requiere iniciar sesión.
- **Copia de seguridad**: `npx wrangler d1 export urdaibai-stats --remote --output copia.sql`. Los informes también se pueden exportar a Excel.
- **Si cambias archivos de `public/`** y la app instalada no muestra los cambios, sube el número de `VERSION` en `public/sw.js`.
- Cambiar la contraseña de un usuario: *Administración → Usuarios → (usuario) → Nueva contraseña*.
