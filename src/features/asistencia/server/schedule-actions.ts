"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const entrySchema = z.object({ personaId: z.string().uuid(), date: z.string().date(), kind: z.enum(["A","C","AC","D","P","VAC","LIC"]), start: z.string().regex(/^\d{2}:\d{2}$/).nullable(), end: z.string().regex(/^\d{2}:\d{2}$/).nullable(), hasBreak: z.boolean(), hours: z.number().min(0).max(12) });
const scheduleSchema = z.object({ storeId: z.string().uuid(), weekStart: z.string().date(), hasCapa: z.boolean(), entries: z.array(entrySchema) });

export async function saveWeeklySchedule(input: unknown) {
 const parsed = scheduleSchema.safeParse(input); if (!parsed.success) return { ok:false, message:"Datos de horario inválidos." };
 const session = await createClient(); const { data } = await session.auth.getClaims(); const userId = data?.claims?.sub;
 if (typeof userId !== "string") return { ok:false, message:"La sesión expiró." };
 const admin = createAdminClient();
 const { data: profile } = await admin.from("user_profiles").select("persona_id,role,is_active").eq("user_id",userId).maybeSingle();
 if (!profile?.is_active || !["owner","supervisor"].includes(profile.role)) return { ok:false, message:"No tienes permiso para crear horarios." };
 if (profile.role === "supervisor") { const { data: assignment } = await admin.from("tienda_supervisores").select("id").eq("tienda_id",parsed.data.storeId).is("valid_to",null).or(`persona_id.eq.${profile.persona_id},user_id.eq.${userId}`).maybeSingle(); if (!assignment) return {ok:false,message:"No tienes acceso a esta tienda."}; }
 const monday = new Date(`${parsed.data.weekStart}T12:00:00`).getDay() === 1; if (!monday) return {ok:false,message:"La semana debe comenzar en lunes."};
 const byPerson = new Map<string, typeof parsed.data.entries>(); for (const item of parsed.data.entries) byPerson.set(item.personaId,[...(byPerson.get(item.personaId)??[]),item]);
 for (const [personId, rows] of byPerson) { const onLeave=rows.every((row)=>row.kind==="VAC" || row.kind==="LIC"); const rest=rows.filter((row)=>row.kind==="D").length, ac=rows.filter((row)=>row.kind==="AC").length, storeHours=rows.reduce((sum,row)=>sum+row.hours,0); if (!onLeave && (rest>1 || ac>1 || storeHours !== (parsed.data.hasCapa?46:48))) return {ok:false,message:`El horario de ${personId} no cumple las horas o límites semanales.`}; }
 const { data: schedule, error } = await admin.from("horarios_semanales").upsert({tienda_id:parsed.data.storeId,semana_inicio:parsed.data.weekStart,tiene_capa:parsed.data.hasCapa,created_by:userId,updated_at:new Date().toISOString()},{onConflict:"tienda_id,semana_inicio"}).select("id").single();
 if (error || !schedule) return {ok:false,message:"No se pudo guardar el horario."};
 await admin.from("horarios_semanales_detalles").delete().eq("horario_id",schedule.id);
 const { error: detailError } = await admin.from("horarios_semanales_detalles").insert(parsed.data.entries.map((row)=>({horario_id:schedule.id,persona_id:row.personaId,fecha:row.date,tipo:row.kind,hora_ingreso:row.start,hora_salida:row.end,tiene_descanso:row.hasBreak,horas_programadas:row.hours})));
 if (detailError) return {ok:false,message:"El horario principal se guardó, pero fallaron sus detalles."};
 revalidatePath("/asistencia/horario"); return {ok:true,message:"Horario guardado."};
}

export async function loadWeeklySchedule(input: { storeId: string; weekStart: string }) {
 const parsed=z.object({storeId:z.string().uuid(),weekStart:z.string().date()}).safeParse(input); if(!parsed.success) return {ok:false as const};
 const session=await createClient(); const {data}=await session.auth.getClaims(); const userId=data?.claims?.sub; if(typeof userId!=="string") return {ok:false as const};
 const admin=createAdminClient(); const {data: profile}=await admin.from("user_profiles").select("persona_id,role,is_active").eq("user_id",userId).maybeSingle(); if(!profile?.is_active || !["owner","supervisor"].includes(profile.role)) return {ok:false as const};
 if(profile.role==="supervisor"){const {data: assigned}=await admin.from("tienda_supervisores").select("id").eq("tienda_id",parsed.data.storeId).is("valid_to",null).or(`persona_id.eq.${profile.persona_id},user_id.eq.${userId}`).maybeSingle(); if(!assigned)return {ok:false as const};}
 const {data: schedule}=await admin.from("horarios_semanales").select("id,tiene_capa").eq("tienda_id",parsed.data.storeId).eq("semana_inicio",parsed.data.weekStart).maybeSingle(); if(!schedule)return {ok:true as const, schedule:null};
 const {data: details}=await admin.from("horarios_semanales_detalles").select("persona_id,fecha,tipo,hora_ingreso,hora_salida,tiene_descanso").eq("horario_id",schedule.id);
 return {ok:true as const,schedule:{hasCapa:schedule.tiene_capa,entries:(details??[]).map(row=>({personaId:row.persona_id,date:row.fecha,kind:row.tipo,start:row.hora_ingreso?.slice(0,5),end:row.hora_salida?.slice(0,5),hasBreak:row.tiene_descanso}))}};
}
