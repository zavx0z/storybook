# Ограничение native tools установленного Codex ACP

Исследование 5 октября 2026 года. Это известный незакрытый пункт интеграции,
а не принятый архитектурный закон и не подтверждение готовности изоляции.

Проверены установленный `@agentclientprotocol/codex-acp 2.1.1`,
`@openai/codex 0.159.3`, публичная документация и JSON Schema OpenAI.
Модель не запускалась; live model-visible inventory и поведение запретов
не проверялись. Пользовательская конфигурация не изменялась.

## Требование

Сохранить ACP, штатный выбор модели/effort и восстановление сессии.
Внутренний исполнитель получает знания и исполняет действия только через
назначенное окружение; native shell/filesystem/web/plugins/skills и MCP
не образуют параллельного пути.

## Проверенные границы

- `CODEX_CONFIG` применяется адаптером к `thread/start` и `thread/resume`.
  Установленный `dist/index.js`: `newSession` около строки 34084,
  `resumeSession` около 33986, `createSessionConfig` около 34187.
- `sendPrompt` около строки 34338 передаёт на каждом turn отдельные
  `approvalPolicy` и `sandboxPolicy` из `AgentMode`. Только изменение
  `config.sandbox_mode` не устанавливает независимую политику turn.
- `AgentMode.ReadOnly` около строки 33054 разрешает чтение; изменение файлов
  и сеть предполагают запрос разрешения. `read-only` не означает отсутствие
  native инструментов. `clientCapabilities: {}` также не задаёт их allowlist.
- Адаптер сам получает `skills/list` для публикации команд
  (`AvailableCommands.publish`, около строки 35722).
- [Exclusive MCP](../../src/policy.ts) отключает обнаруженные MCP и
  plugins/apps через bootstrap/session overrides. Этот механизм не является
  доказательством запрета всех native tools.

Точные номера относятся к установленному bundle указанной версии и могут
измениться после обновления зависимости.

## Штатные настройки и предел вывода

[Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)
документирует выключатели shell, web, apps, hooks и multi-agent.
[JSON Schema](https://learn.chatgpt.com/docs/config-schema.json) не содержит
общего `tool_policy`/`allowed_tools`. `ToolRegistryConfigToml` задаёт только
проверку коллизий имён и диагностическую metadata. Настройки отдельных skills
и bundled skills не доказывают общий запрет provider-native действий.

Обнаружено расхождение: текстовый Reference упоминает `tools.view_image`,
но опубликованная JSON Schema и строки установленного бинарника показывают
`ToolsToml` из трёх других полей; schema содержит `features.view_image`.
Наличие поля в schema подтверждает форму конфигурации, а не live поведение.

Следующая конфигурация является **частичным ограничением для будущей проверки**:

```ts
{
  mode: "read-only",
  mcpServers: [],
  exclusiveMcp: true,
  config: {
    "features.shell_tool": false,
    "features.unified_exec": false,
    "features.view_image": false,
    "features.apps": false,
    "features.plugins": false,
    "features.multi_agent": false,
    "features.hooks": false,
    web_search: "disabled",
  },
}
```

Она не является доказательством выполнения всего требования. Полная
no-native конфигурация установленного Codex ACP не подтверждена.

[Hooks](https://learn.chatgpt.com/docs/hooks) прямо предупреждает:
некоторые специализированные пути обходят hook; hosted WebSearch не покрывается;
ошибка, timeout или некорректный ответ `PreToolUse` могут не остановить действие.
Поэтому deny-all hook не является требуемой границей исполнения.

## Что необходимо для закрытия пункта

Нужен публичный provider/adapter contract, которым хост задаёт полный набор
model-visible инструментов и который проверяет тот же набор при исполнении,
в том числе после resume. Пустой `mcpServers`, prompt-инструкция и наблюдение
ACP tool events такого контракта не заменяют.

[Dynamic tools App Server](https://learn.chatgpt.com/docs/app-server)
подключают дополнительные возможности, но сами не запрещают встроенные tools.
Отдельный ACP-адаптер к публичному Responses API с `tools: []` мог бы оставить
исполнение команд у хоста окружения; это другой provider/auth/billing и собственное
восстановление provider-состояния, а не сохранённый native Codex ACP.

Перед приёмкой требуется проверить фактический каталог и отказ до эффекта
для native shell, файлового чтения/изменения, hosted web и сторонних расширений,
с сохранением модели/effort и resume. До такой проверки пункт остаётся открытым.

## Живая проверка обычного пути исполнения

Позднее в той же работе проверен production Chat Server с настоящим Codex ACP,
пустым списком MCP и настройками дочернего процесса из `app/server/src/chat.ts`.
Из реального каталога выбраны GPT-6 Luna и уровень мышления low. Среда передала
стартовый контекст, модель вернула JSON-команду `filesystem.read` для тестового
файла, хост исполнил её и доставил результат следующему обращению к модели.
Финальный ответ в точности совпал со случайным содержимым файла, неизвестным модели
до чтения. История содержит один завершённый вызов среды и ноль native tool calls.

Это подтверждает работоспособность конкретного пути без MCP и принятие настроек
установленной связкой. Проверка не перечисляла весь model-visible каталог и не
пыталась обходить границы; она не отменяет ограничение строгого no-tools контракта,
описанное выше. Пользовательская конфигурация Codex не изменялась.
