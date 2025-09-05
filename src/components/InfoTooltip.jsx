import React from "react";

export function InfoTooltip({ text }) {
  return (
    <span className="relative group inline-block align-middle">
      <span className="w-5 h-5 flex items-center justify-center rounded-full bg-slate-200 text-slate-600 text-xs font-bold cursor-pointer border border-slate-300" style={{ width: 20, height: 20 }}>
        ?
      </span>
      <span className="absolute z-10 left-6 top-1/2 -translate-y-1/2 hidden group-hover:block bg-white text-slate-700 text-xs rounded shadow-lg p-2 min-w-[180px] border border-slate-200" style={{ whiteSpace: 'pre-line' }}>
        {text}
      </span>
    </span>
  );
}
