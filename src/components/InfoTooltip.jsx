import React from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function InfoTooltip({ text }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-role="help"
            onClick={(e) => e.stopPropagation()}
            className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-200 text-slate-600 text-xs font-bold cursor-help border border-slate-300"
          >
            ?
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="whitespace-pre-line text-right z-50">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
