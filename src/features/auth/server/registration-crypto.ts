import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function key() { const raw=process.env.REGISTRATION_PASSWORD_ENCRYPTION_KEY; if (!raw) throw new Error("REGISTRATION_ENCRYPTION_KEY_MISSING"); const value=Buffer.from(raw,"base64"); if(value.length!==32) throw new Error("REGISTRATION_ENCRYPTION_KEY_INVALID"); return value; }
export function encryptRegistrationPassword(password:string) { const iv=randomBytes(12); const cipher=createCipheriv("aes-256-gcm",key(),iv); const body=Buffer.concat([cipher.update(password,"utf8"),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),body]).toString("base64"); }
export function decryptRegistrationPassword(payload:string) { const raw=Buffer.from(payload,"base64"); if(raw.length<29) throw new Error("REGISTRATION_SECRET_INVALID"); const decipher=createDecipheriv("aes-256-gcm",key(),raw.subarray(0,12)); decipher.setAuthTag(raw.subarray(12,28)); return Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString("utf8"); }
