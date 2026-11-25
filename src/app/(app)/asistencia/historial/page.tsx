import { AttendanceHistory } from "@/features/asistencia/components/attendance-history";
import { AttendanceHistoryFilters } from "@/features/asistencia/components/attendance-history-filters";

export const dynamic = "force-dynamic";
export default async function AttendanceHistoryPage({ searchParams }: { searchParams: Promise<{ range?: string; date?: string }> }) {
  const query = await searchParams;
  const range = query.range === "day" || query.range === "month" ? query.range : "week";
  return <div className="space-y-5"><AttendanceHistoryFilters range={range} date={query.date} /><AttendanceHistory range={range} date={query.date} /></div>;
}
