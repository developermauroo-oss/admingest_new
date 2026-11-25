# Biometría AdminGes: entorno de evaluación

Estado comprobado al 25/11/2026. Next.js y FastAPI funcionan directamente en Windows con Supabase Cloud de desarrollo `luazeuykhymxikhrgakf`, confirmado por el usuario. Sin Docker, Supabase local, servicios contratados ni despliegue. La asistencia biométrica operativa permanece bloqueada hasta validar PAD y calibración.

## Abrir y comenzar ensayos

- Aplicación: http://localhost:3000
- Panel restringido al Owner: http://localhost:3000/personal/biometria (Personal → Evaluación biométrica).
- FastAPI: http://127.0.0.1:8765/health.

Los servicios quedaron iniciados. Para volver a iniciarlos desde la raíz del repositorio:

```powershell
npm run biometric:start
```

El comando verifica variables sin mostrarlas, integridad SHA-256 de YuNet/SFace, conexión con Cloud y migración 038, inicia los servicios que falten, espera disponibilidad y abre el panel. Usa la configuración privada existente de `.env.local`. Las dependencias Python ya están instaladas en `biometric-service/.venv`; los modelos están en `biometric-service/models`. La configuración privada y los modelos no se versionan.

En el panel: seleccionar participante/tienda, tipo de ensayo, iluminación y dispositivo; abrir Biometría facial, elegir registro y marcar consentimiento; capturar tres muestras. Después elegir verificación para comparar con la plantilla de evaluación. Los ensayos se guardan en Cloud con puntuación técnica, PAD si existe, latencia, CPU de proceso y working set de Windows; no guardan fotografías. Las plantillas de evaluación tienen un modelo con sufijo `:evaluation`, independiente de las operativas. Ningún ensayo emite autorizaciones de asistencia.

El reporte permite evaluar un umbral coseno y PAD, visualizar FAR/FRR/APCER/BPCER observados y exportar JSON. FAR/FRR incluyen las verificaciones con fallo de captura como rechazo, sin mezclar enrolamientos; las métricas PAD requieren puntuaciones PAD válidas. Si no hay muestras se indica explícitamente. Las tasas observadas no garantizan precisión poblacional. Se muestra la escala prevista 80/90/95, pero no se convierte coseno a un porcentaje de confianza. La revocación de evaluación elimina únicamente su plantilla y ensayos del participante; no afecta el historial de asistencia ni las plantillas Human.

## Implementado y comprobado

- SFace/YuNet ONNX con OpenCV; comprobación de hashes fijados en `biometric-service/models.json`, carga cacheada y serialización de inferencia.
- Extracción exclusiva en servidor, controles preliminares de un rostro, distancia/tamaño, iluminación, nitidez y consistencia entre muestras.
- AES-256-GCM con contexto persona/modelo e identificador de clave. `BIOMETRIC_KEYRING_JSON` y `BIOMETRIC_ACTIVE_KEY_ID` permiten rotar conservando lectura de claves anteriores. `/maintenance/rotate` vuelve a cifrar plantillas Cloud y audita la operación; requiere token interno de servicio.
- Almacenamiento operativo y de evaluación en Cloud (`BIOMETRIC_STORAGE=cloud`): plantillas, consentimiento, sesiones, desafíos, intentos, hashes, autorizaciones y auditoría. SQLite solo es backend de pruebas aisladas; sus archivos históricos no se eliminan.
- Retención automática al iniciar FastAPI y cada hora mientras funcione. Elimina plantillas vencidas, hashes de más de 24 horas y ensayos fuera de la política. `BIOMETRIC_RETENTION_DAYS` predeterminado 365. La auditoría contiene acción, actor/persona cuando corresponde y fecha, sin capturas ni vectores.
- Revocación: RPC Cloud transaccional invalida sesiones y autorizaciones pendientes y elimina las nuevas plantillas; no toca Human ni asistencia histórica.
- Sesiones vinculadas a usuario/persona/tienda/login, desafío aleatorio, expiración de 120 s, tres intentos atómicos y límite persistente por usuario/persona/tienda. Cambiar login no reinicia la ventana de intentos. Hashes impiden reutilizar exactamente una captura; esto no sustituye PAD.
- Next autentica con Supabase, comprueba rol y asignaciones y llama al servicio solo por loopback con token privado. Rechaza un proyecto Cloud distinto del configurado como desarrollo. El panel y reportes son exclusivos del Owner.
- Marcador conserva la ruta pública y utiliza un solo capturador SFace con modal compacto, vídeo y guía ovalada. Tras una autorización válida muestra ficha y botón de confirmación. El servicio inspecciona firma/vinculación/vencimiento; el backend consume el hash mediante RPC. La interfaz no acepta puntuaciones del navegador como evidencia.
- Migraciones locales 037–039 aplicadas y verificadas en desarrollo. RLS habilitado y acceso a nuevas tablas/RPC restringido a service_role. La transacción SQL incluye permiso, persona/tienda activos y asignados, horario laborable, secuencia, refrigerio, máximo tres ingresos/tres salidas, tardanza, estadía, ubicación, consumo único y auditoría. Los retornos identifican el break real.
- Human retirado del bundle y de dependencias; las antiguas acciones de aceptación permanecen bloqueadas y sus registros Cloud se conservan.

