import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AttendanceRecordsModal } from "@/features/asistencia/components/attendance-records-modal";

type Event = {
  persona_id: string | null;
  tienda_id: string;
  store_name: string;
  event_type: string;
  occurred_at: string;
  punctuality_status: string | null;
  late_minutes: number | string | null;
};
type ScheduleDetail = {
  persona_id: string;
  fecha: string;
  tipo: string;
  hora_ingreso: string | null;
  hora_salida: string | null;
  tiene_descanso: boolean;
  horas_programadas: number;
  horario_id: string;
};
type Person = {
  id: string;
  nombres: string;
  apellidos: string;
  puestos: { nombre: string } | Array<{ nombre: string }> | null;
};

function limaDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function hour(value: string | null | undefined) {
  return value?.slice(0, 5) ?? "—";
}
function minutes(value: number) {
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""}`;
}
function clock(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
function monday(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function eventTime(value: string) {
  return new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
// Legacy parser retained for historic records; calculateWorkday handles current sequences.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function actualBreak(events: Event[]) {
  const starts = events.filter(
    (event) => event.event_type === "inicio_refrigerio",
  );
  const ends = events.filter((event) => event.event_type === "fin_refrigerio");
  let total = 0;
  const periods: string[] = [];
  starts.forEach((start, index) => {
    const end = ends[index];
    if (!end) return;
    const duration = Math.max(
      0,
      new Date(end.occurred_at).getTime() -
        new Date(start.occurred_at).getTime(),
    );
    total += Math.round(duration / 60_000);
    periods.push(
      `${new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(start.occurred_at))} – ${new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(end.occurred_at))}`,
    );
  });
  return {
    total,
    label: periods.length
      ? `${periods.join(", ")} · ${minutes(total)}`
      : "Sin break registrado",
  };
}

function calculateWorkday(events: Event[]) {
  const ordered = [...events].sort((first, second) => first.occurred_at.localeCompare(second.occurred_at));
  let openWork: Event | null = null;
  let lastExit: Event | null = null;
  let breakMinutes = 0;
  let workedMinutes = 0;
  const breaks: string[] = [];
  ordered.forEach((event) => {
    const isEntry = event.event_type === "entrada" || event.event_type === "fin_refrigerio";
    const isExit = event.event_type === "salida" || event.event_type === "inicio_refrigerio";
    if (isEntry) {
      if (lastExit) {
        const duration = Math.max(0, Math.round((new Date(event.occurred_at).getTime() - new Date(lastExit.occurred_at).getTime()) / 60_000));
        breakMinutes += duration;
        breaks.push(`${eventTime(lastExit.occurred_at)} – ${eventTime(event.occurred_at)}`);
        lastExit = null;
      }
      openWork = event;
    }
    if (isExit && openWork) {
      workedMinutes += Math.max(0, Math.round((new Date(event.occurred_at).getTime() - new Date(openWork.occurred_at).getTime()) / 60_000));
      openWork = null;
      lastExit = event;
    }
  });
  return { total: breakMinutes, worked: workedMinutes, hasOpenWork: Boolean(openWork), label: breaks.length ? `${breaks.join(", ")} · ${minutes(breakMinutes)}` : "Sin break registrado" };
}

export async function AttendanceHistory({
  range = "week",
  date,
}: {
  range?: "day" | "week" | "month";
  date?: string;
}) {
  const session = await createClient();
  const { data: claims } = await session.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string")
    return <EmptyHistory message="Tu sesión expiró." />;
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("persona_id,role,is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile?.is_active || !["owner", "supervisor"].includes(profile.role))
    return (
      <EmptyHistory message="No tienes permiso para consultar asistencia." />
    );
  let storeIds: string[];
  if (profile.role === "owner") {
    const { data } = await admin
      .from("tiendas")
      .select("id")
      .eq("is_active", true);
    storeIds = (data ?? []).map((row) => row.id);
  } else {
    const { data } = await admin
      .from("tienda_supervisores")
      .select("tienda_id")
      .is("valid_to", null)
      .or(`persona_id.eq.${profile.persona_id},user_id.eq.${userId}`);
    storeIds = (data ?? []).map((row) => row.tienda_id);
  }
  if (!storeIds.length)
    return (
      <EmptyHistory message="No tienes tiendas asignadas para consultar." />
    );
  const today = limaDate(new Date());
  const selected = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const startDate =
    range === "day"
      ? selected
      : range === "week"
        ? monday(selected)
        : `${selected.slice(0, 7)}-01`;
  const endDate =
    range === "day"
      ? addDays(startDate, 1)
      : range === "week"
        ? addDays(startDate, 7)
        : `${addDays(`${selected.slice(0, 7)}-01`, 32).slice(0, 7)}-01`;
  const scheduleStart = monday(startDate);
  const [eventsResult, schedulesResult] = await Promise.all([
    admin
      .from("attendance_events")
      .select(
        "persona_id,tienda_id,store_name,event_type,occurred_at,punctuality_status,late_minutes",
      )
      .in("tienda_id", storeIds)
      .gte("occurred_at", `${startDate}T00:00:00-05:00`)
      .lt("occurred_at", `${endDate}T00:00:00-05:00`)
      .order("occurred_at", { ascending: true }),
    admin
      .from("horarios_semanales")
      .select("id,tienda_id")
      .in("tienda_id", storeIds)
      .gte("semana_inicio", scheduleStart)
      .lt("semana_inicio", endDate),
  ]);
  const schedules = schedulesResult.data ?? [];
  const scheduleIds = schedules.map((schedule) => schedule.id);
  const { data: details } = scheduleIds.length
    ? await admin
        .from("horarios_semanales_detalles")
        .select(
          "persona_id,fecha,tipo,hora_ingreso,hora_salida,tiene_descanso,horas_programadas,horario_id",
        )
        .in("horario_id", scheduleIds)
        .gte("fecha", startDate)
        .lt("fecha", endDate)
    : { data: [] as ScheduleDetail[] };
  const storeBySchedule = new Map(
    schedules.map((schedule) => [schedule.id, schedule.tienda_id]),
  );
  const events = (eventsResult.data ?? []) as Event[];
  const scheduleDetails = (details ?? []) as ScheduleDetail[];
  const personIds = [
    ...new Set([
      ...events.flatMap((event) =>
        event.persona_id ? [event.persona_id] : [],
      ),
      ...scheduleDetails.map((detail) => detail.persona_id),
    ]),
  ];
  const { data: people } = personIds.length
    ? await admin
        .from("personas")
        .select("id,nombres,apellidos,puestos(nombre)")
        .in("id", personIds)
    : { data: [] as Person[] };
  const peopleById = new Map(
    ((people ?? []) as Person[]).map((person) => [person.id, person]),
  );
  const eventsByKey = new Map<string, Event[]>();
  events.forEach((event) => {
    if (!event.persona_id) return;
    const key = `${limaDate(new Date(event.occurred_at))}:${event.persona_id}:${event.tienda_id}`;
    eventsByKey.set(key, [...(eventsByKey.get(key) ?? []), event]);
  });
  const detailByKey = new Map(
    scheduleDetails.map((detail) => [
      `${detail.fecha}:${detail.persona_id}:${storeBySchedule.get(detail.horario_id)}`,
      detail,
    ]),
  );
  const keys = new Set([...eventsByKey.keys(), ...detailByKey.keys()]);
  const rows = [...keys]
    .map((key) => {
    const [date, personaId] = key.split(":");
      const dayEvents = eventsByKey.get(key) ?? [];
      const detail = detailByKey.get(key);
      const person = peopleById.get(personaId);
      const position = Array.isArray(person?.puestos)
        ? person?.puestos[0]?.nombre
        : person?.puestos?.nombre;
      const entries = dayEvents.filter(
        (event) => event.event_type === "entrada",
      );
      const exits = dayEvents.filter((event) => event.event_type === "salida");
      const rawEntry = entries[0];
      const firstEntry = rawEntry
        ? {
            ...rawEntry,
            late_minutes: clock(Number(rawEntry.late_minutes ?? 0)),
          }
        : undefined;
      const lastExit = exits.at(-1);
      const breakInfo = calculateWorkday(dayEvents);
      return {
        key,
        date,
        name: person
          ? `${person.nombres} ${person.apellidos}`
          : "Colaborador sin vincular",
        position: position ?? "Sin cargo",
        store: dayEvents[0]?.store_name ?? "Tienda asignada",
        detail,
        dayEvents,
        firstEntry,
        lastExit,
        breakInfo,
        effective: breakInfo.worked || (lastExit ? 0 : null),
        hasOpenWork: breakInfo.hasOpenWork,
      };
    })
    .sort(
      (first, second) =>
        second.date.localeCompare(first.date) ||
        first.name.localeCompare(second.name),
    );
  const days = new Map<string, typeof rows>();
  rows.forEach((row) =>
    days.set(row.date, [...(days.get(row.date) ?? []), row]),
  );
  return (
    <div className="w-full space-y-5">
      {rows.length ? (
        [...days.entries()].map(([date, records]) => (
          <section
            key={date}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <header className="border-b border-slate-100 bg-slate-50 px-5 py-3">
              <h3 className="font-semibold capitalize text-slate-900">
                {new Date(`${date}T12:00:00`).toLocaleDateString("es-PE", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </h3>
            </header>
            <div className="overflow-x-auto">
              <table className="min-w-[1380px] w-full text-left text-sm">
                <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Colaborador</th>
                    <th className="px-3 py-3">Turno programado</th>
                    <th className="px-3 py-3">Ingreso real</th>
                    <th className="px-3 py-3">Salida real</th>
                    <th className="px-3 py-3">Break real</th>
                    <th className="px-3 py-3">Marcaciones</th>
                    <th className="px-3 py-3">Horas efectivas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((row) => (
                    <tr key={row.key}>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-900">
                          {row.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {row.position} · {row.store}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-medium text-slate-800">
                          {hour(row.detail?.hora_ingreso)} –{" "}
                          {hour(row.detail?.hora_salida)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {row.detail
                            ? `${row.detail.tipo} · ${Number(row.detail.horas_programadas)} h programadas`
                            : "Sin horario"}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-medium text-slate-800">
                          {row.firstEntry
                            ? new Intl.DateTimeFormat("es-PE", {
                                timeZone: "America/Lima",
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              }).format(new Date(row.firstEntry.occurred_at))
                            : "—"}
                        </p>
                        <p
                          className={`mt-1 text-xs ${row.firstEntry?.punctuality_status === "late" ? "text-rose-600" : "text-emerald-700"}`}
                        >
                          {row.firstEntry
                            ? row.firstEntry.punctuality_status === "late"
                              ? `Tardanza ${row.firstEntry.late_minutes ?? "00:00"}`
                              : "A tiempo · tardanza 00:00"
                            : "Sin marcación"}
                        </p>
                      </td>
                      <td className="px-3 py-4 font-medium text-slate-800">
                        {row.lastExit
                          ? new Intl.DateTimeFormat("es-PE", {
                              timeZone: "America/Lima",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            }).format(new Date(row.lastExit.occurred_at))
                          : "—"}
                      </td>
                      <td className="px-3 py-4">
                        <p className="text-xs font-medium text-slate-800">
                          {row.breakInfo.label}
                        </p>
                      </td>
                      <td className="px-3 py-4"><AttendanceRecordsModal records={row.dayEvents.map((event) => ({ event_type: event.event_type, occurred_at: event.occurred_at }))} /></td>
                      <td className="px-3 py-4">
                        <p className="text-base font-bold text-indigo-800">
                          {row.effective === null
                            ? "—"
                            : minutes(row.effective)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {row.effective === null
                            ? "Pendiente de salida"
                            : "entrada a salida menos break"}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      ) : (
        <EmptyHistory message="No hay horarios ni marcaciones en el período seleccionado." />
      )}
    </div>
  );
}

function EmptyHistory({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-7 text-sm text-slate-500">
      {message}
    </div>
  );
}
