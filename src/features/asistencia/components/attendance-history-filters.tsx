type HistoryRange = "day" | "week" | "month";

function todayInLima() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function AttendanceHistoryFilters({ range, date }: { range: HistoryRange; date?: string }) {
  return <section className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Ver por<select name="range" defaultValue={range} className="control-input mt-1.5"><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></label><label className="text-sm font-medium text-slate-700">Fecha de referencia<input name="date" type="date" defaultValue={date ?? todayInLima()} className="control-input mt-1.5" /></label></div><div className="flex flex-wrap gap-2"><button type="submit" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">Aplicar</button><button type="button" disabled title="Disponible próximamente" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-400">Exportar horas semanales</button></div></form><p className="mt-3 text-xs text-slate-500">La exportación semanal se incorporará en una siguiente etapa.</p></section>;
}
