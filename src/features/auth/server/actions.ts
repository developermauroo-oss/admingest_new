"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { createHash } from "crypto";
import { encryptRegistrationPassword } from "./registration-crypto";
import { decryptRegistrationPassword } from "./registration-crypto";
import { requireRole } from "./authorization";
import { revalidatePath } from "next/cache";

export type LoginActionResult = {
  ok: boolean;
  message?: string;
  redirectTo?: string;
};
export type RegistrationRequestResult = { ok:boolean; message:string };

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6).max(200),
});
const registrationSchema=z.object({documentType:z.enum(["DNI","CE","PASSPORT"]),documento:z.string().trim().min(6).max(30),email:z.string().trim().email().max(160),password:z.string().min(12).max(200).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),confirm:z.string()}).refine(v=>v.password===v.confirm,{path:["confirm"]});
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");

export async function requestAuthorizedRegistration(input:unknown):Promise<RegistrationRequestResult>{
 const parsed=registrationSchema.safeParse(input); const generic={ok:true,message:"Si los datos cumplen las políticas, la solicitud quedó pendiente de verificación por un Owner."};
 if(!parsed.success) return {ok:false,message:"Revisa documento, correo y contraseña (12 caracteres, mayúscula, minúscula, número y símbolo)."};
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY, domain=process.env.REGISTRATION_ALLOWED_EMAIL_DOMAIN?.toLowerCase();
 if(!url||!serviceKey||!domain) return {ok:false,message:"El registro no está configurado. Contacta al administrador."};
 const email=parsed.data.email.toLowerCase(); if(!email.endsWith(`@${domain.replace(/^@/,"")}`)) return {ok:false,message:"No fue posible registrar la solicitud. Verifica los datos o contacta al administrador."};
 let ciphertext:string; try{ciphertext=encryptRegistrationPassword(parsed.data.password)}catch{return {ok:false,message:"El registro seguro no está configurado. Contacta al administrador."};}
 const h=await headers(); const source=hash(`${h.get("x-forwarded-for")??h.get("x-real-ip")??"unknown"}|${h.get("user-agent")??""}`); const identity=hash(`${parsed.data.documento}|${email}`);
 const admin=createAdminClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
 const since=new Date(Date.now()-15*60_000).toISOString(); const {count}=await admin.from("registration_request_attempts").select("id",{count:"exact",head:true}).or(`identity_hash.eq.${identity},source_hash.eq.${source}`).gte("created_at",since);
 if((count??0)>=8) return {ok:false,message:"Demasiados intentos. Espera unos minutos antes de volver a intentar."};
 await admin.from("registration_request_attempts").insert({identity_hash:identity,source_hash:source});
 const {data:person}=await admin.from("personas").select("id,email,is_active,puestos(nombre),access_authorizations(role,is_active,revoked_at)").eq("documento",parsed.data.documento).maybeSingle();
 const puesto=Array.isArray(person?.puestos)?person?.puestos[0]:person?.puestos; const auth=Array.isArray(person?.access_authorizations)?person?.access_authorizations[0]:person?.access_authorizations;
 if(!person||!person.is_active||String(person.email??"").toLowerCase()!==email||!puesto||!auth||!auth.is_active||auth.revoked_at||!['supervisor','zonal'].includes(String(auth.role).toLowerCase())||String(puesto.nombre).toLowerCase()!==String(auth.role).toLowerCase()) return {ok:false,message:"No fue posible registrar la solicitud. Verifica los datos o contacta al administrador."};
 const {data:linked}=await admin.from("user_profiles").select("user_id").eq("persona_id",person.id).maybeSingle(); if(linked) return {ok:false,message:"No fue posible registrar la solicitud. Verifica los datos o contacta al administrador."};
 await admin.from("registration_requests").update({status:"expired",password_ciphertext:"",decided_at:new Date().toISOString()}).eq("persona_id",person.id).eq("status","pending").lt("expires_at",new Date().toISOString());
 const {error}=await admin.from("registration_requests").insert({persona_id:person.id,email,password_ciphertext:ciphertext,source_hash:source});
 if(error){ console.error("[registration-request] insert failed",{code:error.code}); return {ok:false,message:"No se pudo guardar la solicitud. Intenta nuevamente o contacta al administrador."}; }
 return generic;
}

