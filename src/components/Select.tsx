import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DropdownPosition } from '../utils/dropdownPosition'
import { computeDropdownPosition } from '../utils/dropdownPosition'

export interface SelectOption<T extends string> {
  value: T
  label: string
  /** Compact form for the trigger, where a narrow control would truncate `label`. */
  shortLabel?: string
}

interface SelectProps<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  /** Shown when `value` matches no option — e.g. a "pick one" command menu. */
  placeholder?: string
  size?: 'sm' | 'md'
  /** Extra classes for the trigger, mainly for width. */
  className?: string
  title?: string
  ariaLabel?: string
}

/**
 * A dropdown that always opens directly against its trigger.
 *
 * A native `<select>` hands its popup to the OS, which on phones and tablets
 * means a sheet or a centred dialog rather than a list under the control — and
 * inside a `transform`ed or scroll-clipped ancestor, some mobile browsers anchor
 * that popup to the wrong place entirely. Both of the app's most-used dropdowns
 * (the terrain context menu, the panels in the side rail) sit in exactly those
 * containers.
 *
 * So the list is rendered into a portal on `document.body`, positioned from the
 * trigger's viewport rect: `getBoundingClientRect()` already accounts for any
 * ancestor transform, and a body-level portal can't be clipped by an ancestor's
 * `overflow`. It flips above the trigger when there isn't room below and follows
 * the trigger while the page scrolls.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  size = 'md',
  className = '',
  title,
  ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<DropdownPosition | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const text = size === 'sm' ? 'text-xs' : 'text-sm'
  const pad = size === 'sm' ? 'px-1.5 py-1' : 'px-3 py-2'

  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    setPosition(computeDropdownPosition(el.getBoundingClientRect(), window.innerWidth, window.innerHeight))
  }, [])

  const openList = useCallback(() => {
    reposition()
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }, [reposition, selectedIndex])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]
      setOpen(false)
      if (option) onChange(option.value)
    },
    [onChange, options],
  )

  // Track the trigger while open: scrolling a panel or resizing the window must
  // move the list with it rather than leave it stranded.
  useEffect(() => {
    if (!open) return
    const onScroll = () => reposition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, reposition])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    // Capture, so a press closes the list before the page underneath reacts.
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      }
      return
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(options.length - 1, i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(0, i - 1))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        commit(activeIndex)
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`flex items-center justify-between gap-1 bg-gray-800 border border-gray-700 rounded ${pad} ${text} text-left text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-gray-500'}`}>
          {selected ? (selected.shortLabel ?? selected.label) : (placeholder ?? '')}
        </span>
        <span aria-hidden className="text-gray-500 shrink-0 leading-none">▾</span>
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className="fixed z-[100] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg shadow-xl py-1"
            style={{
              left: position.left,
              top: position.top,
              bottom: position.bottom,
              minWidth: position.width,
              maxWidth: position.maxWidth,
              maxHeight: position.maxHeight,
            }}
          >
            {options.map((option, i) => (
              <div
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                ref={(el) => {
                  if (el && i === activeIndex) el.scrollIntoView({ block: 'nearest' })
                }}
                onPointerEnter={() => setActiveIndex(i)}
                onClick={() => commit(i)}
                className={`px-3 py-2.5 ${text} cursor-pointer whitespace-nowrap ${
                  i === activeIndex ? 'bg-gray-800' : ''
                } ${option.value === value ? 'text-blue-300' : 'text-gray-200'}`}
              >
                {option.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
