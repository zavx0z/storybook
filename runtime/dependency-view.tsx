/**
Показывает ожидаемый состав компонента через общий GraphView в существующем Display.
Размеры нод измеряет DOM, раскладкой и маршрутами владеет @nodes/layout.
Целевой компонент остаётся наверху; маркеры направлены к нему от составляющих. CSS центрирует всю группу.

@packageDocumentation
*/
import {useMemo, useState} from "@zavx0z/component"
import {DiagramNode} from "@nodes/node/diagram"
import {GraphView, type GraphInput, type GraphLayoutComputer, type GraphNodeProps} from "@webxr/nodes/view"
import {layoutTopDown} from "@nodes/layout/top-down"
import {createCubicLinkRoute} from "@webxr/nodes/link"
import type {StorybookDependencyCase} from "../catalog/catalog.t.ts"
import type {Document} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {createStorybookComponentPresentation} from "./component-presentation.ts"

type DependencyLabel = Readonly<{label: string, title: string}>

function DependencyNode(props: GraphNodeProps) {
  const data = props.data as DependencyLabel
  return (
    <DiagramNode
      id={props.id}
      description={data.label}
      title={data.title}
      rect={props.rect}
      intrinsic={props.intrinsic}
      elementRef={props.elementRef}
      selected={props.selected}
      hidden={props.hidden}
      onActivate={props.onActivate}
    />
  )
}

/** Числовую геометрию создаёт layout только после измерения настоящих элементов. */
export function dependencyGraphInput(value: StorybookDependencyCase, onWidth?: (width: number) => void) {
  const nodes: GraphInput["nodes"][number][] = []
  const edges: {id: string, sourceNodeId: string, targetNodeId: string}[] = []
  for (const [id, entry] of Object.entries(value.graph)) {
    nodes.push({id, data: {label: id.slice(id.lastIndexOf("#") + 1), title: id}, view: DependencyNode})
    for (const target of entry.uses) {
      edges.push({id: JSON.stringify([id, target]), sourceNodeId: id, targetNodeId: target})
    }
    for (const tag of entry.elements) {
      const target = JSON.stringify([id, "element", tag])
      nodes.push({id: target, data: {label: `<${tag}>`, title: `Нативный элемент ${id}`}, view: DependencyNode})
      edges.push({id: target, sourceNodeId: id, targetNodeId: target})
    }
  }
  const layout: GraphLayoutComputer = measurements => {
    const result = layoutTopDown({
      attachment: "contour",
      nodes: measurements.map(node => ({id: node.id, width: node.width, height: node.height, shape: "rectangle" as const})),
      edges,
      layoutOptions: {nodeSpacing: 32, layerSpacing: 48, padding: 16},
    })
    onWidth?.(Math.max(1, result.bounds.x + result.bounds.width))
    return {
      bounds: result.bounds,
      nodes: result.nodes,
      links: result.edges.map(edge => ({
        id: edge.id,
        title: edge.id,
        route: createCubicLinkRoute(edge.curves),
        startArrow: true,
      })),
    }
  }
  return {input: {nodes} satisfies GraphInput, layout}
}

function DependencyGraph(props: Readonly<{value: StorybookDependencyCase}>) {
  const [width, setWidth] = useState<number | null>(null)
  const graph = useMemo(() => dependencyGraphInput(props.value, setWidth), [props.value])
  return (
    <section
      style={css`
        display: flex;
        flex-direction: column;
        align-items: center;
        flex: 0 0 auto;
        min-width: 100%;
        width: ${width === null ? "100%" : `${width}px`};
      `}
    >
      <h2>{props.value.name}</h2>
      <GraphView
        input={graph.input}
        layout={graph.layout}
        navigation="scroll"
        label={`Зависимости ${props.value.name}`}
        style={css`
          width: ${width === null ? "100%" : `${width}px`};
        `}
      />
    </section>
  )
}

export function StorybookDependencyView(props: Readonly<{cases: readonly StorybookDependencyCase[]}>) {
  return (
    <section
      data-storybook-dependencies=""
      aria-label="Ожидаемые зависимости компонентов"
      style={css`
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: auto;
      `}
    >
      <div
        style={css`
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: center;
          flex: 0 0 auto;
          width: 100%;
          min-height: 100%;
          gap: 12px;
        `}
      >
        {props.cases.map((value, index) => (
          <DependencyGraph
            key={index}
            value={value}
          />
        ))}
      </div>
    </section>
  )
}

export function createDependencyPresentation(document: Document, cases: readonly StorybookDependencyCase[]) {
  return createStorybookComponentPresentation(
    document,
    StorybookDependencyView as unknown as CompiledTemplate<{cases: readonly StorybookDependencyCase[]}>,
    {cases},
    "[data-storybook-dependencies]",
  )
}
