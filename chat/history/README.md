# История беседы

[Публичный reader](./index.ts) проверяет общую timeline для storage и представления.
[Контракт](./contract/index.ts) и [сценарий](./spec/scenario.spec.ts) раскрывают
сохраняемое содержимое и границы чтения.

ACP validators создаёт [официальный Ajv standalone generator](./scripts/generate-validators.ts)
из публичной `@agentclientprotocol/sdk/schema/schema.json`. Runtime reader
использует готовые validators без компиляции схем в браузере. Сгенерированный
файл содержит SHA256 исходной схемы; штатный Prettier форматирует вывод Ajv
с `semi:false`, сохраняя его поведение.
`bun run generate:validators` воспроизводит файл; `bun run check:validators`
проверяет полное соответствие текущей схеме и установленной версии generator.
