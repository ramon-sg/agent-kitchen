# Diseño: decisiones por pieza guardadas en el repo

## En simple

Hoy, cada `agent-kitchen apply` vuelve a sugerir, ya marcada, cada pieza que el repo no tiene. Con `--yes` la instala sin preguntar. Un repo que no quiere `claude-repo-guard` tiene que acordarse de `--skip claude-repo-guard` cada vez.

Con este cambio, la primera vez que una persona elige piezas en `apply`, esas decisiones quedan en `.agents/kitchen.json`. Desde ahí, `apply` las respeta sin volver a preguntar. Una pieza en "no" no aparece en el menú y `--yes` no la toca. La tabla la muestra en una línea, y otra línea dice cómo cambiar la decisión.

## Por qué

- Hay repos que quieren casi todo de agent-kitchen menos una pieza, típicamente `claude-repo-guard`. Esa decisión es del repo y tiene que durar entre corridas y entre personas, por eso va en un archivo commiteado.
- El recordatorio de lo que falta no debe molestar: una línea, sin preguntas repetidas.
- El patrón ya existe en el ecosistema: `skills-manager` hace lo mismo con `.agents/skills.json` para las skills, y Copier (`.copier-answers.yml`) guarda respuestas y solo pregunta lo nuevo.

## Objetivos

1. Guardar, por pieza, si el repo la quiere (`true`) o no (`false`).
2. Las siguientes corridas de `apply` respetan esas decisiones sin preguntar.
3. Una pieza que el archivo no menciona (por ejemplo, una que agrega una versión futura de agent-kitchen) se ofrece una vez, en una corrida con terminal; la respuesta se guarda.
4. Cambiar una decisión es fácil y explícito: `agent-kitchen apply --pieces`, o editar el archivo.

## Fuera de alcance

- **Desinstalar.** Poner una pieza instalada en `false` solo hace que agent-kitchen deje de ofrecer instalarla o actualizarla. No borra nada.
- **Elegir skills una por una.** Eso ya lo guarda `.agents/skills.json`; este archivo decide solo si la pieza `skills` está.
- **Cambiar `--skip`.** Sigue igual: deja fuera piezas en esa corrida y no escribe el archivo.

## Lo que no debe pasar (anti-objetivos)

- Que `--yes` o una corrida sin terminal instale una pieza que el repo puso en `false`.
- Que una pieza nueva quede oculta para siempre solo porque el archivo se creó antes de que existiera.
- Que `apply` vuelva a preguntar por piezas ya decididas.
- Que el archivo se escriba sin que una persona haya elegido (`--yes`, `--dry-run` o sin terminal).

## El archivo

`.agents/kitchen.json`, junto a `.agents/skills.json` y `.agents/flow.json`. Se commitea. Se puede editar a mano.

```json
{
  "pieces": {
    "issue-flow": true,
    "claude-cloud": true,
    "claude-repo-guard": false,
    "skills": true,
    "agents-md": true
  }
}
```

- Las claves son los nombres que ya usa `--skip` (`pieceNames()` en `src/commands/sync.ts`).
- **`skills-manager` no lleva decisión.** No es una elección de la persona: sigue a las piezas `skills` e `issue-flow` (ya lo hace `skillsManagerStatus`). Si aparece en el archivo, se ignora.
- **Nombre desconocido:** se ignora sin advertencia (puede venir de una versión más nueva de agent-kitchen) y **se conserva tal cual** al reescribir el archivo. Así, alguien con una versión vieja no borra la decisión que tomó otra persona con una nueva.
- **Valor que no es booleano:** se trata como sin decisión, con una advertencia de una línea. No falla.
- **JSON roto:** error como con los otros archivos que lee `readJson` (`KitError` con el archivo y qué arreglar).

## Comportamiento

Cada pieza decidible está en uno de tres estados: `true`, `false` o sin decisión (el archivo no la menciona o no existe).

### Antes del menú

- Las piezas en `false` se tratan como si vinieran en `--skip`: no se mira su estado ni se ofrecen pasos. Esto ya resuelve las dependencias que hoy cuelgan de `skip`: por ejemplo, `issue-flow` en `false` deja las skills del flujo fuera, igual que `--skip issue-flow`.
- La tabla "Este repo tiene:" muestra una línea por cada pieza en `false`: `claude-repo-guard  fuera por decisión del repo`.
- Si hay alguna pieza en `false`, debajo de la tabla va una línea: `Para cambiar qué piezas usa el repo: agent-kitchen apply --pieces (o edita .agents/kitchen.json).`
- Las piezas en `true` se comportan como hoy.

### Primera vez: sin archivo, con terminal

1. **Lo instalado cuenta como `true`.** Toda pieza con `installed: true` en su `PieceStatus` queda así, sin preguntar.
2. Las piezas no instaladas se ofrecen como hoy, en el mismo menú (todo lo sugerido, o elegir).
3. Al terminar las preguntas y antes de correr los pasos, se escribe el archivo:
   - pieza no instalada con algún paso elegido → `true`;
   - pieza no instalada cuyos pasos se ofrecieron y no se eligieron → `false`;
   - pieza instalada → `true`, aunque esta vez no se eligiera su actualización (no actualizar hoy no es rechazarla).
4. Se dice en una línea: `Guardé qué piezas usa el repo en .agents/kitchen.json; commitéalo.`
5. Con "Salir sin cambiar nada" o al cancelar, no se escribe nada.
6. Si todas las piezas ya están instaladas y no hay nada que elegir, el archivo se escribe igual, todo en `true`, sin preguntar.

