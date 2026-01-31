"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const isDeterminate = typeof value === "number" && Number.isFinite(value)
  const clamped = isDeterminate ? Math.min(100, Math.max(0, value)) : null

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "bg-primary h-full transition-all",
          isDeterminate ? "w-full flex-1" : "w-1/3 animate-progress-indeterminate"
        )}
        style={
          isDeterminate
            ? { transform: `translateX(-${100 - (clamped ?? 0)}%)` }
            : { transform: "translateX(-100%)" }
        }
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
