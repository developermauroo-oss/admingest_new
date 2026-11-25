import { AttendanceSchedule } from "@/features/asistencia/components/attendance-schedule";
import { loadPersonalData } from "@/features/personal/server/loaders";

export const dynamic = "force-dynamic";

export default async function AttendanceSchedulePage() {
  const { personas } = await loadPersonalData();
  return <AttendanceSchedule employees={personas.map((person) => ({ id: person.id, name: `${person.nombres} ${person.apellidos}`.trim(), role: person.puesto, stores: person.tiendas, canSell: person.puede_vender, active: person.is_active }))} />;
}
