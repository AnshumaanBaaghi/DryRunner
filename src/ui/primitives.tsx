import clsx from 'clsx';
import { Tooltip } from 'radix-ui';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-panel-2 px-1.5 py-px font-mono text-[10px] text-ink-dim">{children}</kbd>
  );
}

export function Tip({ label, shortcut, children, side = 'top' }: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-md border border-line-strong bg-raised px-2 py-1 text-xs text-ink shadow-xl"
        >
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
}

export function IconButton({ label, shortcut, active, className, children, ...rest }: IconButtonProps) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        // mouse clicks must not steal focus, so keyboard shortcuts keep working afterwards
        onMouseDown={(e) => e.preventDefault()}
        className={clsx(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-dim transition-colors',
          'hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-35',
          'focus-visible:outline-2 focus-visible:outline-hl-current',
          active && 'bg-raised text-hl-current',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tip>
  );
}

export function Button({ variant = 'ghost', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hl-current',
        variant === 'primary' && 'bg-hl-current text-black hover:brightness-110',
        variant === 'ghost' && 'border border-line-strong bg-panel-2 text-ink hover:bg-raised',
        variant === 'danger' && 'border border-hl-error/50 text-hl-error hover:bg-hl-error/10',
        className,
      )}
      {...rest}
    />
  );
}

export function PanelHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</div>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}
