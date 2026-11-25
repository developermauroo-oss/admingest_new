import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.loadEnvFile('.env.local');
const children = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function up(url) { try { return (await fetch(url, {signal:AbortSignal.timeout(2000)})).ok; } catch { return false; } }
async function ready(url) { for(let i=0;i<60;i++){if(await up(url))return;await wait(1000);}throw new Error('Un servicio no inició dentro del tiempo esperado.'); }
function start(executable,args,cwd=root){const child=spawn(executable,args,{cwd,env:process.env,stdio:'inherit',windowsHide:true});children.push(child);child.on('error',()=>console.error('No se pudo iniciar un servicio local.'));}
try {
  const project=process.env.BIOMETRIC_TEST_SUPABASE_PROJECT_REF;
  if(!project || process.env.NEXT_PUBLIC_SUPABASE_URL!==`https://${project}.supabase.co`)throw new Error('El proyecto de desarrollo no coincide.');
  for(const name of ['SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','BIOMETRIC_SERVICE_TOKEN','BIOMETRIC_ENCRYPTION_KEY'])if(!process.env[name])throw new Error(`Falta ${name}.`);
  if(Buffer.from(process.env.BIOMETRIC_ENCRYPTION_KEY,'base64').length!==32)throw new Error('La clave biométrica debe tener 32 bytes.');
  const manifest=JSON.parse(readFileSync('biometric-service/models.json','utf8'));
  for(const [file,metadata] of Object.entries(manifest)){const target=path.join('biometric-service/models',file);if(!existsSync(target)||createHash('sha256').update(readFileSync(target)).digest('hex')!==metadata.sha256)throw new Error(`Modelo ausente o modificado: ${file}`);}
  const response=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/app_sql_versions?select=version&version=eq.38`,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok || !(await response.json()).length)throw new Error('No se pudo verificar la migración Cloud 038.');
  const python=path.join(root,'biometric-service/.venv/Scripts/python.exe');
  if(!existsSync(python))throw new Error('Instala las dependencias Python en biometric-service/.venv.');
  if(!await up('http://127.0.0.1:8765/health'))start(python,['run.py'],path.join(root,'biometric-service'));
  await ready('http://127.0.0.1:8765/health');
  if(!await up('http://localhost:3000/login'))start(process.execPath,['node_modules/next/dist/bin/next',existsSync('.next/BUILD_ID')?'start':'dev','--port','3000']);
  await ready('http://localhost:3000/login');
  console.log('AdminGes listo: http://localhost:3000/personal/biometria (Owner).');
  if(process.platform==='win32'&&!process.argv.includes('--no-open'))spawn('cmd.exe',['/c','start','', 'http://localhost:3000/personal/biometria'],{windowsHide:true});
} catch(error){console.error(error.message);children.forEach(child=>child.kill());process.exitCode=1;}
process.on('SIGINT',()=>{children.forEach(child=>child.kill());process.exit();});