## Pruebas y evidencias

- 9 pruebas Python aprobadas: autenticación, cifrado, rotación, retención, revocación, vinculación, expiración, firmas/manipulación, concurrencia, consumo único y métricas empíricas. Las pruebas que sustituyen extracción son de lógica, no de precisión biométrica.
- 3 pruebas Playwright con Chrome headless aprobadas: acceso anónimo rechazado; sesión real de supervisor, búsqueda y capturador, firma falsa rechazada y límite de intentos; sesión real de Owner con panel móvil y consentimiento obligatorio para enrolar. La rama visual de aceptación/confirmación usa interceptación exclusivamente dentro de Playwright: la autorización simulada nunca se envía a FastAPI ni Cloud.
- `sql/tests/037_grants_rollback.sql` aprobó la transacción en Cloud: vinculación incorrecta rechazada, evento/consumo en conjunto y rechazo del segundo uso. El horario de prueba y todos los cambios se revierten con rollback; no queda asistencia simulada almacenada.
- Versiones 037, 038 y 039 presentes; RLS y permisos comprobados mediante consultas Cloud. Comprobada ejecución automática de retención en auditoría.
- Typecheck/build correctos. Lint sin errores; permanece una advertencia previa de Inventario/TanStack ajena a esta migración. No se modificó Inventario.
- Capturas de prueba en `test-results/` (ignoradas por Git) muestran el modal y el panel móvil; la cámara ficticia está solo en Playwright. No hay capturas de empleados reales en esos artefactos.

Para repetir:

```powershell
biometric-service/.venv/Scripts/python -m pytest biometric-service -q
npm run test:biometric
npm run lint
npm run typecheck
npm run build
```

Detener Next antes de compilar para evitar compartir `.next` entre dev y build. Reiniciar con el comando único después del build. Las pruebas de sesión usan enlaces temporales generados por el administrador de Supabase sin enviar correos ni imprimir credenciales. No ejecutar sobre producción.

## Implementado sin validación humana

Los controles de calidad y continuidad y el desafío centro/giro/centro mediante puntos YuNet son heurísticos. No se les atribuye eficacia anti-spoofing. `antispoof.py` implementa inferencia MiniFASNet ONNX, exige manifiesto de licencia de pesos e integridad y no se activa por defecto. La emisión de autorizaciones está conectada, pero requiere prueba de vida aprobada, plantilla operativa confiable y una política evaluada con personas autorizadas (`BIOMETRIC_VALIDATED_POLICY`). El panel de evaluación jamás establece confianza operativa.

No hay un recorrido real de aceptación biométrica hasta asistencia: falta evidencia humana/PAD aprobada. El flujo de interfaz aceptada se probó aislado y el registro SQL con rollback, no se presentan como precisión biométrica.

## Bloqueos externos y activación de producción

1. Pesos PAD con licencia específica y procedencia verificadas. La licencia del código MiniFASNet upstream es Apache 2.0, pero no se ha aprobado un artefacto de pesos ni su eficacia para esta aplicación. No se descargaron ni habilitaron pesos restringidos.
2. Personas autorizadas y ensayos genuinos/impostores, lentes, dispositivos, iluminación y ataques impresos/pantallas/vídeos. No hay FAR/FRR/APCER/BPCER poblacionales ni promesa de 99 % o menos de 2 s demostrada.
3. Revisión de las curvas y umbrales obtenidos antes de aprobar la política operativa y cualquier escala calibrada. No activar mediante booleans de configuración sin evidencia y revisión.

SFace OpenCV Zoo publica Apache 2.0 y YuNet MIT: https://github.com/opencv/opencv_zoo/tree/main/models . Los hashes exactos están fijados localmente. InsightFace queda desactivado por las restricciones de sus pesos públicos. MiniFASNet: https://github.com/minivision-ai/Silent-Face-Anti-Spoofing . Las licencias de código no sustituyen la aprobación de pesos ni las pruebas de ataques.

Los costes contratados son cero. Se utiliza la computadora y el proyecto Cloud de desarrollo existentes; consumo, capacidad, tarifas futuras y operación permanente deben medirse antes de desplegar. No se hizo despliegue. Antes de producción revisar TLS, acceso privado al servicio, secretos, copias de seguridad, política de consentimiento/retención y evaluación real. Conservar SQL 037–039 para una futura migración autorizada. Rollback: desactivar la ruta biométrica y volver a la versión anterior del código sin borrar historial ni Human; no habilitar el motor antiguo como evasión.
