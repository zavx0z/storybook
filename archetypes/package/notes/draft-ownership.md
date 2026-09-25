# Что принадлежит пакету, а что — Storybook

Пакет владеет своим содержимым и ресурсами. Storybook предоставляет внешнее
средство их просмотра. Эта заметка удерживает границу между этими ответственностями.

```mermaid
flowchart LR
  package["Пакет"] --> data["Код, спецификации и ресурсы"]
  tool["Внешний Storybook"] --> read["Чтение и представление"]
  data --> read
```

### Почему Storybook остаётся внешним инструментом

Consumer project/package не содержит dependency, devDependency,
peerDependency, type import или runtime import `@zavx0z/storybook`, private
package `@scope/storybook`, package-local server/build/launcher либо собственный
Storybook port/process. Shared repository может иметь implementation
dependencies.

### Какие данные и ресурсы принадлежат пакету

Пакет владеет кодом, публичными контрактами и exports, TSDoc, исполняемыми
spec и их результатами, fixtures, tests и ресурсами. Семантический порядок
получается из структуры и исполняемых источников владельца. README указывает
на временные заметки. Проектный JSON manifest/catalog, перечни вкладок,
widget contributions и overrides автор не создаёт.

### Отдельный пакет и несколько подключённых проектов

Standalone package, one-package project, multi-package project, workspace и
несколько independently attached roots поддерживаются одинаково. Workspace не
является обязательным global registry и не создаётся искусственно.
