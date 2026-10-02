/** Направление разделения общей области сравнения. */
export type Orientation = "horizontal" | "vertical"

/** Геометрия области в тех же логических единицах, что и переданные размеры сравнения. */
export type Rect = Readonly<{
  x: number
  y: number
  w: number
  h: number
}>

/** План размещения двух областей с одним масштабом и центрированием. */
export type Plan = Readonly<{
  orientation: Orientation
  scale: number
  subject: Rect
  reference: Rect
}>
