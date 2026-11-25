import { requireRole } from "@/features/auth/server/authorization";
import { loadPersonalData } from "@/features/personal/server/loaders";
import { BiometricEvaluation } from "@/features/asistencia/components/biometric-evaluation";
export const dynamic = "force-dynamic";
export default async function BiometricEvaluationPage() {
  await requireRole("owner");
  const { personas } = await loadPersonalData();
  const options = personas.filter(person => person.is_active).flatMap(person => person.tiendas.map(store => ({ personId: person.id, storeId: store.id, label: `${person.nombres} ${person.apellidos} · ${store.nombre}` })));
  return <BiometricEvaluation options={options} />;
}
