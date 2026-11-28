# Engram local de Pulso Web

Engram oficial 3.5.1 Linux amd64, descarga de Gentleman-Programming/engram, archivo verificado con checksums.txt. Procedencia y hash del binario: `.tools/engram/3.5.1/provenance.json`.

La instalacion y la memoria son propias del proyecto. No se han copiado bases, sesiones ni identificadores de otros proyectos. El almacenamiento esta dentro del volumen persistente `/data`. No usa cuentas, API keys, modelos, embeddings de pago ni Cloud.

Uso del agente: leer AGENTS.md y ejecutar el helper de sincronizacion ODD. `--read-only` arranca un proceso independiente con solo la herramienta `mem_get_observation`, reconstruye los archivos y comprueba identidad, alcance, orden, bytes y SHA-256. La escritura solo publica el manifiesto despues de verificar las partes y vuelve a comprobar que la fuente no cambio. No sincroniza automaticamente cambios mientras el agente no invoque el helper.

Comandos desde la raiz:

```sh
python3 scripts/sync_odd_memory.py --read-only
# despues de actualizar una tarea ODD:
python3 scripts/sync_odd_memory.py
python3 scripts/sync_odd_memory.py --read-only
```

La configuracion MCP nativa del proyecto se comprobara con Codex; una sesion ya abierta puede necesitar recarga para mostrar herramientas nuevas. El helper funciona de inmediato sin reiniciar T3. Para habilitar el MCP nativo se agrego unicamente la confianza de `/data/home/Proyectos/Pulso-Web` a la configuracion de Codex, conservando sus bytes anteriores; no se registro ningun MCP global.

Verificacion de integracion: `codex mcp list --json` desde la raiz incluye `engram_pulso_web`. Prueba aislada: `python3 tests/test_engram_sync.py`; verifica documentos multipartes con Unicode/CRLF, rechazo de fuente modificada, rechazo de bytes corruptos y recuperacion tras resincronizar. La base de prueba se elimina y no modifica memoria de produccion.