export async function approveRegistrationRequest(requestId:string):Promise<RegistrationRequestResult>{
 if(!z.string().uuid().safeParse(requestId).success)return {ok:false,message:"Solicitud inválida."};
 const {supabase,userId:ownerId}=await requireRole("owner"); const begun=await supabase.rpc("owner_begin_registration_approval",{p_request_id:requestId}); if(begun.error)return {ok:false,message:"La solicitud ya no puede aprobarse."};
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY; if(!url||!serviceKey)return {ok:false,message:"Falta la configuración segura del servidor."}; const admin=createAdminClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
 const {data:request}=await admin.from("registration_requests").select("persona_id,email,password_ciphertext,status,expires_at").eq("id",requestId).eq("status","processing").maybeSingle();
 const fail=async(code:string)=>{await admin.from("registration_requests").update({status:"failed",failure_code:code}).eq("id",requestId);return {ok:false,message:"No se pudo completar la aprobación. Puedes reintentar tras revisar la identidad."};};
 if(!request||new Date(request.expires_at)<=new Date())return fail("EXPIRED");
 const {data:person}=await admin.from("personas").select("id,email,is_active,puestos(nombre),access_authorizations(role,is_active,revoked_at)").eq("id",request.persona_id).maybeSingle(); const puesto=Array.isArray(person?.puestos)?person?.puestos[0]:person?.puestos;const authorization=Array.isArray(person?.access_authorizations)?person?.access_authorizations[0]:person?.access_authorizations;
 if(!person||!person.is_active||String(person.email??"").toLowerCase()!==request.email||!puesto||!authorization||!authorization.is_active||authorization.revoked_at||!['supervisor','zonal'].includes(String(authorization.role)))return fail("AUTHORIZATION_CHANGED");
 const {data:linked}=await admin.from("user_profiles").select("user_id").eq("persona_id",person.id).maybeSingle();if(linked)return fail("PERSON_ALREADY_LINKED");
 let password:string;try{password=decryptRegistrationPassword(request.password_ciphertext)}catch{return fail("SECRET_UNAVAILABLE")};
 const {data:created,error:createError}=await admin.auth.admin.createUser({email:request.email,password,email_confirm:true}); if(createError||!created.user)return fail("AUTH_CREATE_FAILED");
 const {error:profileError}=await admin.from("user_profiles").insert({user_id:created.user.id,persona_id:person.id,role:authorization.role,is_active:true,created_by:ownerId}); if(profileError)return fail("PROFILE_LINK_FAILED");
 await admin.from("registration_requests").update({status:"approved",auth_user_id:created.user.id,password_ciphertext:"",decided_at:new Date().toISOString(),decided_by:ownerId,failure_code:null}).eq("id",requestId); revalidatePath("/configuraciones/usuarios");return {ok:true,message:"Acceso aprobado y cuenta creada."};
}
export async function rejectRegistrationRequest(requestId:string):Promise<RegistrationRequestResult>{if(!z.string().uuid().safeParse(requestId).success)return {ok:false,message:"Solicitud inválida."};const {supabase}=await requireRole("owner");const {error}=await supabase.rpc("owner_reject_registration_request",{p_request_id:requestId});revalidatePath("/configuraciones/usuarios");return error?{ok:false,message:"No se pudo rechazar la solicitud."}:{ok:true,message:"Solicitud rechazada y secreto eliminado."};}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginActionResult> {
  // Password is intentionally scoped to this action and never logged, returned, or added to a URL.
  const parsed = loginSchema.safeParse({ email, password });

  if (!parsed.success) {
    return { ok: false, message: "Credenciales inválidas." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
  });

  if (error) {
    return { ok: false, message: "Correo o contraseña incorrectos." };
  }

  const { data: claims } = await supabase.auth.getClaims();
  const { data: profile } = await supabase.from("user_profiles").select("role,is_active").eq("user_id", claims?.claims?.sub ?? "").maybeSingle();
  return { ok: true, redirectTo: profile?.role === "owner" && profile.is_active ? "/administracion" : "/inicio" };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
