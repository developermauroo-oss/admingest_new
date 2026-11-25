"use client";

import {
  faBriefcase,
  faChevronDown,
  faEnvelope,
  faRightFromBracket,
  faStore,
  faUserShield,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut } from "@/features/auth/server/actions";

type Role = "owner" | "zonal" | "supervisor" | null;
type Store = { id: string; nombre: string };

const roleLabels: Record<Exclude<Role, null>, string> = {
  owner: "Owner",
  zonal: "Zonal",
  supervisor: "Supervisor",
};

const roleStyles: Record<Exclude<Role, null>, string> = {
  owner: "bg-violet-100 text-violet-700 ring-violet-200",
  zonal: "bg-sky-100 text-sky-700 ring-sky-200",
  supervisor: "bg-emerald-100 text-emerald-700 ring-emerald-200",
};

function initials(name: string) {
  return (name || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function Detail({ icon, label, children }: { icon: typeof faEnvelope; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl p-2 transition hover:bg-slate-50">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-500">
        <FontAwesomeIcon icon={icon} className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        <div className="mt-0.5 break-words text-[13px] font-medium text-slate-700">{children}</div>
      </div>
    </div>
  );
}

export function UserMenu({
  email,
  name,
  role,
  position,
  stores,
}: {
  email: string;
  name: string;
  role: Role;
  position: string | null;
  stores: Store[];
}) {
  const roleLabel = role ? roleLabels[role] : "Sin rol asignado";
  const roleStyle = role ? roleStyles[role] : "bg-slate-100 text-slate-600 ring-slate-200";
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Cierra al hacer clic fuera o presionar Escape
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((v) => !v)}
        className={`group flex items-center gap-2.5 rounded-full border py-1 pl-1 pr-2.5 transition-all duration-200 sm:pr-3 ${isOpen
            ? "border-indigo-200 bg-indigo-50/70 shadow-sm"
            : "border-transparent hover:border-slate-200 hover:bg-white hover:shadow-sm"
          }`}
      >
        <span className="relative grid size-9 place-items-center rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-xs font-bold text-white shadow-md shadow-indigo-500/25 ring-2 ring-white">
          {initials(name)}
          <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-emerald-400" />
        </span>
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-40 truncate text-[13px] font-semibold leading-tight text-slate-800">{name}</span>
          <span className="block text-[11px] leading-tight text-slate-500">{roleLabel}</span>
        </span>
        <FontAwesomeIcon
          icon={faChevronDown}
          className={`hidden size-2.5 text-slate-400 transition-transform duration-300 group-hover:text-slate-600 sm:block ${isOpen ? "rotate-180" : ""
            }`}
        />
      </button>

      <div
        role="menu"
        aria-hidden={!isOpen}
        className={`absolute right-0 top-[calc(100%+12px)] z-50 w-[min(21rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_20px_50px_-12px_rgba(30,27,75,0.25)] transition-all duration-200 ${isOpen ? "visible translate-y-0 scale-100 opacity-100" : "invisible -translate-y-2 scale-95 opacity-0"
          }`}
      >
        {/* Cabecera con gradiente */}
        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-5 pb-5 pt-5">
          <div className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-white/10 blur-xl" />
          <div className="pointer-events-none absolute -bottom-12 left-6 size-28 rounded-full bg-fuchsia-300/20 blur-2xl" />
          <div className="relative flex items-center gap-3.5">
            <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/20 text-lg font-bold text-white ring-1 ring-white/30 backdrop-blur">
              {initials(name)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold text-white">{name}</p>
              <span className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${roleStyle}`}>
                <span className="size-1.5 rounded-full bg-current" />
                {roleLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Detalles */}
        <div className="space-y-0.5 p-2">
          <Detail icon={faBriefcase} label="Cargo">
            {position || <span className="text-slate-400">Cargo no registrado</span>}
          </Detail>
          <Detail icon={faEnvelope} label="Correo">
            {email || <span className="text-slate-400">Correo no registrado</span>}
          </Detail>
          <Detail icon={faUserShield} label="Rol">
            {roleLabel}
          </Detail>
          <Detail icon={faStore} label={stores.length > 1 ? "Tiendas asignadas" : "Tienda asignada"}>
            {stores.length ? (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {stores.map((store) => (
                  <li
                    key={store.id}
                    className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100"
                  >
                    {store.nombre}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-slate-400">Sin tienda asignada</span>
            )}
          </Detail>
        </div>

        {/* Cerrar sesión */}
        <form action={signOut} className="border-t border-slate-100 bg-slate-50/60 p-2">
          <button
            type="submit"
            className="group flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98]"
          >
            <FontAwesomeIcon
              icon={faRightFromBracket}
              className="size-4 transition-transform group-hover:translate-x-0.5"
            />
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}