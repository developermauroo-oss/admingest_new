"use server";

import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const documentSchema = z.object({
  documentType: z.enum(["dni", "ce", "pasaporte"]),
  document: z.string().trim().min(6).max(20).regex(/^[A-Za-z0-9-]+$/),
});
const faceSampleSchema = z.object({
  descriptor: z.array(z.number().finite()).min(64).max(2048),
  qualityScore: z.number().min(0).max(100),
  antiSpoofScore: z.number().min(0).max(100).nullable(),
  livenessScore: z.number().min(0).max(100).nullable(),
});
// Legacy client-supplied embeddings and liveness scores are not trusted.
function legacyFaceDisabled(): boolean { return true; }

type Schedule = { detailId: string; kind: string; start: string | null; end: string | null; hasBreak: boolean; hours: number };
type Actor = { admin: ReturnType<typeof createAdminClient>; userId: string; profile: { persona_id: string; role: string } };

function limaDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const date = new Date(`${part("year")}-${part("month")}-${part("day")}T12:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function monday(date: string) {
  const result = new Date(`${date}T12:00:00`);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result.toISOString().slice(0, 10);
}

function similarityPercent(first: number[], second: number[]) {
  if (first.length !== second.length) return 0;
  let dot = 0; let firstNorm = 0; let secondNorm = 0;
  for (let index = 0; index < first.length; index += 1) { dot += first[index] * second[index]; firstNorm += first[index] ** 2; secondNorm += second[index] ** 2; }
  return firstNorm && secondNorm ? Math.max(0, Math.min(100, (dot / Math.sqrt(firstNorm * secondNorm)) * 100)) : 0;
}

function limaMinutesNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

function timeMinutes(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }

async function currentActor(): Promise<Actor | null> {
  const session = await createClient();
  const { data } = await session.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") return null;
  const admin = createAdminClient();
  const { data: profile } = await admin.from("user_profiles").select("persona_id,role,is_active").eq("user_id", userId).maybeSingle();
  if (!profile?.is_active || !["owner", "supervisor"].includes(profile.role)) return null;
  return { admin, userId, profile };
}

async function employeeStoreIds(admin: ReturnType<typeof createAdminClient>, personaId: string, actor: Actor) {
  const [asSupervisor, asPromoter] = await Promise.all([
    admin.from("tienda_supervisores").select("tienda_id").eq("persona_id", personaId).is("valid_to", null),
    admin.from("tienda_promotores").select("tienda_id").eq("persona_id", personaId).is("valid_to", null),
  ]);
  const employeeStores = new Set([...(asSupervisor.data ?? []).map((row) => row.tienda_id), ...(asPromoter.data ?? []).map((row) => row.tienda_id)]);
  if (actor.profile.role === "owner") return [...employeeStores];
  const { data: managed } = await admin.from("tienda_supervisores").select("tienda_id").is("valid_to", null).or(`persona_id.eq.${actor.profile.persona_id},user_id.eq.${actor.userId}`);
  const allowed = new Set((managed ?? []).map((row) => row.tienda_id));
  return [...employeeStores].filter((storeId) => allowed.has(storeId));
}

async function scheduleForStore(admin: ReturnType<typeof createAdminClient>, storeId: string, personaId: string): Promise<Schedule | null> {
  const today = limaDate();
  const { data: week } = await admin.from("horarios_semanales").select("id").eq("tienda_id", storeId).eq("semana_inicio", monday(today)).maybeSingle();
  if (!week) return null;
  const { data } = await admin.from("horarios_semanales_detalles").select("id,tipo,hora_ingreso,hora_salida,tiene_descanso,horas_programadas").eq("horario_id", week.id).eq("persona_id", personaId).eq("fecha", today).maybeSingle();
  if (!data) return null;
  return { detailId: data.id, kind: data.tipo, start: data.hora_ingreso?.slice(0, 5) ?? null, end: data.hora_salida?.slice(0, 5) ?? null, hasBreak: data.tiene_descanso, hours: Number(data.horas_programadas) };
}

async function nextEventForToday(admin: ReturnType<typeof createAdminClient>, personaId: string, storeId: string) {
  const today = limaDate();
  const tomorrow = limaDate(1);
  const { data } = await admin.from("attendance_events").select("event_type,occurred_at,stay_minutes").eq("persona_id", personaId).eq("tienda_id", storeId).gte("occurred_at", `${today}T00:00:00-05:00`).lt("occurred_at", `${tomorrow}T00:00:00-05:00`).order("occurred_at", { ascending: false }).limit(10);
  const last = data?.[0]; const nextType = ["entrada", "fin_refrigerio"].includes(last?.event_type ?? "") ? "salida" : "entrada";
  const entries = (data ?? []).filter((event) => ["entrada", "fin_refrigerio"].includes(event.event_type)).length;
  const exits = (data ?? []).filter((event) => ["salida", "inicio_refrigerio"].includes(event.event_type)).length;
  const blocked = nextType === "entrada" ? entries >= 3 : exits >= 3;
  return { type: nextType, blocked, reason: blocked ? "Se alcanzó el máximo diario de tres ingresos y tres salidas. Requiere autorización manual." : null, lastAt: last?.occurred_at ?? null, lastStayMinutes: last?.stay_minutes ?? null };
}

export async function lookupAttendanceEmployee(input: unknown) {
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Ingresa un documento válido." };
  const actor = await currentActor();
  if (!actor) return { ok: false as const, message: "Tu sesión no tiene permiso para usar el marcador." };
  const { data: employee } = await actor.admin.from("personas").select("id,nombres,apellidos,documento,is_active,puestos(nombre)").eq("documento", parsed.data.document).eq("is_active", true).maybeSingle();
  if (!employee) return { ok: false as const, message: "No se encontró un colaborador activo con ese documento." };
  const storeIds = await employeeStoreIds(actor.admin, employee.id, actor);
  if (!storeIds.length) return { ok: false as const, message: "El colaborador no pertenece a una tienda a la que tengas acceso." };
  const { data: stores } = await actor.admin.from("tiendas").select("id,nombre").in("id", storeIds).eq("is_active", true).order("nombre");
  const { data: biometric } = await actor.admin.from("face_biometric_templates").select("id").eq("persona_id", employee.id).is("revoked_at", null).maybeSingle();
  const rows = await Promise.all((stores ?? []).map(async (store) => ({ id: store.id, name: store.nombre, schedule: await scheduleForStore(actor.admin, store.id, employee.id), next: await nextEventForToday(actor.admin, employee.id, store.id) })));
  const positionSource = employee.puestos as unknown as { nombre?: string } | Array<{ nombre?: string }> | null;
  const position = Array.isArray(positionSource) ? positionSource[0]?.nombre : positionSource?.nombre;
  return { ok: true as const, employee: {
    id: employee.id, name: `${employee.nombres} ${employee.apellidos}`.replace(/\s+/g, " ").trim(),
    position: position ?? "Sin cargo",
    maskedDocument: `${employee.documento.slice(0, 2)}****${employee.documento.slice(-2)}`,
    weekday: new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", weekday: "long", day: "numeric", month: "long" }).format(new Date()),
    stores: rows, hasFaceTemplate: Boolean(biometric),
  } };
}

export async function beginAttendanceAttempt(input: unknown) {
  const parsed = z.object({ personaId: z.string().uuid(), storeId: z.string().uuid(), idempotencyKey: z.string().uuid(), latitude: z.number().finite(), longitude: z.number().finite(), accuracy: z.number().positive() }).safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Datos de ubicación inválidos." };
  if (parsed.data.accuracy > 100) return { ok: false as const, message: "La ubicación es imprecisa. Acércate a la tienda e inténtalo otra vez." };
  const actor = await currentActor();
  if (!actor) return { ok: false as const, message: "La sesión expiró o no tiene permiso." };
  const permittedStores = await employeeStoreIds(actor.admin, parsed.data.personaId, actor);
  if (!permittedStores.includes(parsed.data.storeId)) return { ok: false as const, message: "No tienes acceso a este colaborador o tienda." };
  const [schedule, next] = await Promise.all([scheduleForStore(actor.admin, parsed.data.storeId, parsed.data.personaId), nextEventForToday(actor.admin, parsed.data.personaId, parsed.data.storeId)]);
  if (!schedule || !schedule.start || !schedule.end) return { ok: false as const, message: "No hay un turno laborable programado para este colaborador hoy." };
  const { data: attempt, error } = await actor.admin.from("attendance_attempts").insert({ user_id: actor.userId, persona_id: parsed.data.personaId, tienda_id: parsed.data.storeId, idempotency_key: parsed.data.idempotencyKey, latitude: parsed.data.latitude, longitude: parsed.data.longitude, accuracy_meters: parsed.data.accuracy, status: "pending", face_status: "pending" }).select("id").single();
  if (error || !attempt) return { ok: false as const, message: "No se pudo preparar la validación de asistencia." };
  return { ok: true as const, attempt: { id: attempt.id, nextEvent: next.type, schedule } };
}

export async function enrollAttendanceFace(input: unknown) {
  if (legacyFaceDisabled()) return { ok: false as const, message: "El enrolamiento anterior está desactivado durante la migración biométrica." };
  const parsed = z.object({ personaId: z.string().uuid(), sample: faceSampleSchema, consent: z.literal(true) }).safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "No se recibió una muestra facial válida o falta el consentimiento." };
  const actor = await currentActor();
  if (!actor) return { ok: false as const, message: "La sesión expiró o no tiene permiso." };
  if (!(await employeeStoreIds(actor.admin, parsed.data.personaId, actor)).length) return { ok: false as const, message: "No tienes acceso a este colaborador." };
  const { sample } = parsed.data;
  if (sample.qualityScore < 75 || sample.antiSpoofScore === null || sample.antiSpoofScore < 70 || sample.livenessScore === null || sample.livenessScore < 70) return { ok: false as const, message: "La captura no supera los controles de calidad, rostro real y vitalidad. Toma otra foto con buena iluminación." };
  const { error } = await actor.admin.from("face_biometric_templates").upsert({
    persona_id: parsed.data.personaId, engine: "@vladmandic/human", engine_version: "3.3.6", descriptor: sample.descriptor,
    quality_score: sample.qualityScore, anti_spoof_score: sample.antiSpoofScore, liveness_score: sample.livenessScore,
    consented_at: new Date().toISOString(), consented_by: actor.userId, revoked_at: null, revoked_by: null, updated_at: new Date().toISOString(),
  }, { onConflict: "persona_id" });
  return error ? { ok: false as const, message: "No se pudo guardar la plantilla biométrica." } : { ok: true as const, message: "Rostro registrado. Toma una nueva foto para validar la marcación." };
}

export async function previewAttendanceFace(input: unknown) {
  if (legacyFaceDisabled()) return { ok: false as const, message: "La verificación anterior está desactivada durante la migración biométrica." };
  const parsed = z.object({ personaId: z.string().uuid(), sample: faceSampleSchema }).safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Muestra facial inválida." };
  const actor = await currentActor();
  if (!actor || !(await employeeStoreIds(actor.admin, parsed.data.personaId, actor)).length) return { ok: false as const, message: "Sin autorización para este colaborador." };
  const { data } = await actor.admin.from("face_biometric_templates").select("descriptor").eq("persona_id", parsed.data.personaId).is("revoked_at", null).maybeSingle();
  if (!data) return { ok: false as const, message: "No hay rostro registrado." };
  const similarity = similarityPercent(data.descriptor as unknown as number[], parsed.data.sample.descriptor);
  const sample = parsed.data.sample;
  const passed = similarity >= Math.max(90, Number(process.env.ATTENDANCE_FACE_MATCH_THRESHOLD) || 90) && sample.qualityScore >= 75 && (sample.antiSpoofScore ?? 0) >= 70 && (sample.livenessScore ?? 0) >= 70;
  return { ok: true as const, similarity, passed };
}

export async function confirmAttendanceFace(input: unknown) {
  if (legacyFaceDisabled()) return { ok: false as const, message: "La marcación facial está desactivada hasta validar el nuevo servicio biométrico." };
  const parsed = z.object({ attemptId: z.string().uuid(), sample: faceSampleSchema }).safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "La muestra facial no es válida." };
  const actor = await currentActor();
  if (!actor) return { ok: false as const, message: "La sesión expiró o no tiene permiso." };
  const { data: attempt } = await actor.admin.from("attendance_attempts").select("id,user_id,persona_id,tienda_id,idempotency_key,status").eq("id", parsed.data.attemptId).eq("user_id", actor.userId).maybeSingle();
  if (!attempt || attempt.status !== "pending" || !attempt.persona_id) return { ok: false as const, message: "El intento ya no es válido. Inicia una nueva marcación." };
  const { data: template } = await actor.admin.from("face_biometric_templates").select("descriptor").eq("persona_id", attempt.persona_id).is("revoked_at", null).maybeSingle();
  if (!template) return { ok: false as const, message: "El colaborador aún no tiene un rostro registrado." };
  const { sample } = parsed.data;
  const similarity = similarityPercent(template.descriptor as unknown as number[], sample.descriptor);
  const threshold = Math.max(90, Number(process.env.ATTENDANCE_FACE_MATCH_THRESHOLD) || 90);
  if (sample.qualityScore < 75 || sample.antiSpoofScore === null || sample.antiSpoofScore < 70 || sample.livenessScore === null || sample.livenessScore < 70 || similarity < threshold) {
    await actor.admin.from("attendance_attempts").update({ status: "rejected", face_status: "rejected", face_match_percent: similarity }).eq("id", attempt.id);
    return { ok: false as const, message: `No se validó el rostro (${similarity.toFixed(1)}%). Vuelve a intentarlo con buena luz y mirando a la cámara.` };
  }
  const schedule = await scheduleForStore(actor.admin, attempt.tienda_id, attempt.persona_id);
  if (!schedule?.start || !schedule.end) return { ok: false as const, message: "El turno ya no está disponible para esta marcación." };
  const today = limaDate(); const tomorrow = limaDate(1);
  const { data: events } = await actor.admin.from("attendance_events").select("id,event_type,occurred_at").eq("persona_id", attempt.persona_id).eq("tienda_id", attempt.tienda_id).gte("occurred_at", `${today}T00:00:00-05:00`).lt("occurred_at", `${tomorrow}T00:00:00-05:00`).order("occurred_at", { ascending: false }).limit(10);
  const previous = events?.[0]; const returningFromBreak = previous?.event_type === "salida" || previous?.event_type === "inicio_refrigerio"; const eventType = !previous ? "entrada" : returningFromBreak ? "fin_refrigerio" : "salida";
  const entries = (events ?? []).filter((event) => ["entrada", "fin_refrigerio"].includes(event.event_type)).length;
  const exits = (events ?? []).filter((event) => ["salida", "inicio_refrigerio"].includes(event.event_type)).length;
  if ((eventType === "entrada" || eventType === "fin_refrigerio") ? entries >= 3 : exits >= 3) return { ok: false as const, message: "Se alcanzó el máximo diario de tres ingresos y tres salidas. Solicita autorización manual para registrar otro evento." };
  const { data: store } = await actor.admin.from("tiendas").select("nombre").eq("id", attempt.tienda_id).maybeSingle();
  const lateMinutes = eventType === "entrada" ? Math.max(0, limaMinutesNow() - timeMinutes(schedule.start)) : null;
  const stayMinutes = eventType === "salida" && previous ? Math.max(0, Math.round((Date.now() - new Date(previous.occurred_at).getTime()) / 60_000)) : null;
  const { error: eventError } = await actor.admin.from("attendance_events").insert({
    user_id: actor.userId, persona_id: attempt.persona_id, tienda_id: attempt.tienda_id, horario_detalle_id: schedule.detailId,
    occurred_at: new Date().toISOString(), event_type: eventType, status: "confirmed", idempotency_key: attempt.idempotency_key,
    store_name: store?.nombre ?? "Tienda", scheduled_start: schedule.start, scheduled_end: schedule.end, scheduled_type: schedule.kind,
    punctuality_status: eventType === "entrada" ? (lateMinutes ? "late" : "on_time") : "not_scheduled", late_minutes: lateMinutes, stay_minutes: stayMinutes,
    face_status: "verified", face_match_percent: similarity,
  });
  if (eventError) return { ok: false as const, message: "No se pudo confirmar la marcación." };
  if (eventType === "fin_refrigerio" && previous?.event_type === "salida") await actor.admin.from("attendance_events").update({ event_type: "inicio_refrigerio" }).eq("id", previous.id);
  if (eventType === "salida" && previous) await actor.admin.from("attendance_events").update({ stay_minutes: stayMinutes }).eq("id", previous.id);
  await actor.admin.from("attendance_attempts").update({ status: "completed", face_status: "verified", face_match_percent: similarity }).eq("id", attempt.id);
  return { ok: true as const, event: { type: eventType, similarity, lateMinutes, stayMinutes } };
}
