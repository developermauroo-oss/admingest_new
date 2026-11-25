"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Modal } from "@/components/ui/modal";
import {
  loadWeeklySchedule,
  saveWeeklySchedule,
} from "@/features/asistencia/server/schedule-actions";

type Employee = {
  id: string;
  name: string;
  role: string;
  stores: { id: string; nombre: string }[];
  canSell: boolean;
  active: boolean;
};
type Kind = "A" | "C" | "AC" | "D" | "P" | "VAC" | "LIC";
type Entry = { kind: Kind; start?: string; end?: string; hasBreak?: boolean };
type CustomTarget = { employeeId: string; day: Date } | null;
const presets: Record<Exclude<Kind, "P">, Entry> = {
  A: { kind: "A", start: "09:00", end: "17:00", hasBreak: true },
  C: { kind: "C", start: "15:00", end: "22:00", hasBreak: false },
  AC: { kind: "AC", start: "09:00", end: "22:00", hasBreak: true },
  D: { kind: "D" },
  VAC: { kind: "VAC" },
  LIC: { kind: "LIC" },
};
const labels: Record<Kind, string> = {
  A: "A · 09:00–17:00",
  C: "C · 15:00–22:00",
  AC: "AC · 09:00–22:00",
  D: "Descanso",
  P: "Personalizado",
  VAC: "Vacaciones",
  LIC: "Licencia",
};

function monday(date: Date) {
  const result = new Date(date);
  result.setHours(12, 0, 0, 0);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}
