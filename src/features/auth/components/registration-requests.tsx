"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ActionMessage } from "@/components/ui/action-message";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  approveRegistrationRequest,
  rejectRegistrationRequest,
} from "@/features/auth/server/actions";

export type RegistrationRequest = {
  id: string;
  nombres: string;
  apellidos: string;
  documento: string;
  email: string;
  puesto: string;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
};

type ActionResult = { ok: boolean; message: string };
type StatusFilter = "review" | "approved" | "rejected" | "failed" | "all";
type PendingAction = { type: "approve" | "reject"; request: RegistrationRequest };

const emptyMessage: ActionResult = { ok: false, message: "" };

/** Solo estas solicitudes pueden aprobarse o rechazarse (igual que antes). */
const isActionable = (status: string) => ["pending", "failed"].includes(status);

const statusMeta: Record<string, { label: string; tone: string }> = {
  pending: {
    label: "Pendiente",
    tone: "bg-amber-50 text-amber-700 ring-amber-600/20",
  },
  approved: {
    label: "Aprobada",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  },
  rejected: {
    label: "Rechazada",
    tone: "bg-rose-50 text-rose-700 ring-rose-600/20",
  },
  failed: {
    label: "Con error",
    tone: "bg-orange-50 text-orange-700 ring-orange-600/20",
  },
};
const fallbackMeta = {
  label: "",
  tone: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const dateFormatter = new Intl.DateTimeFormat("es-PE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Lima",
});

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function isExpired(request: RegistrationRequest) {
  const expires = new Date(request.expires_at).getTime();
  return !Number.isNaN(expires) && expires < Date.now();
}

/** El documento nunca se muestra completo. */
function maskDocument(value: string | null | undefined) {
  return value ? `${value.slice(0, 2)}••••` : "—";
}

/** Las acciones pueden devolver { ok, message } o nada; se normaliza. */
function toResult(value: unknown, okText: string): ActionResult {
  if (value && typeof value === "object" && "ok" in value) {
    const v = value as { ok: boolean; message?: string };
    return {
      ok: Boolean(v.ok),
      message:
        v.message || (v.ok ? okText : "No se pudo procesar la solicitud."),
    };
  }
  return { ok: true, message: okText };
}

/* ---------- Piezas pequeñas ---------- */

