import "server-only";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PuestoRow = { id: string; nombre: string };
export type PersonaRow = {
  id: string; nombres: string; apellidos: string; puesto: string;
  puesto_id?: string; documento?: string | null; telefono?: string | null; email?: string | null;
  authorized_role?: "zonal" | "supervisor" | null;
  tiendas: { id: string; nombre: string }[];
  is_active: boolean; puede_vender: boolean; estado_laboral: "activo" | "vacaciones";
};

export async function loadPersonalData() {
  const sessionClient = await createClient();
  const { data: claims, error: claimsError } = await sessionClient.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (claimsError || typeof userId !== "string") redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("persona_id, role, is_active, personas!inner(id, is_active)")
    .eq("user_id", userId)
    .maybeSingle();
  const person = Array.isArray(profile?.personas) ? profile.personas[0] : profile?.personas;
  if (!profile?.is_active || !person?.is_active || (profile.role !== "owner" && profile.role !== "supervisor")) redirect("/inicio");

  if (profile.role === "supervisor") {
    const { data: authorization } = await admin
      .from("access_authorizations")
      .select("is_active, revoked_at")
      .eq("persona_id", profile.persona_id)
      .eq("role", "supervisor")
      .maybeSingle();
    if (!authorization?.is_active || authorization.revoked_at) redirect("/inicio");
  }

  const [{ data: assignments }, { data: puestoRows }, { data: peopleRows }, { data: authorizations }] = await Promise.all([
    admin.from("tienda_supervisores").select("tienda_id, persona_id, user_id").is("valid_to", null),
    profile.role === "owner" ? admin.from("puestos").select("id, nombre").eq("is_active", true).order("nombre") : Promise.resolve({ data: [] }),
    admin.from("personas").select("id, puesto_id, nombres, apellidos, documento, telefono, email, is_active, puede_vender, estado_laboral, puestos(nombre)"),
    profile.role === "owner" ? admin.from("access_authorizations").select("persona_id, role, is_active, revoked_at") : Promise.resolve({ data: [] }),
  ]);

  const storeIds = profile.role === "owner"
    ? null
    : (assignments ?? []).filter((row) => row.persona_id === profile.persona_id || row.user_id === userId).map((row) => row.tienda_id);
  const [{ data: stores }, { data: promoterAssignments }] = await Promise.all([
    storeIds === null ? admin.from("tiendas").select("id, nombre") : admin.from("tiendas").select("id, nombre").in("id", storeIds),
    admin.from("tienda_promotores").select("persona_id, tienda_id").is("valid_to", null),
  ]);
  const storeNameById = new Map((stores ?? []).map((store) => [store.id, store.nombre]));
  const assignedPeople = new Map<string, string[]>();
  for (const row of assignments ?? []) {
    if (row.persona_id && storeNameById.has(row.tienda_id)) assignedPeople.set(row.persona_id, [...(assignedPeople.get(row.persona_id) ?? []), row.tienda_id]);
  }
  for (const row of promoterAssignments ?? []) {
    if (storeNameById.has(row.tienda_id)) assignedPeople.set(row.persona_id, [...(assignedPeople.get(row.persona_id) ?? []), row.tienda_id]);
  }
  const authorizedRole = new Map((authorizations ?? []).filter((row) => row.is_active && !row.revoked_at).map((row) => [row.persona_id, row.role as "zonal" | "supervisor"]));
  const personas = (peopleRows ?? [])
    .filter((row) => profile.role === "owner" || assignedPeople.has(row.id))
    .map((row) => {
      const job = Array.isArray(row.puestos) ? row.puestos[0] : row.puestos;
      const ids = [...new Set(assignedPeople.get(row.id) ?? [])];
      return { id: row.id, puesto_id: row.puesto_id, nombres: row.nombres, apellidos: row.apellidos, documento: row.documento, telefono: row.telefono, email: row.email, puesto: job?.nombre ?? "Sin cargo registrado", tiendas: ids.map((id) => ({ id, nombre: storeNameById.get(id)! })), is_active: Boolean(row.is_active), puede_vender: Boolean(row.puede_vender), estado_laboral: row.estado_laboral === "vacaciones" ? "vacaciones" : "activo", authorized_role: authorizedRole.get(row.id) ?? null } satisfies PersonaRow;
    });
  return { role: profile.role, puestos: (puestoRows ?? []) as PuestoRow[], personas };
}