function dateValue(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}
function makeWeek(value: string) {
  const start = monday(new Date(`${value}T12:00:00`));
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}
function duration(entry: Entry) {
  if (["D", "VAC", "LIC"].includes(entry.kind) || !entry.start || !entry.end)
    return 0;
  const [startHour, startMinute] = entry.start.split(":").map(Number);
  const [endHour, endMinute] = entry.end.split(":").map(Number);
  const gross = (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60;
  const pause = entry.hasBreak ? (gross >= 10 ? 2 : 1) : 0;
  return Math.max(0, gross - pause);
}
function tone(kind: Kind) {
  return (
    {
      A: "bg-sky-50 border-sky-200 text-sky-800",
      C: "bg-violet-50 border-violet-200 text-violet-800",
      AC: "bg-amber-50 border-amber-200 text-amber-800",
      D: "bg-rose-50 border-rose-200 text-rose-700",
      P: "bg-indigo-50 border-indigo-200 text-indigo-800",
      VAC: "bg-teal-50 border-teal-200 text-teal-800",
      LIC: "bg-slate-100 border-slate-300 text-slate-700",
    } as Record<Kind, string>
  )[kind];
}

export function AttendanceSchedule({ employees }: { employees: Employee[] }) {
  const active = useMemo(
    () => employees.filter((employee) => employee.active),
    [employees],
  );
  const stores = useMemo(
    () =>
      [
        ...new Map(
          active.flatMap((employee) =>
            employee.stores.map((store) => [store.id, store.nombre]),
          ),
        ).entries(),
      ].map(([id, nombre]) => ({ id, nombre })),
    [active],
  );
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "all");
  const [weekStart, setWeekStart] = useState(() => {
    const next = monday(new Date());
    next.setDate(next.getDate() + 7);
    return dateValue(next);
  });
  const [hasCapa, setHasCapa] = useState(false);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [target, setTarget] = useState<CustomTarget>(null);
  const [custom, setCustom] = useState<Entry>({
    kind: "P",
    start: "14:00",
    end: "22:00",
    hasBreak: false,
  });
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const days = useMemo(() => makeWeek(weekStart), [weekStart]);
  // Temporalmente se permite editar semanas pasadas para pruebas de marcación.
  const editable = true;
  const team = active.filter(
    (employee) =>
      storeId === "all" ||
      employee.stores.some((store) => store.id === storeId),
  );
  const key = (id: string, day: Date) => `${id}:${dateValue(day)}`;
  const entry = (id: string, day: Date) => entries[key(id, day)] ?? presets.D;
  const acCount = (id: string) =>
    days.filter((day) => entry(id, day).kind === "AC").length;
  const restCount = (id: string) =>
    days.filter((day) => entry(id, day).kind === "D").length;
  const update = (id: string, day: Date, next: Entry) => {
    if (!editable) return;
    if (
      next.kind === "AC" &&
      entry(id, day).kind !== "AC" &&
      acCount(id) >= 1
    ) {
      setNotice("Solo se permite un turno AC por colaborador y semana.");
      return;
    }
    if (
      next.kind === "D" &&
      entry(id, day).kind !== "D" &&
      restCount(id) >= 1
    ) {
      setNotice("Solo se permite un día de descanso por colaborador y semana.");
      return;
    }
    setEntries((current) => ({ ...current, [key(id, day)]: next }));
    setNotice("");
  };
  const storeHours = (id: string) =>
    days.reduce((sum, day) => sum + duration(entry(id, day)), 0);
  const totalHours = (id: string) => storeHours(id) + (hasCapa ? 2 : 0);
  const targetStoreHours = hasCapa ? 46 : 48;
  const onLeave = (id: string) =>
    days.every((day) => ["VAC", "LIC"].includes(entry(id, day).kind));
  useEffect(() => {
    if (!storeId || storeId === "all") return;
    let current = true;
    loadWeeklySchedule({ storeId, weekStart }).then((result) => {
      if (!current || !result.ok) return;
      if (!result.schedule) {
        setEntries({});
        setHasCapa(false);
        return;
      }
      setHasCapa(result.schedule.hasCapa);
      setEntries(
        Object.fromEntries(
          result.schedule.entries.map((item) => [
            `${item.personaId}:${item.date}`,
            {
              kind: item.kind as Kind,
              start: item.start,
              end: item.end,
              hasBreak: item.hasBreak,
            },
          ]),
        ),
      );
    });
    return () => {
      current = false;
    };
  }, [storeId, weekStart]);
  const openCustom = (employeeId: string, day: Date) => {
    const current = entry(employeeId, day);
    setCustom(
      current.kind === "P"
        ? current
        : { kind: "P", start: "14:00", end: "22:00", hasBreak: false },
    );
    setTarget({ employeeId, day });
  };
  const saveCustom = () => {
    if (!target) return;
    if (!custom.start || !custom.end || duration(custom) <= 0) {
      setNotice("Revisa ingreso, salida y descanso del horario personalizado.");
      return;
    }
    update(target.employeeId, target.day, custom);
    setTarget(null);
  };
  const save = async () => {
    if (!storeId || storeId === "all") {
      setNotice("Selecciona una tienda para guardar.");
      return;
    }
    const invalid = team.find(
      (employee) =>
        !onLeave(employee.id) &&
        (storeHours(employee.id) !== targetStoreHours ||
          acCount(employee.id) > 1 ||
          restCount(employee.id) > 1),
    );
    if (invalid) {
      setNotice(`${invalid.name} no cumple las reglas semanales.`);
      return;
    }
    setSaving(true);
    const result = await saveWeeklySchedule({
      storeId,
      weekStart: dateValue(days[0]),
      hasCapa,
      entries: team.flatMap((employee) =>
        days.map((day) => {
          const item = entry(employee.id, day);
          return {
            personaId: employee.id,
            date: dateValue(day),
            kind: item.kind,
            start: item.start ?? null,
            end: item.end ?? null,
            hasBreak: Boolean(item.hasBreak),
            hours: duration(item),
          };
        }),
      ),
    });
    setNotice(result.message);
    setSaving(false);
  };
  const exportExcel = () => {
    const rows = team.map((employee) => ({
      Colaborador: employee.name,
      Cargo: employee.role,
      ...Object.fromEntries(
        days.map((day) => {
          const item = entry(employee.id, day);
          return [
            day.toLocaleDateString("es-PE", {
              day: "2-digit",
              month: "2-digit",
            }),
            item.kind === "P"
              ? `${item.start} - ${item.end}`
              : labels[item.kind],
          ];
        }),
      ),
      "Horas tienda": storeHours(employee.id),
      CAPA: hasCapa ? 2 : 0,
      Total: totalHours(employee.id),
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Horario");
    XLSX.writeFile(book, `horario-${dateValue(days[0])}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
              Marcación
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">
              Horario semanal
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Lunes a domingo. El horario registra horas programadas; las
              cumplidas se medirán en Marcación.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportExcel}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Exportar Excel
            </button>
            <button
              type="button"
              disabled={!editable || saving}
              onClick={save}
              className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar horario"}
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">
            Tienda
            <select
              className="control-input mt-1.5"
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
            >
              <option value="all">Todas las tiendas</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Semana
            <input
              className="control-input mt-1.5"
              type="date"
              value={weekStart}
              onChange={(event) =>
                setWeekStart(
                  dateValue(monday(new Date(`${event.target.value}T12:00:00`))),
                )
              }
            />
          </label>
          <label className="mt-6 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={hasCapa}
              disabled={!editable}
              onChange={(event) => setHasCapa(event.target.checked)}
              className="size-4 rounded border-slate-300 text-indigo-600"
            />
            Esta semana tiene CAPA (2 h)
          </label>
        </div>
        <p
          className={`mt-3 text-sm ${editable ? "text-emerald-700" : "text-slate-500"}`}
        >
          {editable
            ? `Semana futura editable · meta: ${targetStoreHours} h tienda${hasCapa ? " + 2 h CAPA" : ""}.`
            : "Semana actual o pasada: solo lectura."}
        </p>
        <p className="mt-1 text-xs font-medium text-slate-500">
          Semana seleccionada: lunes{" "}
          {days[0].toLocaleDateString("es-PE", {
            day: "2-digit",
            month: "long",
          })}{" "}
          — domingo{" "}
          {days[6].toLocaleDateString("es-PE", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </p>
        {notice ? (
          <p
            role="status"
            className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800"
          >
            {notice}
          </p>
        ) : null}
      </section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3 text-xs text-slate-600">
          A: 7 h (1 h descanso) · C: 7 h · AC: 11 h (2 h pausa) · máximo 1 AC.
          En personalizado, el descanso es 2 h si el tramo es de 10 h o más; si
          es menor, 1 h.
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full text-left text-sm">
            <thead className="bg-slate-950 text-white">
              <tr>
                <th className="min-w-56 px-4 py-3">Colaborador</th>
                {days.map((day) => (
                  <th
                    key={day.toISOString()}
                    className="min-w-36 px-2 py-3 text-center"
                  >
                    <span className="block text-xs uppercase text-slate-300">
                      {day.toLocaleDateString("es-PE", { weekday: "short" })}
                    </span>
                    {day.toLocaleDateString("es-PE", {
                      day: "2-digit",
                      month: "2-digit",
                    })}
                  </th>
                ))}
                <th className="px-3">Tienda</th>
                <th className="px-3">CAPA</th>
                <th className="px-3">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {team.map((employee) => (
                <tr key={employee.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">
                      {employee.name}
                    </p>
                    <p className="text-xs text-slate-500">{employee.role}</p>
                  </td>
                  {days.map((day) => {
                    const current = entry(employee.id, day);
                    return (
                      <td key={day.toISOString()} className="px-2 py-2">
                        <select
                          disabled={!editable}
                          value={current.kind}
                          onChange={(event) => {
                            const kind = event.target.value as Kind;
                            if (kind === "P") openCustom(employee.id, day);
                            else update(
                                  employee.id,
                                  day,
                                  presets[kind as Exclude<Kind, "P">],
                                );
                          }}
                          className={`w-full rounded-md border px-1 py-1 text-xs disabled:bg-slate-50 ${tone(current.kind)}`}
                        >
                          {Object.keys(labels).map((kind) => (
                            <option key={kind} value={kind}>
                              {labels[kind as Kind]}
                            </option>
                          ))}
                        </select>
                        {current.kind === "P" ? (
                          <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-indigo-700">
                            <span>
                              {current.start}–{current.end}
                            </span>
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={() => openCustom(employee.id, day)}
                              title="Editar horario personalizado"
                              aria-label="Editar horario personalizado"
                              className="grid size-5 place-items-center rounded text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                            >
                              ✎
                            </button>
                          </div>
                        ) : null}
                        <p className="mt-1 text-center text-[10px] font-semibold text-slate-500">
                          {duration(current)} h
                        </p>
                      </td>
                    );
                  })}
                  <td className="text-center font-bold">
                    {storeHours(employee.id)}
                  </td>
                  <td className="text-center font-bold text-sky-700">
                    {hasCapa ? 2 : 0}
                  </td>
                  <td
                    className={`text-center text-lg font-bold ${totalHours(employee.id) === 48 ? "text-emerald-700" : "text-slate-800"}`}
                  >
                    {totalHours(employee.id)}
                  </td>
                </tr>
              ))}
              {team.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="px-5 py-12 text-center text-slate-500"
                  >
                    No hay colaboradores activos asignados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <Modal
        open={Boolean(target)}
        title="Horario personalizado"
        description="Define ingreso, salida y si corresponde descanso."
        onClose={() => setTarget(null)}
        maxWidthClassName="max-w-md"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-700">
              Ingreso
              <input
                type="time"
                value={custom.start}
                onChange={(event) =>
                  setCustom((current) => ({
                    ...current,
                    start: event.target.value,
                  }))
                }
                className="control-input mt-1.5"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Salida
              <input
                type="time"
                value={custom.end}
                onChange={(event) =>
                  setCustom((current) => ({
                    ...current,
                    end: event.target.value,
                  }))
                }
                className="control-input mt-1.5"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(custom.hasBreak)}
              onChange={(event) =>
                setCustom((current) => ({
                  ...current,
                  hasBreak: event.target.checked,
                }))
              }
              className="size-4 rounded border-slate-300 text-indigo-600"
            />
            Corresponde descanso
          </label>
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Horas programadas: <b>{duration(custom)} h</b>.{" "}
            {custom.hasBreak
              ? "El descanso se descuenta automáticamente: 2 h desde 10 h de tramo, o 1 h si es menor."
              : "No se descuenta pausa."}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={saveCustom}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
            >
              Aplicar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
