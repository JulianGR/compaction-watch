# compaction-watch

Plugin de hooks para Claude Code que **cuenta las compactaciones de la sesion
actual** y, al superar un umbral, muestra un aviso en el **statusline** para
recordarte abrir una sesion nueva antes de que la perdida acumulada por
compactaciones degrade la calidad.

Cada compactacion resume y descarta parte del historial: es una operacion con
perdida (lossy) y se encadena. Varias compactaciones equivalen a "resumen de un
resumen". `compaction-watch` no intenta medir calidad ni recuperar lo perdido;
usa un proxy honesto y determinista: **el numero de compactaciones acumuladas**.

Sin red, sin telemetria, sin daemon. Todo el estado son ficheros pequenos bajo
`~/.claude/state/compaction-watch/`.

## Como se ve

El statusline base (el tuyo, o uno minimo de modelo + carpeta) con un sufijo:

```
Opus  mi-proyecto                                         (0 compactaciones)
Opus  mi-proyecto  ⟳3                                     (por debajo del umbral)
Opus  mi-proyecto  ⚠️ 10 compactaciones · nueva sesión recomendada
```

- `⟳N` aparece desde la primera compactacion (recordatorio ambiental).
- `⚠️ ...` es el aviso fuerte al alcanzar el umbral (por defecto 10).

## Instalacion

Hay dos metodos. El statusline **siempre** requiere una entrada `statusLine` en
`~/.claude/settings.json` (un plugin de Claude Code no puede declararla por si
mismo). Por eso `statusline.sh` se copia a una ruta estable
(`~/.claude/scripts/compaction-watch/`) y `settings.json` la referencia con ruta
absoluta. La copia la rehace el hook `SessionStart` en cada arranque, asi que la
ruta estable siempre tiene la version vigente aunque actualices el plugin.

### Metodo A — `install.sh` (recomendado, todo en uno)

```bash
./install.sh
```

Es **aditivo e idempotente**: copia los scripts a la ruta estable y fusiona en
`~/.claude/settings.json` los hooks `PreCompact` y `SessionStart` y el
`statusLine`. No reemplaza el fichero y no duplica hooks si lo ejecutas varias
veces. Si ya tenias un `statusLine`, **lo conserva** e imprime como encadenarlo
con `COMPACTION_WATCH_BASE_STATUSLINE`. Si no hay `jq`, imprime el bloque exacto
para pegar a mano.

### Metodo B — plugin via marketplace

Anade el marketplace y activa el plugin (registra los hooks `PreCompact` y
`SessionStart`):

```
/plugin marketplace add JulianGR/compaction-watch
/plugin install compaction-watch@compaction-watch
```

Luego, **una sola vez**, anade el statusLine a `~/.claude/settings.json`
(usa tu ruta real de HOME ya expandida):

```json
{
  "statusLine": {
    "type": "command",
    "command": "/Users/tu-usuario/.claude/scripts/compaction-watch/statusline.sh"
  }
}
```

El script ya estara en esa ruta porque `prune.sh` (hook `SessionStart`) lo copia
en cada arranque.

## Configuracion

Variables de entorno (se ponen en el bloque `env` de `~/.claude/settings.json`):

| Variable | Default | Efecto |
| --- | --- | --- |
| `COMPACTION_WATCH_THRESHOLD` | `10` | Compactaciones a partir de las cuales se muestra el aviso ⚠️. Rango sensato 8-15; no pasar de 20. |
| `COMPACTION_WATCH_AUTO_ONLY` | `0` | Si `1`, ignora los `/compact` manuales y solo cuenta los automaticos. |
| `COMPACTION_WATCH_BASE_STATUSLINE` | (vacio) | Ruta a un statusline previo a encadenar. Si vacio, se usa uno minimo (modelo + carpeta). |
| `COMPACTION_WATCH_RETENTION_DAYS` | `7` | Dias que se conservan los contadores de sesiones viejas antes de purgarlos. |
| `COMPACTION_WATCH_DEBUG` | `0` | Si `1`, vuelca el stdin crudo de cada hook a `~/.claude/state/compaction-watch/raw.log` para verificar los nombres de campo del JSON. |

