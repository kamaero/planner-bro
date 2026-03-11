type ApiErrorLike = {
  response?: {
    data?: {
      detail?: unknown
    }
  }
  message?: string
}

function normalizeDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string }
    if (typeof first?.msg === 'string') return first.msg
  }
  return null
}

function translateKnown(message: string): string {
  if (message.includes('Dependency cycle is not allowed')) {
    return 'Нельзя сохранить: получится цикл зависимостей.'
  }
  if (message.includes('Task cannot depend on itself')) {
    return 'Нельзя сохранить: задача не может зависеть сама от себя.'
  }
  if (message.includes('Dependencies must be inside one project')) {
    return 'Нельзя сохранить: связь задач возможна только внутри одного проекта.'
  }
  if (message.includes('Task cannot be its own parent')) {
    return 'Нельзя сохранить: задача не может быть родителем самой себе.'
  }
  if (message.includes('Parent-child cycle is not allowed')) {
    return 'Нельзя сохранить: в иерархии задач обнаружен цикл родитель-ребенок.'
  }
  if (message.includes('Parent must be in the same project')) {
    return 'Нельзя сохранить: родительская задача должна быть из этого же проекта.'
  }
  if (message.includes('Parent task not found')) {
    return 'Нельзя сохранить: выбранная родительская задача не найдена.'
  }
  if (message.includes('Predecessor task not found')) {
    return 'Нельзя сохранить: одна из связанных задач не найдена.'
  }
  if (message.includes('Assignee not found')) {
    return 'Нельзя сохранить: выбранный исполнитель не найден или неактивен.'
  }
  if (message.includes('Task not found')) {
    return 'Задача не найдена. Обновите страницу и повторите.'
  }
  if (message.includes('Access denied')) {
    return 'Недостаточно прав для этого действия.'
  }
  if (message.includes('В строгом режиме')) {
    return message
  }
  if (message.includes('Нельзя начать задачу до завершения зависимостей')) {
    return message
  }
  return message
}

export function humanizeApiError(error: unknown, fallback: string): string {
  const detail = normalizeDetail((error as ApiErrorLike)?.response?.data?.detail)
  if (detail) return translateKnown(detail)
  const msg = (error as ApiErrorLike)?.message
  if (typeof msg === 'string' && msg.trim()) return msg
  return fallback
}
