import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }): ReactNode {
  return <TooltipPrimitive.Provider delayDuration={360}>{children}</TooltipPrimitive.Provider>;
}

export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipContent = TooltipPrimitive.Content;