function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta[status] ?? { ...fallbackMeta, label: status };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${meta.tone}`}
    >
      {meta.label}
    </span>
  );
}

function Avatar({ request }: { request: RegistrationRequest }) {
  const initials = `${request.nombres.charAt(0)}${request.apellidos.charAt(0)}`
    .toUpperCase()
    .trim();
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-semibold text-white shadow-sm">
      {initials || "?"}
    </span>
  );
}

function SearchIcon() {
  return (
    <svg
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-slate-800">{children}</dd>
    </div>
  );
}

function RequesterCard({ request }: { request: RegistrationRequest }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
      <Avatar request={request} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">
          {request.nombres} {request.apellidos}
        </p>
        <p className="truncate text-xs text-slate-500">{request.email}</p>
      </div>
    </div>
  );
}

/* ---------- Vista principal ---------- */

export function RegistrationRequests({
  requests,
}: {
  requests: RegistrationRequest[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("review");
  const [message, setMessage] = useState<ActionResult>(emptyMessage);
  const [detail, setDetail] = useState<RegistrationRequest | null>(null);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [pending, startTransition] = useTransition();

  // Punto único de avisos: cámbialo por tu toast/alerta global si prefieres.
  const notify = (result: ActionResult) => setMessage(result);

  const stats = useMemo(
    () => ({
      total: requests.length,
      review: requests.filter((r) => isActionable(r.status)).length,
      pending: requests.filter((r) => r.status === "pending").length,
      approved: requests.filter((r) => r.status === "approved").length,
      rejected: requests.filter((r) => r.status === "rejected").length,
      failed: requests.filter((r) => r.status === "failed").length,
    }),
    [requests],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (filter === "review" && !isActionable(r.status)) return false;
      if (
        (filter === "approved" ||
          filter === "rejected" ||
          filter === "failed") &&
        r.status !== filter
      )
        return false;
      if (!term) return true;
      return `${r.nombres} ${r.apellidos} ${r.email} ${r.puesto} ${r.role}`
        .toLowerCase()
        .includes(term);
    });
  }, [requests, search, filter]);

  function openAction(type: PendingAction["type"], request: RegistrationRequest) {
    setIdentityChecked(false);
    setMessage(emptyMessage);
    setAction({ type, request });
  }

  function closeAction() {
    if (!pending) setAction(null);
  }

  function confirmAction() {
    if (!action || pending) return;
    const { type, request } = action;
    if (type === "approve" && !identityChecked) return;

    startTransition(async () => {
      try {
        const raw =
          type === "approve"
            ? await approveRegistrationRequest(request.id)
            : await rejectRegistrationRequest(request.id);
        const result = toResult(
          raw,
          type === "approve"
            ? "Solicitud aprobada correctamente."
            : "Solicitud rechazada.",
        );
        notify(result);
        if (result.ok) {
          setAction(null);
          setDetail(null);
          router.refresh();
        }
      } catch {
        notify({
          ok: false,
          message: "No se pudo procesar la solicitud. Revisa tu sesión.",
        });
      }
    });
  }

  const filters: { id: StatusFilter; label: string; count: number }[] = [
    { id: "review", label: "Por revisar", count: stats.review },
    { id: "approved", label: "Aprobadas", count: stats.approved },
    { id: "rejected", label: "Rechazadas", count: stats.rejected },
    ...(stats.failed > 0
      ? [{ id: "failed" as const, label: "Con error", count: stats.failed }]
      : []),
    { id: "all", label: "Todas", count: stats.total },
  ];

  return (
    <div className="w-full space-y-6">
      {/* Aviso de seguridad */}
      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <svg
          className="mt-0.5 h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v5h1" />
        </svg>
        <p>
          Verifica la identidad del solicitante fuera del sistema antes de
          aprobar. Las contraseñas nunca se muestran y el documento aparece
          parcialmente oculto.
        </p>
      </div>

      {/* Resultado de la última acción (con los modales cerrados) */}
      {message.message && !action && <ActionMessage state={message} />}

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Total solicitudes", value: stats.total, color: "text-slate-900" },
          { label: "Pendientes", value: stats.pending, color: "text-amber-600" },
          { label: "Aprobadas", value: stats.approved, color: "text-emerald-600" },
          { label: "Rechazadas", value: stats.rejected, color: "text-rose-600" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {s.label}
            </p>
            <p className={`mt-1 text-2xl font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tabla */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <SearchIcon />
            <input
              className="control-input w-full !pl-9"
              placeholder="Buscar por nombre, correo, puesto o rol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div
            className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1"
            role="tablist"
          >
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  filter === f.id
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {f.label}
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    filter === f.id
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Solicitante</th>
                <th className="px-4 py-3 font-medium">Documento</th>
                <th className="px-4 py-3 font-medium">Puesto / rol</th>
                <th className="px-4 py-3 font-medium">Solicitud</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className="transition hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar request={r} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">
                          {r.nombres} {r.apellidos}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {r.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">
                    {maskDocument(r.documento)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-800">{r.puesto || "—"}</p>
                    <span className="mt-0.5 inline-block rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">
                      {r.role || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate-700">{formatDate(r.created_at)}</p>
                    <p
                      className={`text-xs ${
                        isActionable(r.status) && isExpired(r)
                          ? "font-medium text-rose-600"
                          : "text-slate-500"
                      }`}
                    >
                      {isActionable(r.status) && isExpired(r)
                        ? "Vencida"
                        : `Vence ${formatDate(r.expires_at)}`}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDetail(r)}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                      >
                        Ver
                      </button>
                      {isActionable(r.status) && (
                        <>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => openAction("approve", r)}
                            className="rounded-lg px-3 py-1.5 text-sm font-medium text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-50"
                          >
                            Aprobar
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => openAction("reject", r)}
                            className="rounded-lg px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                          >
                            Rechazar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      {requests.length === 0
                        ? "Aún no hay solicitudes de acceso"
                        : "No hay solicitudes con estos filtros"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {filter === "review" && !search && requests.length > 0
                        ? "No tienes solicitudes por revisar."
                        : "Prueba con otra búsqueda o cambia el estado."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          {filtered.length} de {requests.length} solicitudes
        </p>
      </section>

      {/* Modal de detalle */}
      <Modal
        open={detail !== null}
        title="Detalle de la solicitud"
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Avatar request={detail} />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">
                  {detail.nombres} {detail.apellidos}
                </p>
                <p className="truncate text-sm text-slate-500">{detail.email}</p>
              </div>
              <div className="ml-auto">
                <StatusBadge status={detail.status} />
              </div>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Documento">
                <span className="font-mono">{maskDocument(detail.documento)}</span>
              </Detail>
              <Detail label="Puesto">{detail.puesto || "—"}</Detail>
              <Detail label="Rol">{detail.role || "—"}</Detail>
              <Detail label="Solicitada">{formatDate(detail.created_at)}</Detail>
              <Detail label="Vence">{formatDate(detail.expires_at)}</Detail>
            </dl>

            {detail.status === "failed" && (
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                La aprobación anterior no se completó. Puedes volver a
                intentarla o rechazar la solicitud.
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Cerrar
              </button>
              {isActionable(detail.status) && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openAction("reject", detail)}
                  >
                    Rechazar
                  </Button>
                  <Button type="button" onClick={() => openAction("approve", detail)}>
                    Aprobar
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Modal de confirmación (aprobar / rechazar) */}
      <Modal
        open={action !== null}
        title={
          action?.type === "approve" ? "Aprobar solicitud" : "Rechazar solicitud"
        }
        onClose={closeAction}
      >
        {action && (
          <div className="space-y-5">
            {message.message && !message.ok && <ActionMessage state={message} />}

            <RequesterCard request={action.request} />

            {action.type === "approve" ? (
              <>
                <p className="text-sm text-slate-600">
                  Se creará el acceso de esta persona como{" "}
                  <strong>{action.request.role}</strong> en el puesto{" "}
                  <strong>{action.request.puesto}</strong>.
                </p>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-indigo-300 hover:bg-indigo-50/40 has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/60">
                  <input
                    type="checkbox"
                    checked={identityChecked}
                    onChange={(e) => setIdentityChecked(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-slate-800">
                    Confirmo que verifiqué la identidad del solicitante.
                  </span>
                </label>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                La solicitud se marcará como rechazada y la persona no tendrá
                acceso al sistema.
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={closeAction}
                disabled={pending}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
              >
                Cancelar
              </button>
              <Button
                type="button"
                disabled={
                  pending || (action.type === "approve" && !identityChecked)
                }
                onClick={confirmAction}
              >
                {pending
                  ? "Procesando..."
                  : action.type === "approve"
                    ? "Aprobar"
                    : "Rechazar"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}