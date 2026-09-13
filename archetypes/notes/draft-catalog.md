# Как сведения из файлов попадают в общий каталог

Разные способы обнаружения должны отдавать сведения в один общий формат.
Тогда граф, сборка, интерфейс и MCP используют одинаковые данные.
Граница формата находится в [catalog.t.ts](../../catalog/catalog.t.ts),
JSON-источник — в [declarations.ts](../../discovery/declarations.ts).

```mermaid
flowchart LR
  json["JSON-объявления"] --> catalog["Нормализованный каталог"]
  other["Другие источники"] --> catalog
  catalog --> graph["Общий граф"]
  graph --> build["Сборка"]
  graph --> view["Интерфейс и MCP"]
```

`catalog/catalog.t.ts` владеет общим контрактом обнаруженного содержания.
`discovery/declarations.ts` реализует действующий JSON resolver. Реестр принимает
resolver при создании; граф и подготовка сборки не импортируют JSON reader.
Источник проверяет свои файлы, а граф сохраняет точные identities, semantic
order, маршруты, source references и ресурсные связи.

[Обнаружение и независимость пакетов](../package/notes/draft-discovery.md).

[Границы пакета и владение ресурсами](../package/notes/draft-ownership.md).
