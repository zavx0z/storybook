# Размещение согласованных требований

Это указатель на владельцев решений из сессии «Архитип на JSX», а не отдельный
стандарт или классификатор. Номера соответствуют собранному перечню R01–R34.
Смысл, уже выраженный в коде и сценариях, читается там; остальные пояснения
следуют [жизненному циклу notes](note-lifecycle.md).

| Требования | Владелец |
| --- | --- |
| R01–R04: область, сводный API, основной вход, публичные имена | [Domain](../../domain/notes/structure.md) |
| R05–R06: разные среды, один index при одном входе | [Среды Domain](../../domain/notes/environments.md) |
| R07: предметные поддомены | [Domain](../../domain/notes/structure.md) |
| R08: дублирование и идентичность | [Публичные экспорты](../package/notes/draft-exports.md) |
| R09–R11: default, именованные типы и имя реализации | [Component](../../component/notes/draft-placement.md) |
| R12–R13: тип у владельца, без универсального types-пакета | [Контракты](../specs/contracts/notes/draft-contracts.md) |
| R14: внутренние импорты владельцев | [Импорты Component](../../component/notes/imports.md) |
| R15–R16: Input из Output и доказательство pipeline | [Контракты](../specs/contracts/notes/draft-contracts.md), [зависимости](../specs/deps/notes/draft-dependencies.md) |
| R17–R19: declare module, применимость и граница runtime | [Контракты](../specs/contracts/notes/draft-contracts.md) |
| R20: dependency/dev/peer | [Зависимости Package](../package/notes/dependencies.md) |
| R21: сначала штатные возможности | [Развитие](development.md) |
| R22–R25: фиксированные протоколы, физические цели, без обязательного ручного Runtime | [Среды Domain](../../domain/notes/environments.md) |
| R26–R29: Repo-only workspaces, glob и физическая вложенность | [Repo](../repo/notes/structure.md) |
| R30–R31: JSX перед нормой, Cosmos как незавершённый пример | [Развитие](development.md), [Domain](../../domain/notes/environments.md) |
| R32: назначение fixture | [Сценарии](../specs/scenarios/notes/draft-structural-scenarios.md) |
| R33–R34: точность чтения/отчёта и пределы поручения | [Развитие](development.md) |

## Границы подтверждения

[Общий сценарий Package](../package/spec/scenario.spec.ts) классифицирует по
фактам читателя: реализации, реэкспорты, типы, владельцы и условия.
[Generic примеры](../package/test/export-ownership.test.ts) проверяют применение
одного сценария к домену, функции/значению, средовым входам и нарушениям.

Смысловая полнота контрактов, состояния и жизненного цикла не следует из
файловой полноты и остаётся [явно ограниченной](../../component/notes/verification.md).
Наличие условия exports не доказывает совместимость среды. Отдельный type-only
продукт вне текущей модели требует собственного обоснования. Эти границы не
подменяются успешными проверками, выдуманными владельцами или фиктивным default.
