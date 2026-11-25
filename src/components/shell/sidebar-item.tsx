"use client";

import { faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { NavigationItem } from "@/config/navigation";

export function SidebarItem({
  item,
  active,
  expanded,
  collapsed,
  onClick,
}: {
  item: NavigationItem;
  active: boolean;
  expanded: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={collapsed ? item.label : undefined}
      aria-expanded={collapsed ? undefined : expanded}
      aria-controls={collapsed ? undefined : `sidebar-group-${item.key}`}
      onClick={onClick}
      className={`group flex h-11 w-full items-center rounded-xl font-medium transition-all duration-200 ${collapsed ? "justify-center px-0" : "gap-3 px-2"
        } ${active
          ? "bg-indigo-50 text-indigo-700"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        }`}
    >
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-lg transition-all duration-200 ${active
            ? "bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-indigo-500/30"
            : "bg-slate-100 text-slate-500 group-hover:bg-indigo-100 group-hover:text-indigo-600"
          }`}
      >
        <FontAwesomeIcon icon={item.icon} className="size-3.5" />
      </span>
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-left text-sm">{item.label}</span>
      )}
      {!collapsed ? (
        <FontAwesomeIcon
          icon={faChevronRight}
          className={`mr-1 size-2.5 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90 text-indigo-500" : ""
            }`}
        />
      ) : null}
    </button>
  );
}