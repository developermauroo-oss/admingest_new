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

  const { data: contextData, error: contextError } = await supabase
    .rpc("current_employee_context")
    .maybeSingle();
  const context = contextData as EmployeeContext | null;
  const role = context?.role ?? null;

  const isValidRole = role === "owner" || role === "zonal" || role === "supervisor";
  if (contextError || !context || !isValidRole) {
    redirect("/login?next=/inicio");
  }

  const stores = Array.isArray(context.tiendas)
    ? context.tiendas.filter((store): store is { id: string; nombre: string } =>
      typeof store === "object" && store !== null && typeof store.id === "string" && typeof store.nombre === "string",
    )
    : [];
  const name = [context.nombres, context.apellidos].filter(Boolean).join(" ") || "Usuario";

  return <AppShell email={email} name={name} role={role as "owner" | "zonal" | "supervisor"} position={context.puesto || null} stores={stores}>{children}</AppShell>;
}
