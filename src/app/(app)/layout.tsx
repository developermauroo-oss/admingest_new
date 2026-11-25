import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type EmployeeContext = {
  role: string;
  nombres: string | null;
  apellidos: string | null;
  puesto: string | null;
  tiendas: unknown;
};

export default async function ProtectedAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    redirect("/login");
  }

  const email =
    typeof data.claims.email === "string" ? data.claims.email : "usuario";

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role, is_active, personas(nombres, apellidos)")
    .eq("user_id", data.claims.sub)
    .maybeSingle();
  const { data: authorization, error: authorizationError } = await supabase.rpc("current_employee_authorization");
  const current = authorization?.[0];
  const { data: contextData } = await supabase
    .rpc("current_employee_context")
    .maybeSingle();
  const context = contextData as EmployeeContext | null;

  const person = Array.isArray(profile?.personas)
    ? profile.personas[0]
    : profile?.personas;
  const name = profile?.is_active && person
    ? [person.nombres, person.apellidos].filter(Boolean).join(" ")
    : "Usuario";
  const role = authorizationError
    ? (profile?.is_active && ["owner", "zonal", "supervisor"].includes(profile.role) ? profile.role : null)
    : (current?.persona_active && current?.authorization_active && ["owner", "zonal", "supervisor"].includes(current.role) ? current.role : null);

  if (!role) redirect("/login?next=/inicio");
  const stores = Array.isArray(context?.tiendas)
    ? context.tiendas.filter((store): store is { id: string; nombre: string } =>
      typeof store === "object" && store !== null && typeof store.id === "string" && typeof store.nombre === "string",
    )
    : [];
  const fullName = [context?.nombres, context?.apellidos].filter(Boolean).join(" ") || name;

  return <AppShell email={email} name={fullName} role={role} position={context?.puesto || null} stores={stores}>{children}</AppShell>;
}
