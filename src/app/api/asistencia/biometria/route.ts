import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const schema = z.object({
  operation: z.enum(["start", "evidence", "status", "revoke", "confirm", "reports"]),
  personaId: z.string().uuid(),
  storeId: z.string().uuid(),
  sessionId: z.string().max(100).optional(),
  images: z.array(z.string().max(2_000_000)).min(3).max(5).optional(),
  mode: z.enum(["enroll", "verify"]).optional(),
  grant: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().positive().max(100).optional(),
  evaluation: z.boolean().optional(),
  consent: z.boolean().optional(),
  kind: z.enum(["genuine", "impostor", "photo", "screen", "video"]).optional(),
  lighting: z.string().max(100).optional(),
  device: z.string().max(100).optional(),
});

export async function POST(request: Request) {
  // Only the explicitly selected independent Cloud test project is allowed.
  const database = new URL(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid",
  );
  const testProject = process.env.BIOMETRIC_TEST_SUPABASE_PROJECT_REF;
  if (
    !testProject ||
    database.protocol !== "https:" ||
    database.hostname !== `${testProject}.supabase.co`
  )
    return NextResponse.json(
      {
        message:
          "Configura el proyecto Supabase Cloud de desarrollo biométrico.",
      },
      { status: 503 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { message: "Solicitud inválida." },
      { status: 400 },
    );
  const session = await createClient();
  const { data } = await session.auth.getClaims();
  const user = data?.claims?.sub;
  const loginSession = data?.claims?.session_id;
  if (typeof user !== "string" || typeof loginSession !== "string")
    return NextResponse.json({ message: "Sesión requerida." }, { status: 401 });
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("user_profiles")
    .select("role,persona_id,is_active")
    .eq("user_id", user)
    .maybeSingle();
  if (!profile?.is_active || !["owner", "supervisor"].includes(profile.role))
    return NextResponse.json({ message: "Sin permiso." }, { status: 403 });
  if ((parsed.data.evaluation || parsed.data.operation === "reports") && profile.role !== "owner") return NextResponse.json({ message: "Evaluación reservada al Owner." }, { status: 403 });
  if (parsed.data.operation === "evidence" && parsed.data.mode === "enroll" && parsed.data.consent !== true) return NextResponse.json({ message: "Registra el consentimiento antes del enrolamiento." }, { status: 400 });
  if (parsed.data.operation === "reports") {
    const { data: rows, error } = await admin.from("biometric_evaluations").select("kind,lighting,device,cosine_score,pad_score,latency_ms,created_at,result").order("created_at", { ascending: false }).limit(1000);
    return error ? NextResponse.json({ message: "No se pudo cargar el reporte." }, { status: 503 }) : NextResponse.json({ rows });
  }
  if (profile.role !== "owner") {
    const { data: assigned } = await admin
      .from("tienda_supervisores")
      .select("id")
      .eq("tienda_id", parsed.data.storeId)
      .is("valid_to", null)
      .or(`persona_id.eq.${profile.persona_id},user_id.eq.${user}`);
    if (!assigned?.length)
      return NextResponse.json(
        { message: "Tienda no autorizada." },
        { status: 403 },
      );
  }
  const [promoters, supervisors] = await Promise.all([
    admin
      .from("tienda_promotores")
      .select("id")
      .eq("tienda_id", parsed.data.storeId)
      .eq("persona_id", parsed.data.personaId)
      .is("valid_to", null),
    admin
      .from("tienda_supervisores")
      .select("id")
      .eq("tienda_id", parsed.data.storeId)
      .eq("persona_id", parsed.data.personaId)
      .is("valid_to", null),
  ]);
  if (!promoters.data?.length && !supervisors.data?.length)
    return NextResponse.json(
      { message: "Colaborador no asignado." },
      { status: 403 },
    );
  const base = new URL(
    process.env.BIOMETRIC_SERVICE_URL ?? "http://127.0.0.1:8765",
  );
  if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
    return NextResponse.json(
      { message: "Servicio local requerido." },
      { status: 503 },
    );
  const token = process.env.BIOMETRIC_SERVICE_TOKEN;
  if (!token)
    return NextResponse.json(
      { message: "Servicio biométrico sin configurar." },
      { status: 503 },
    );
  const input = parsed.data;
  const bound = {
    user,
    person_id: input.personaId,
    store: input.storeId,
    login_session: loginSession,
  };
  if (input.operation === "confirm") {
    if (
      !input.grant ||
      input.latitude === undefined ||
      input.longitude === undefined ||
      input.accuracy === undefined
    )
      return NextResponse.json(
        { message: "Autorización y ubicación requeridas." },
        { status: 400 },
      );
    try {
      const checked = await fetch(new URL("/grants/inspect", base), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...bound, grant: input.grant }),
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
      if (!checked.ok)
        return NextResponse.json(
          { message: "Autorización biométrica inválida o vencida." },
          { status: 403 },
        );
      const verified = await checked.json();
      const { error: grantError } = await admin
        .from("biometric_grants")
        .upsert(
          {
            token_hash: verified.token_hash,
            user_id: user,
            persona_id: input.personaId,
            tienda_id: input.storeId,
            login_session: loginSession,
            expires_at: new Date(verified.expires_at * 1000).toISOString(),
          },
          { onConflict: "token_hash", ignoreDuplicates: true },
        );
      if (grantError)
        return NextResponse.json(
          { message: "No se pudo preparar la autorización." },
          { status: 503 },
        );
      const { data: eventId, error } = await admin.rpc(
        "consume_biometric_grant",
        {
          p_token_hash: verified.token_hash,
          p_user_id: user,
          p_persona_id: input.personaId,
          p_tienda_id: input.storeId,
          p_login_session: loginSession,
          p_latitude: input.latitude,
          p_longitude: input.longitude,
          p_accuracy: input.accuracy,
        },
      );
      return error
        ? NextResponse.json(
            {
              message:
                "La autorización ya fue usada, venció o la marcación no está permitida.",
            },
            { status: 409 },
          )
        : NextResponse.json({ eventId, registered: true });
    } catch {
      return NextResponse.json(
        { message: "No se pudo comprobar la autorización biométrica." },
        { status: 503 },
      );
    }
  }
  const path =
    input.operation === "start"
      ? "/sessions"
      : input.operation === "evidence"
        ? "/sessions/evidence"
        : input.operation === "status"
          ? `/experimental/status/${input.personaId}?evaluation=${Boolean(input.evaluation)}`
          : `/experimental/templates/${input.personaId}?evaluation=${Boolean(input.evaluation)}`;
  try {
    const response = await fetch(new URL(path, base), {
      method:
        input.operation === "status"
          ? "GET"
          : input.operation === "revoke"
            ? "DELETE"
            : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: ["start", "evidence"].includes(input.operation)
        ? JSON.stringify({
            ...bound,
            session_id: input.sessionId,
            images: input.images,
            mode: input.mode,
            evaluation: input.evaluation,
            kind: input.kind,
            lighting: input.lighting,
            device: input.device,
          })
        : undefined,
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    const result = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch {
    return NextResponse.json(
      { message: "Servicio biométrico no disponible." },
      { status: 503 },
    );
  }
}
