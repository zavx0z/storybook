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
   registry.
3. Dev server собирает browser entry один раз по запросу и кэширует его до
   owner-controlled restart.
4. Static builder независимо собирает каждую page, вычисляет asset digests и
   пишет один revisioned manifest.
5. Repository lifecycle выбирает process и browser target; shared package не
   запускает, не останавливает и не принимает чужой listener самостоятельно.

Public package root намеренно пуст. Каждый contract импортируется через
точный lowercase subpath, соответствующий одному owner-neutral понятию.

## Self documentation application

Repository-owned app на `4016` использует один и тот же WebGPU Workbench для
документации и живых примеров:

```text
one Workbench route tree
   ├─> public module stories   Russian preview + exact import source
   └─> live example variants  real @ui components
```

Typed documentation registry является единственным списком документируемых
модулей. Он преобразуется в обычный shared story registry; focused test
сравнивает его с `package.json#exports`, поэтому новый API не может пройти
repository check без своей story.
