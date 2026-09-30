import type { ClassValue } from 'clsx'
import { defineComponent, h, type PropType } from 'vue'
import { cn } from '../lib/utils'

/** A slot-only element with base Tailwind classes; a `class` prop is merged in with `cn`. */
function styled(name: string, tag: string, base: string) {
  return defineComponent({
    name,
    inheritAttrs: false,
    props: { class: { type: [String, Array, Object] as PropType<ClassValue>, default: undefined } },
    setup(props, { slots, attrs }) {
      return () => h(tag, { ...attrs, class: cn(base, props.class) }, slots.default?.())
    },
  })
}

export const Card = styled('Card', 'div', 'flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground shadow-sm')
export const CardHeader = styled('CardHeader', 'div', 'grid gap-1.5 px-6')
export const CardTitle = styled('CardTitle', 'h3', 'font-semibold leading-none')
export const CardDescription = styled('CardDescription', 'p', 'text-sm text-muted-foreground')
export const CardContent = styled('CardContent', 'div', 'px-6')
export const CardFooter = styled('CardFooter', 'div', 'flex items-center px-6')

export const Table = styled('Table', 'table', 'w-full caption-bottom text-sm')
export const TableHeader = styled('TableHeader', 'thead', '[&_tr]:border-b')
export const TableBody = styled('TableBody', 'tbody', '[&_tr:last-child]:border-0')
export const TableRow = styled('TableRow', 'tr', 'border-b transition-colors hover:bg-muted/50')
export const TableHead = styled('TableHead', 'th', 'h-10 px-2 text-left align-middle font-medium text-muted-foreground')
export const TableCell = styled('TableCell', 'td', 'p-2 align-middle')

export const DialogHeader = styled('DialogHeader', 'div', 'grid gap-2')
export const DialogTitle = styled('DialogTitle', 'h2', 'text-lg font-semibold leading-none')
export const DialogDescription = styled('DialogDescription', 'p', 'text-sm text-muted-foreground')
export const DialogFooter = styled('DialogFooter', 'div', 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end')
