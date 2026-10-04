/**
Проверяет неизменные визуальные свидетельства и планирует сравнение в одном масштабе.
Получение и хранение изображений, загрузка ресурсов и решение о приёмке остаются
у предоставившего свидетельство владельца. Расчёт геометрии не меняет эти состояния.

@packageDocumentation
*/
import type {Zavx0zStorybookSpecsReference} from "./contract"
import {validateReferenceText, isCompatibility, isAcceptance, positive, validateReferenceAsset, rect} from "./src/validation"
export type {Zavx0zStorybookSpecsReference} from "./contract"

const reference: Zavx0zStorybookSpecsReference.Output = Object.freeze<Zavx0zStorybookSpecsReference.Output>({
  /**
Проверяет предоставленное владельцем описание и сохраняет неизменный снимок.
Отображение свидетельства не выполняет переход его состояния приёмки.

@param input - Identity, происхождение, условия получения и неизменные metadata растра.

@returns Неизменное описание с отдельными неизменными viewport и asset.

@throws При неверных identity, происхождении, viewport либо metadata ресурса.
*/
  define(input) {
    validateReferenceText("id", input.id)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id)) {
      throw new Error(`Invalid Storybook reference id: ${input.id}`)
    }
    validateReferenceText("label", input.label)
    validateReferenceText("provenance", input.provenance)
    if (!isCompatibility(input.compatibility)) {
      throw new Error(`Invalid Storybook reference compatibility: ${input.compatibility}`)
    }
    if (!isAcceptance(input.acceptance)) {
      throw new Error(`Invalid Storybook reference acceptance: ${input.acceptance}`)
    }

    return Object.freeze({
      id: input.id,
      label: input.label,
      provenance: input.provenance,
      compatibility: input.compatibility,
      acceptance: input.acceptance,
      viewport: Object.freeze({
        width: positive("reference viewport width", input.viewport.width),
        height: positive("reference viewport height", input.viewport.height),
        devicePixelRatio: positive("reference viewport devicePixelRatio", input.viewport.devicePixelRatio),
      }),
      asset: validateReferenceAsset(input.asset),
    })
  },
  /**
Выбирает разделение области с максимальным общим масштабом двух изображений.
При точном равенстве вариантов используется prefer; обе области центрируются.

@param input - Доступные и исходные размеры в одинаковых логических единицах.
Размеры строго положительны; gap конечен, неотрицателен и меньше максимального размера viewport.

@returns Геометрия двух областей с одним масштабом.

@throws При неположительном размере или недопустимом gap.
*/
  plan(input) {
    const width = positive("comparison width", input.width)
    const height = positive("comparison height", input.height)
    const subjectWidth = positive("subject width", input.subject.width)
    const subjectHeight = positive("subject height", input.subject.height)
    const referenceWidth = positive("reference width", input.reference.width)
    const referenceHeight = positive("reference height", input.reference.height)
    const gap = input.gap ?? 8
    if (!Number.isFinite(gap) || gap < 0 || gap >= Math.max(width, height)) {
      throw new Error(`Storybook comparison gap must fit the viewport: ${gap}`)
    }

    const horizontalScale = Math.min(
      Math.max(0, width - gap) / (subjectWidth + referenceWidth),
      height / Math.max(subjectHeight, referenceHeight),
    )
    const verticalScale = Math.min(
      width / Math.max(subjectWidth, referenceWidth),
      Math.max(0, height - gap) / (subjectHeight + referenceHeight),
    )
    const orientation = horizontalScale === verticalScale
      ? input.prefer ?? "horizontal"
      : horizontalScale > verticalScale ? "horizontal" : "vertical"
    const scale = orientation === "horizontal" ? horizontalScale : verticalScale

    if (orientation === "horizontal") {
      const subject = rect(subjectWidth * scale, subjectHeight * scale)
      const reference = rect(referenceWidth * scale, referenceHeight * scale)
      const totalWidth = subject.w + gap + reference.w
      const startX = (width - totalWidth) / 2
      return Object.freeze({
        orientation,
        scale,
        subject: Object.freeze({...subject, x: startX, y: (height - subject.h) / 2}),
        reference: Object.freeze({...reference, x: startX + subject.w + gap, y: (height - reference.h) / 2}),
      })
    }

    const subject = rect(subjectWidth * scale, subjectHeight * scale)
    const reference = rect(referenceWidth * scale, referenceHeight * scale)
    const totalHeight = subject.h + gap + reference.h
    const startY = (height - totalHeight) / 2
    return Object.freeze({
      orientation,
      scale,
      subject: Object.freeze({...subject, x: (width - subject.w) / 2, y: startY}),
      reference: Object.freeze({...reference, x: (width - reference.w) / 2, y: startY + subject.h + gap}),
    })
  },
})

export default reference
