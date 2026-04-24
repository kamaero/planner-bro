import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ChangelogSection } from '@/types'

interface Props {
  open: boolean
  sections: ChangelogSection[]
  onDismiss: () => void
}

function renderContent(content: string) {
  return content.split('\n').map((line, i) => {
    if (line.startsWith('### ')) {
      const heading = line.slice(4)
      const color =
        heading.includes('Добавлено') || heading.includes('Added')
          ? 'text-green-600 dark:text-green-400'
          : heading.includes('Исправлено') || heading.includes('Fixed')
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-muted-foreground'
      return (
        <p key={i} className={`font-semibold text-sm mt-3 mb-1 ${color}`}>
          {heading}
        </p>
      )
    }
    if (line.startsWith('- **')) {
      const parts = line.slice(2).split('**')
      return (
        <li key={i} className="text-sm ml-4 list-disc leading-relaxed">
          {parts.map((p, j) =>
            j % 2 === 1 ? <strong key={j}>{p}</strong> : <span key={j}>{p}</span>
          )}
        </li>
      )
    }
    if (line.startsWith('- ')) {
      return (
        <li key={i} className="text-sm ml-4 list-disc leading-relaxed text-muted-foreground">
          {line.slice(2)}
        </li>
      )
    }
    if (line.trim() === '' || line.startsWith('---')) return null
    return (
      <p key={i} className="text-sm text-muted-foreground">
        {line}
      </p>
    )
  })
}

export function ChangelogModal({ open, sections, onDismiss }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDismiss() }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0">
        <DialogHeader className="pb-4">
          <DialogTitle>Что нового в Planner Bro</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 pr-1 space-y-6">
          {sections.map((section) => (
            <div key={section.version}>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="font-bold text-base">[{section.version}]</span>
                <span className="text-sm text-muted-foreground">
                  {new Date(section.date + 'T00:00:00').toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                <span className="text-sm font-medium truncate">{section.title}</span>
              </div>
              <ul className="space-y-0.5">{renderContent(section.content)}</ul>
            </div>
          ))}
        </div>
        <div className="pt-4 border-t mt-4">
          <Button onClick={onDismiss} className="w-full">
            Понятно
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
