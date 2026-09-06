import type {BrowserFontFaceSource} from "@zavx0z/browser"

/** Application font declarations; every file is served from its Engine owner. */
export const STORYBOOK_FONT_FACES: readonly BrowserFontFaceSource[] = Object.freeze([
  {family: "sans-serif", weight: 400, style: "normal", src: "/assets/inter-regular.ttf"},
  {family: "sans-serif", weight: 700, style: "normal", src: "/assets/inter-bold.ttf"},
  {family: "sans-serif", weight: 400, style: "italic", src: "/assets/inter-italic.ttf"},
  {family: "sans-serif", weight: 700, style: "italic", src: "/assets/inter-bold-italic.ttf"},
  {family: "monospace", weight: 400, style: "normal", src: "/assets/jetbrains-mono-regular.ttf"},
  {family: "monospace", weight: 700, style: "normal", src: "/assets/jetbrains-mono-bold.ttf"},
  {family: "monospace", weight: 400, style: "italic", src: "/assets/jetbrains-mono-italic.ttf"},
  {family: "monospace", weight: 700, style: "italic", src: "/assets/jetbrains-mono-bold-italic.ttf"},
])
