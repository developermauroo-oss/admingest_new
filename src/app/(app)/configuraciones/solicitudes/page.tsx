import { requireRole } from "@/features/auth/server/authorization";
import {
  RegistrationRequests,
  type RegistrationRequest,
} from "@/features/auth/components/registration-requests";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { supabase } = await requireRole("owner");
  const { data, error } = await supabase.rpc("owner_list_registration_requests");

  return (
    <div className="w-full space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          No se pudieron cargar las solicitudes de registro. Intenta recargar la
          página.
        </div>
      )}
      <RegistrationRequests
        requests={(data ?? []) as RegistrationRequest[]}
      />
    </div>
  );
}