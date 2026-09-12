# Выбор модели при делегировании

`model-selection.ts` — `PreToolUse` hook для инструментов создания и продолжения
Codex-задач. Он не выбирает модель автоматически и не меняет аргументы вызова.

Hook проверяет:

- `mcp__codex_app__create_thread`: для локальной Codex-задачи явно заданы `model`
  и `thinking`; ChatGPT Work cloud исключён, потому что эти поля его schema не принимает;
- `spawn_agent`: явно заданы `model`, `reasoning_effort` и ограниченный `fork_turns`;
- `mcp__codex_app__send_message_to_thread`: отсутствие обоих overrides сохраняет
  текущие настройки, а частичный override блокируется.

Проверка наличия полей заставляет агента сделать явный выбор, но не доказывает,
что выбор соответствует сложности, неопределённости и последствиям ошибки.
Hook не анализирует prompt, не запрещает `high` безусловно и не подменяет прямой
выбор пользователя. Неохваченные инструменты и ошибки самого процесса остаются
fail-open согласно runtime Codex.

`fork_thread` и другие инструменты без полей model/reasoning effort не
проверяются: hook не добавляет несуществующие параметры в их schema.

## Подключение на этом Mac

Версионируемое определение находится в `hooks.json`. Пользовательский
`~/.codex/hooks.json` содержит такое же определение и подключает файл из
канонического checkout:

```json
{
  "description": "Проверка явного выбора модели при делегировании.",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(mcp__codex_app__(create_thread|send_message_to_thread)|spawn_agent|collaboration\\.spawn_agent|functions\\.collaboration\\.spawn_agent)$",
        "hooks": [
          {
            "type": "command",
            "command": "\"/Users/zavx0z/.bun/bin/bun\" \"/Users/zavx0z/repozitarium/storybook/.agents/hooks/model-selection.ts\"",
            "timeout": 5,
            "statusMessage": "Проверка выбора модели"
          }
        ]
      }
    ]
  }
}
```

Новый или изменённый hook не исполняется, пока пользователь не проверит и не
доверит точное определение. Trust hash программно не изменяется.

Официальный контракт событий, matcher, trust и deny output:
[Hooks](https://learn.chatgpt.com/docs/hooks).

## Проверка

```sh
bun test ./.agents/hooks/model-selection.test.ts
```
