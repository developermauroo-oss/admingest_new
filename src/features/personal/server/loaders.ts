import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type PuestoRow = { id: string; nombre: string };

export type PersonaRow = {
  id: string;
  nombres: string;
  apellidos: string;
  puesto: string;
  tiendas: { id: string; nombre: string }[];
  is_active: boolean;
  puede_vender: boolean;
  estado_laboral: "activo" | "vacaciones";
};

type TeamRow = {
  persona_id: string;
  nombres: string;
  apellidos: string;
  puesto: string;
  tienda_id: string | null;
  tienda_nombre: string | null;
  is_active: boolean;
  puede_vender: boolean;
  estado_laboral: "activo" | "vacaciones" | null;
};

type EmployeeContext = { role: string };
type EditablePerson = PersonaRow & {
  puesto_id?: string;
  documento?: string | null;
  telefono?: string | null;
  email?: string | null;
  authorized_role?: "zonal" | "supervisor" | null;
};

export async function loadPersonalData() {
  const supabase = await createClient();
  const { data: contextData, error: contextError } = await supabase
    .rpc("current_employee_context")
    .maybeSingle();
  const context = contextData as EmployeeContext | null;

  if (contextError || !context || !["owner", "supervisor"].includes(context.role)) {
    redirect("/inicio");
  }

  const [teamResult, puestoResult, detailResult, authorizationResult] = await Promise.all([
    supabase.rpc("current_personal_team_snapshot"),
    context.role === "owner"
      ? supabase.from("puestos").select("id, nombre").eq("is_active", true).order("nombre")
      : Promise.resolve({ data: [], error: null }),
    context.role === "owner"
      ? supabase.from("personas").select("id, puesto_id, documento, telefono, email")
      : Promise.resolve({ data: [], error: null }),
    context.role === "owner"
      ? supabase.from("access_authorizations").select("persona_id, role, is_active, revoked_at")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (teamResult.error) {
    throw new Error("No se pudo cargar el personal autorizado.");
  }

  const detailsByPerson = new Map((detailResult.data ?? []).map((person) => [person.id, person]));
  const authorizedRoleByPerson = new Map(
    (authorizationResult.data ?? [])
      .filter((authorization) => authorization.is_active && !authorization.revoked_at)
      .map((authorization) => [authorization.persona_id, authorization.role as "zonal" | "supervisor"]),
  );
  const people = new Map<string, EditablePerson>();
  for (const row of (teamResult.data ?? []) as TeamRow[]) {
    const detail = detailsByPerson.get(row.persona_id);
    const person: EditablePerson = people.get(row.persona_id) ?? {
      id: row.persona_id,
      nombres: row.nombres,
      apellidos: row.apellidos,
      puesto: row.puesto,
      puesto_id: detail?.puesto_id,
      documento: detail?.documento,
      telefono: detail?.telefono,
      email: detail?.email,
      authorized_role: authorizedRoleByPerson.get(row.persona_id) ?? null,
      tiendas: [],
      is_active: Boolean(row.is_active),
      puede_vender: Boolean(row.puede_vender),
      estado_laboral: row.estado_laboral === "vacaciones" ? "vacaciones" : "activo",
    };

    if (row.tienda_id && row.tienda_nombre && !person.tiendas.some((store) => store.id === row.tienda_id)) {
      person.tiendas.push({ id: row.tienda_id, nombre: row.tienda_nombre });
    }
    people.set(person.id, person);
  }

  return {
    role: context.role as "owner" | "supervisor",
    puestos: (puestoResult.data ?? []) as PuestoRow[],
    personas: [...people.values()],
  };
}
