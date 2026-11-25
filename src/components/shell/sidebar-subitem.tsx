"use client";

import type { NavigationChild } from "@/config/navigation";
import { ShellLink } from "@/components/shell/shell-link";

export function SidebarSubitem({ item, active }: { item: NavigationChild; active: boolean }) {
  return (
    <ShellLink
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`group flex h-9 items-center gap-2.5 rounded-lg pl-3 pr-3 text-[13px] font-medium transition-all duration-200 ${active
          ? "bg-indigo-50 font-semibold text-indigo-700"
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        }`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full transition-all duration-200 ${active
            ? "bg-gradient-to-br from-indigo-500 to-fuchsia-500 shadow-[0_0_0_3px_rgba(99,102,241,0.18)]"
            : "bg-slate-300 group-hover:bg-indigo-400"
          }`}
      />
      <span className="truncate">{item.label}</span>
    </ShellLink>
  );
}