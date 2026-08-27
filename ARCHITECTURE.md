# Архитектура `@zavx0z/storybook`

Пакет находится только в development graph:

```text
@engine/core ─┐
@layout/core ─┼─> @zavx0z/storybook <─ repository Storybook app
@ui/elements ─┤                          └─ package-owned descriptors
@ui/components┘
```

Engine, Layout и UI остаются владельцами production mechanics. Shared package
собирает из них neutral Workbench, routing, server и static delivery, не
перенося к себе story semantics.

## Application flow

1. Repository app объявляет pages, mounts, capabilities, readiness, visible
   shell strings и owner asset paths.
2. Каждая package page передаёт собственный typed route tree и lazy story
   registry. Общий registry знает только eager metadata и вызывает owner-owned
   `normalizeModule`; UI Workbench использует совместимую обёртку с `UiSurface`
   и Blender-like Inspector categories для source, controls и events.
3. Dev server собирает browser entry один раз по запросу и кэширует его до
   owner-controlled restart.
4. Static builder независимо собирает каждую page, вычисляет asset digests и
   пишет один revisioned manifest.
5. Общий `$storybook` выбирает exact package process и browser target по
   `package.json#name`; operating system выделяет port, а shared launcher не
   принимает foreign process по совпавшему PID или origin.
6. Dev server проецирует routes/readiness/canvas/touch в typed runtime manifest;
   background browser helper читает его по package runtime и не содержит
   consumer selectors, origins или port registry.

Public package root намеренно пуст. Каждый contract импортируется через
точный lowercase subpath, соответствующий одному owner-neutral понятию.

## Self documentation application

Package-owned app `@zavx0z/storybook` на automatic port использует один и тот
же WebGPU Workbench для документации и живых примеров:

```text
one Workbench route tree
   ├─> public module stories   Russian preview + HTML/CSS/TypeScript source
   └─> live example variants  real @ui components
```

Typed documentation registry является единственным списком документируемых
модулей. Он преобразуется в обычный shared story registry; focused test
сравнивает его с `package.json#exports`, поэтому новый API не может пройти
repository check без своей story.
