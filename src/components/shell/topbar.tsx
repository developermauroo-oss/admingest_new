"use client";

import { faBars } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { UserMenu } from "@/components/shell/user-menu";

type ShellTopbarProps = {
  email: string;
  name: string;
  role: "owner" | "zonal" | "supervisor" | null;
  position: string | null;
  stores: { id: string; nombre: string }[];
  moduleTitle: string;
  viewTitle?: string;
  collapsed: boolean;
  onOpenMobile: () => void;
  onToggleCollapse: () => void;
};

const iconButton =
  "grid size-10 place-items-center rounded-xl text-slate-500 transition-all duration-200 hover:bg-indigo-50 hover:text-indigo-600 active:scale-95";

export function ShellTopbar({
  email,
  name,
  role,
  position,
  stores,
  moduleTitle,
  viewTitle,
  collapsed,
  onOpenMobile,
  onToggleCollapse,
}: ShellTopbarProps) {
  const showView = Boolean(viewTitle && viewTitle !== moduleTitle);

  return (
    <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-md md:px-6">
      {/* Línea de acento */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-indigo-300/70 to-transparent"
      />

      <button type="button" onClick={onOpenMobile} className={`${iconButton} md:hidden`} aria-label="Abrir menú">
        <FontAwesomeIcon icon={faBars} />
      </button>

      <button
        type="button"
        onClick={onToggleCollapse}
        className={`${iconButton} hidden md:grid`}
        aria-label={collapsed ? "Expandir menú lateral" : "Contraer menú lateral"}
      >
        <FontAwesomeIcon icon={faBars} />
      </button>

      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="truncate text-[17px] font-bold tracking-tight text-slate-900">{moduleTitle}</h1>
        {showView ? (
          <>
            <span aria-hidden="true" className="hidden h-4 w-px bg-slate-200 sm:block" />
            <span className="hidden truncate rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-100 sm:inline-block">
              {viewTitle}
            </span>
          </>
        ) : null}
      </div>

      <div className="flex-1" />
      <UserMenu email={email} name={name} role={role} position={position} stores={stores} />
    </header>
  );
}