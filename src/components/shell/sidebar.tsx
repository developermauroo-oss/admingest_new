"use client";

import { faHouse } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import {
  DEFAULT_APP_HREF,
  SHELL_NAVIGATION,
  type NavigationSection,
} from "@/config/navigation";
import { ShellLink } from "@/components/shell/shell-link";
import { SidebarGroup } from "@/components/shell/sidebar-group";

export function ShellSidebar({
  activeModule,
  activeView,
  collapsed,
  openGroup,
  onGroupToggle,
  navigation,
}: {
  activeModule: string;
  activeView?: string;
  collapsed: boolean;
  openGroup: string | null;
  onGroupToggle: (key: string) => void;
  navigation?: NavigationSection[];
}) {
  const dashboardActive = activeModule === "inicio";

  return (
    <aside
      className={
        "flex h-dvh flex-col border-r border-slate-200/80 bg-white transition-[width] duration-300 " +
        (collapsed ? "w-[76px]" : "w-[272px]")
      }
    >
      {/* Logo */}
      <div
        className={
          "flex h-16 shrink-0 items-center overflow-hidden border-b border-slate-100 " +
          (collapsed ? "justify-center px-3" : "px-5")
        }
      >
        <ShellLink href={DEFAULT_APP_HREF} className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-sm font-bold text-white shadow-md shadow-indigo-500/30 ring-2 ring-white">
            A
          </div>
          {!collapsed ? (
            <span className="whitespace-nowrap text-base font-bold tracking-tight text-slate-900">
              Admin<span className="bg-gradient-to-r from-indigo-600 to-fuchsia-600 bg-clip-text text-transparent">Ges</span>
            </span>
          ) : null}
        </ShellLink>
      </div>

      <nav
        aria-label="Navegación principal"
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4"
      >
        {/* Dashboard */}
        <div className="mb-5">
          <ShellLink
            href={DEFAULT_APP_HREF}
            title="Dashboard"
            aria-current={dashboardActive ? "page" : undefined}
            className={
              "group flex h-11 items-center rounded-xl transition-all duration-200 active:scale-[0.98] " +
              (dashboardActive
                ? "bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-500/25 "
                : "bg-slate-50 text-slate-700 ring-1 ring-slate-200/80 hover:bg-indigo-50 hover:text-indigo-700 hover:ring-indigo-200 ") +
              (collapsed ? "justify-center px-0" : "gap-3 px-3")
            }
          >
            <FontAwesomeIcon icon={faHouse} className="w-4 shrink-0 text-[13px]" />
            {!collapsed ? (
              <span className="whitespace-nowrap text-sm font-semibold">Dashboard</span>
            ) : null}
          </ShellLink>
        </div>

        {(navigation ?? SHELL_NAVIGATION).map((section) => (
          <section key={section.label} className="mb-6 last:mb-0">
            {!collapsed ? (
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {section.label}
              </p>
            ) : (
              <div className="mx-3 mb-3 h-px bg-slate-100" aria-hidden="true" />
            )}

            <div className="space-y-1">
              {section.items.map((item) => (
                <SidebarGroup
                  key={item.key}
                  item={item}
                  activeModule={activeModule}
                  activeView={activeView}
                  open={openGroup === item.key}
                  collapsed={collapsed}
                  onToggle={() => onGroupToggle(item.key)}
                />
              ))}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}