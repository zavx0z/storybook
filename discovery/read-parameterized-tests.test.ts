import {expect, test} from "bun:test"
import {resolve} from "node:path"
import {readParameterizedTests} from "./read-parameterized-tests.ts"

const root = resolve(import.meta.dir, "../../webxr-space")

test("[DIAGRAM-TEST-PARAMETERS] чтение spec возвращает название теста и полную параметризацию", async () => {
  const declarations = await readParameterizedTests(root, resolve(root, "nodes/node/diagram/spec/deps.spec.ts"))

  expect(declarations, "Spec должен содержать один test.each с исходным названием и полным массивом параметров DiagramNode").toEqual([
    {
      name: "[DIAGRAM-DEPENDENCIES] $name: полный граф компонентов и нативных элементов",
      describes: [],
      parameters: [
        {
          name: "DiagramNode",
          file: "nodes/node/diagram/index.tsx",
          expected: {
            "nodes/node/diagram/index.tsx#DiagramNode": {
              uses: ["ui/surfaces/pane.tsx#Pane", "ui/typography.tsx#Typography"],
              elements: ["article"],
            },
            "ui/surfaces/pane.tsx#Pane": {uses: [], elements: ["section"]},
            "ui/typography.tsx#Typography": {uses: [], elements: ["span"]},
          },
        },
      ],
    },
  ])
})

test("[DIAGRAM-STORY-PARAMETERS] чтение story возвращает варианты describe, название теста и исходник runtime", async () => {
  const declarations = await readParameterizedTests(root, resolve(root, "nodes/node/diagram/spec/story.spec.tsx"))

  expect(declarations, "Story должен вернуть три варианта describe.each и вложенный test.each с исходником runtime").toEqual([
    {
      name: "[DIAGRAM-STORY] DiagramNode отображает вариант и сохраняет его PNG",
      describes: [
        {
          name: "$name",
          parameters: [
            {
              name: "Прямоугольник",
              props: {
                id: "rectangle",
                description: "Описание занимает всю ноду",
                rect: {x: 40, y: 20, width: 240, height: 100},
                shape: "rectangle",
              },
              expectedSize: {width: 240, height: 100},
            },
            {
              name: "Овал",
              props: {
                id: "oval",
                description: "Описание занимает всю ноду",
                rect: {x: 40, y: 20, width: 240, height: 100},
                shape: "oval",
              },
              expectedSize: {width: 240, height: 100},
            },
            {
              name: "Круг",
              props: {
                id: "circle",
                description: "Описание занимает всю ноду",
                rect: {x: 40, y: 20, width: 240, height: 100},
                shape: "circle",
              },
              expectedSize: {width: 240, height: 240},
            },
          ],
        },
      ],
      parameters: [
        {
          runtime: {
            kind: "function",
            source: `async (props: DiagramNodeProps) => {
          const {DiagramNode} = await import("../index.tsx")
          return (
            <DiagramNode
              id={props.id}
              description={props.description}
              rect={props.rect}
              shape={props.shape}
            />
          )
        }`,
          },
        },
      ],
    },
  ])
})
