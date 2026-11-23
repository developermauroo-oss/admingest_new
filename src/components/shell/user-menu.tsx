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
import type { ReactNode } from "react";
import { signOut } from "@/features/auth/server/actions";

type Role = "owner" | "zonal" | "supervisor" | null;
type Store = { id: string; nombre: string };

const roleLabels: Record<Exclude<Role, null>, string> = {
  owner: "Owner",
  zonal: "Zonal",
  supervisor: "Supervisor",
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
    <div className="flex gap-2.5 py-1.5 text-xs">
      <FontAwesomeIcon icon={icon} className="mt-0.5 w-3.5 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <div className="mt-0.5 break-words font-medium text-slate-700">{children}</div>
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

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-[10px] px-1 py-1 pr-2 transition hover:bg-slate-100 [&::-webkit-details-marker]:hidden">
        <div className="relative grid size-9 place-items-center rounded-full border border-indigo-100 bg-indigo-50 text-xs font-bold text-indigo-700">
          {initials(name)}
          <span className="absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white bg-emerald-500" />
        </div>
        <div className="hidden min-w-0 text-left sm:block">
          <div className="max-w-48 truncate text-[13px] font-semibold text-slate-800">{name}</div>
          <div className="text-xs text-slate-500">{roleLabel}</div>
        </div>
        <FontAwesomeIcon icon={faChevronDown} className="hidden text-[10px] text-slate-400 transition-transform group-open:rotate-180 sm:block" />
      </summary>

      <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,20,30,0.14)]">
        <div className="flex items-center gap-3 bg-slate-50 px-4 py-3.5">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-indigo-600 text-sm font-bold text-white">{initials(name)}</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
            <p className="mt-0.5 text-xs text-slate-500">Sesión activa</p>
          </div>
        </div>

        <div className="divide-y divide-slate-100 px-4 py-2">
          <Detail icon={faBriefcase} label="Cargo">{position || "Cargo no registrado"}</Detail>
          <Detail icon={faEnvelope} label="Correo">{email || "Correo no registrado"}</Detail>
          <Detail icon={faUserShield} label="Rol">{roleLabel}</Detail>
          <Detail icon={faStore} label={stores.length > 1 ? "Tiendas asignadas" : "Tienda asignada"}>
            {stores.length ? (
              <ul className="space-y-0.5">
                {stores.map((store) => <li key={store.id}>{store.nombre}</li>)}
              </ul>
            ) : "Sin tienda asignada"}
          </Detail>
        </div>

        <form action={signOut} className="border-t border-slate-100 p-1.5">
          <button type="submit" className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium text-slate-600 transition hover:bg-rose-50 hover:text-rose-600">
            <FontAwesomeIcon icon={faRightFromBracket} className="w-4" />
            Cerrar sesión
          </button>
        </form>
      </div>
    </details>
  );
}
