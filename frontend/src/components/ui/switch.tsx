import * as React from 'react'
import { cn } from '@/lib/utils'

type SwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean
  size?: 'sm' | 'md'
  onCheckedChange?: (checked: boolean) => void
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, size = 'sm', onCheckedChange, className, disabled, ...props }, ref) => {
    const isSmall = size === 'sm'
    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onCheckedChange?.(!checked)
        }}
        className={cn(
          'relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isSmall ? 'h-5 w-9' : 'h-6 w-11',
          checked ? 'bg-emerald-500/90' : 'bg-zinc-300',
          className
        )}
        {...props}
      >
        <span
          className={cn(
            'pointer-events-none inline-block transform rounded-full bg-white transition-transform duration-200',
            isSmall ? 'h-4 w-4 shadow-[0_1px_2px_rgba(0,0,0,0.35)]' : 'h-5 w-5 shadow-[0_1px_2px_rgba(0,0,0,0.35)]',
            checked ? (isSmall ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0.5'
          )}
        />
      </button>
    )
  }
)

Switch.displayName = 'Switch'