### Siguientes corridas: con archivo, con terminal

- No se pregunta por piezas decididas.
- **Pieza sin decisión:** se ofrece una vez, marcada como nueva en la tabla y en su paso (por ejemplo, `(nueva)`). Lo que pase en esa corrida se guarda con la misma regla del punto 3.
- Si no hay piezas sin decisión, el archivo no se toca.

### `--yes` y sin terminal

- **Sin archivo:** como hoy. `--yes` hace lo sugerido y sin terminal solo se muestra. No se escribe el archivo: una decisión del repo la toma una persona.
- **Con archivo:** las piezas en `false` no se tocan.
- **Pieza sin decisión y no instalada:** se trata como `--skip` en esa corrida, con todo lo que eso arrastra. Por ejemplo, un `issue-flow` sin decisión deja fuera las skills del flujo y sus ajustes al guard y a `AGENTS.md`. Una línea lo dice: `Pieza nueva sin decisión: claude-x. Corre agent-kitchen apply en una terminal para elegir.`
- **Pieza sin decisión pero instalada:** por ejemplo, alguien borró su clave. Cuenta como `true` en esa corrida, igual que al crear el archivo. Se guarda en la siguiente corrida con terminal.

### `--dry-run`

Muestra lo mismo, con las decisiones aplicadas. Nunca escribe el archivo.

### `--skip`

Se suma a las piezas en `false` para esa corrida. No escribe el archivo. Una pieza sin decisión que viene en `--skip` sigue sin decisión.

### Cambiar decisiones

- **`agent-kitchen apply --pieces`** abre directo un multiselect con todas las piezas decidibles, marcadas según su decisión actual. Las que no tienen decisión aparecen marcadas si están instaladas y sin marcar si no lo están. Al confirmar se reescribe el archivo y `apply` sigue como siempre, ya con las decisiones nuevas: muestra la tabla y pregunta qué hacer. Si se cancela, no se escribe nada.
- `--pieces` necesita terminal. No se combina con `--yes` ni con `--dry-run`: en ambos casos es un `UsageError`. Sin terminal también es un error de uso, con un mensaje que lo dice.
- El menú normal de `apply` no cambia: no se le agrega ninguna opción. Así, una corrida sin `--pieces` nunca suma preguntas.
- Editar `.agents/kitchen.json` a mano tiene el mismo efecto en la siguiente corrida.
- `--pieces` se agrega al texto de uso (`USAGE` en `src/cli.ts`) y a la sección "Uso" del README.

### `doctor`

Una pieza en `false` se informa como `· claude-repo-guard: fuera por decisión del repo` en vez de "no instalado". No corre su doctor y nunca cuenta como fallo.

## Restricciones

- **Mismo estilo que el resto:** textos en español, comentarios y JSDoc en inglés con `@example`, sin dependencias nuevas (`@clack/prompts` 1.8.1 ya tiene `multiselect`).
- **Todas las preguntas antes de cualquier paso**, como hoy (ver `progressFor` en `src/commands/sync.ts`: un spinner antes de una pregunta deja la siguiente sin teclado).
- **El sandbox de `claude-repo-guard` no bloquea `.agents/kitchen.json`** (bloquea `.claude/settings.json`, `.claude/skills` y `.agents/skills/`). Igual, `apply` se corre desde la terminal del usuario.
- **Documentación:** README (sección "Uso" y una línea en "Cómo se conectan") y `docs/agent-guide.md` (fila nueva en "Mapa de archivos del repo") se actualizan en el mismo cambio.

## Decisiones tomadas en la conversación

- La lista se crea la primera vez que una persona elige en `apply`; en repos que ya existen también, en su siguiente `apply` con terminal.
- Las corridas siguientes usan las decisiones guardadas y no preguntan.
- Una pieza sin decisión se ofrece una vez; luego queda decidida.
- Cambiar debe ser posible, con un recordatorio de una línea que no moleste.
- Se cambia con `agent-kitchen apply --pieces`, no con una pregunta extra en cada corrida.

## Decisiones mías (revisables)

- El archivo se llama `.agents/kitchen.json` y guarda booleanos bajo `pieces`.
- Lo instalado cuenta como `true` al crear el archivo.
- `--yes` y una corrida sin terminal nunca escriben el archivo ni instalan piezas sin decisión cuando el archivo existe.
- El archivo se escribe tras las preguntas y antes de los pasos: si un paso falla, la decisión vale igual.
- `false` no desinstala.
- `--pieces` es la única forma de cambiar decisiones desde la CLI; el menú normal no suma la opción.
- `skills-manager` no lleva decisión.
- Un nombre desconocido se conserva al reescribir el archivo.
- Una pieza sin decisión, con `--yes` o sin terminal: si no está instalada, cuenta como `--skip`; si está instalada, como `true`.
- Si todo está instalado, la primera corrida con terminal escribe el archivo, todo en `true`, sin preguntar.

## Lo que queda al implementador

- Dónde vive la lectura y escritura del archivo (un módulo nuevo, por ejemplo `src/decisions.ts`, parece natural).
- El texto exacto de las líneas nuevas, siguiendo el tono de los mensajes actuales.
- Cómo marcar "(nueva)" en la tabla y en el label del paso.
- Los tests, siguiendo `test/sync.test.mjs` y `test/fake-tools.mjs`: como mínimo, primera corrida con y sin piezas instaladas, `false` respetado con `--yes`, pieza nueva con y sin terminal, `--pieces` (y sus errores de uso), nombres desconocidos conservados al reescribir, `--dry-run` y `--skip` sin escribir, y `doctor` con una pieza en `false`.