Ejemplo:

```json
{ "env": { "COMPACTION_WATCH_THRESHOLD": "10" } }
```

### Por que 10 por defecto

La compactacion es lossy y encadenada: el contenido antiguo sobrevive a tantas
rondas de resumen como compactaciones haya. A las ~10 compactaciones el contexto
temprano es practicamente inexistente, asi que 10 funciona como "stop de
emergencia". En frecuencia, ~10 compactaciones equivalen a varias horas de sesion
intensa continua, un punto razonable para sugerir refresco. Como tu estado
durable ya se externaliza a `CLAUDE.md`/`memory/`, puedes tolerar un umbral algo
mas alto (sube a 15 si el aviso molesta por aparecer pronto).

**Limite de la heuristica:** contar compactaciones no es medir calidad real. Una
sesion puede compactar poco y estar danada, o compactar mucho en trabajo lineal y
estar bien. Se acepta ese error a cambio de simplicidad y determinismo.

## Como funciona

```
PreCompact (cada compactacion)  -> bin/count.sh
    incrementa ~/.claude/state/compaction-watch/<session_id>.count

Statusline (cada render)        -> ~/.claude/scripts/compaction-watch/statusline.sh
    lee el contador del session_id y compone base + sufijo

SessionStart (cada arranque)    -> bin/prune.sh
    copia statusline.sh a la ruta estable y purga contadores viejos
```

- **Reset gratis por sesion nueva.** El `session_id` es estable dentro de una
  sesion (incluida la compactacion) y cambia al abrir una nueva: sesion nueva =
  contador a 0, sin intervencion.
- **`--resume` / `--continue`** reutilizan el `session_id`, asi que el contador
  persiste (sigues en la sesion degradada, que es lo correcto).
- **Multiproyecto / sesiones en paralelo:** cada `session_id` tiene su contador;
  no se mezclan.

## Verificar los nombres de campo del JSON

Los esquemas de los JSON de hooks/statusline pueden variar por version de Claude
Code. Antes de confiar ciegamente en el parseo, pon `COMPACTION_WATCH_DEBUG=1`,
provoca una compactacion y un render, y revisa
`~/.claude/state/compaction-watch/raw.log` para confirmar `session_id`, `trigger`,
`model.display_name` y `workspace.current_dir`. Quita la variable cuando termines.

## Gestion (skill)

El plugin incluye un skill `compaction-watch` para peticiones como "cuantas
compactaciones llevo", "cambia el umbral a 15" o "resetea el contador". Solo
lee/escribe el estado bajo `~/.claude/state/compaction-watch/` y el bloque `env`
de tu `settings.json`.

## Pruebas

```bash
bash tests/run.sh
bash tests/install_test.sh
```

Cubren el incremento del contador, `AUTO_ONLY`, contadores corruptos, los tres
estados del statusline, umbral configurable, encadenado de statusline, la copia a
la ruta estable, la purga por antiguedad y la idempotencia / preservacion del
`statusLine` previo en `install.sh`.

## Seguridad / privacidad

- Todo el estado es local. Ningun dato sale de la maquina. Cero red, cero
  telemetria.
- `COMPACTION_WATCH_BASE_STATUSLINE` ejecuta un comando definido por ti:
  tratalo como confianza del usuario.
- Todos los scripts salen con codigo 0 siempre: un hook que falle nunca bloquea
  ni la compactacion ni el render del statusline.

## No-goals

No mide calidad real, no escribe `CLAUDE.md` ni `memory/`, no inyecta mensajes al
LLM, no detecta el % de contexto en vivo (hoy imposible con hooks), no levanta
servidores y no intenta recuperar lo perdido en una compactacion.

## Licencia

MIT. Ver [LICENSE](LICENSE).
