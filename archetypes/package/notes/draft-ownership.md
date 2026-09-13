# Границы пакета и владение ресурсами

Черновой материал из прежних описаний. Требует сверки с текущим кодом и принятыми решениями; положения о README, форматах файлов и способах исполнения могут быть устаревшими.

### `STORYBOOK-EXT-001` — внешний tool

Consumer project/package не содержит dependency, devDependency,
peerDependency, type import или runtime import `@zavx0z/storybook`, private
package `@scope/storybook`, package-local server/build/launcher либо собственный
Storybook port/process. Shared repository может иметь implementation
dependencies.

### `STORYBOOK-EXT-002` — owner data and resources

Package владеет versioned JSON manifest/catalog, semantic ordering,
README/stories/fixtures/tests/media/references и optional structural runtime.
Declaration хранит links, а не copied source/README/CSS или executable code.

### `STORYBOOK-EXT-003` — optional composition

Standalone package, one-package project, multi-package project, workspace и
несколько independently attached roots поддерживаются одинаково. Workspace не
является обязательным global registry и не создаётся искусственно.
