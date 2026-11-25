import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

test("anonymous navigation and direct API cannot confirm attendance", async ({ page }) => {
  await page.goto("/asistencia");
  await expect(page).toHaveURL(/\/login/);
  const response = await page.request.post("/api/asistencia/biometria", { data: { operation: "confirm" }, maxRedirects: 0 });
  expect([307,401]).toContain(response.status());
});

test("authenticated lookup opens original-style capture; forged grants are rejected", async ({ page, context }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  expect(new URL(url).hostname).toBe(`${process.env.BIOMETRIC_TEST_SUPABASE_PROJECT_REF}.supabase.co`);
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: profiles, error } = await admin.from("user_profiles").select("user_id,persona_id").eq("role", "supervisor").eq("is_active", true);
  if (error) throw new Error("Cannot load development profiles");
  let selected: { user: string; person: string; store: string; document: string } | undefined;
  for (const profile of profiles ?? []) {
    const { data: assignment } = await admin.from("tienda_supervisores").select("tienda_id").is("valid_to", null).or(`persona_id.eq.${profile.persona_id},user_id.eq.${profile.user_id}`).limit(1).maybeSingle();
    const { data: person } = await admin.from("personas").select("documento").eq("id", profile.persona_id).maybeSingle();
    if (assignment && person?.documento) { selected = { user: profile.user_id, person: profile.persona_id, store: assignment.tienda_id, document: person.documento }; break; }
  }
  if (!selected) throw new Error("No eligible development supervisor fixture");
  const { data: account } = await admin.auth.admin.getUserById(selected.user);
  if (!account.user?.email) throw new Error("Development account missing email");
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: account.user.email });
  if (linkError || !link.properties?.hashed_token) throw new Error("Cannot create development test session");
  const auth = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => [], setAll: async cookies => { await context.addCookies(cookies.map(cookie => ({ name: cookie.name, value: cookie.value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" as const }))); } } });
  const { error: authError } = await auth.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (authError) throw new Error("Cannot authenticate development test session");
  await page.goto("/asistencia");
  await page.getByPlaceholder("Número de documento").fill(selected.document);
  await page.getByRole("button", { name: "Buscar empleado" }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("dialog").locator("video")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar marcación" })).toHaveCount(0);
  const forged = await page.request.post("/api/asistencia/biometria", { data: { operation: "confirm", personaId: selected.person, storeId: selected.store, grant: "forged.signature", latitude: 0, longitude: 0, accuracy: 10 } });
  expect(forged.status()).toBe(403);
  const restrictedReport = await page.request.post("/api/asistencia/biometria", { data: { operation: "reports", personaId: selected.person, storeId: selected.store } });
  expect(restrictedReport.status()).toBe(403);
  const started = await page.request.post("/api/asistencia/biometria", { data: { operation: "start", personaId: selected.person, storeId: selected.store } });
  expect([200, 429]).toContain(started.status());
  if (started.status() === 200) {
    const biometric = await started.json();
    const evidence = { operation: "evidence", personaId: selected.person, storeId: selected.store, sessionId: biometric.id, mode: "verify", images: ["AA==", "AA==", "AA=="] };
    for (let i = 0; i < 3; i++) expect((await page.request.post("/api/asistencia/biometria", { data: evidence })).status()).toBe(422);
    expect((await page.request.post("/api/asistencia/biometria", { data: evidence })).status()).toBe(429);
  } else {
    expect((await started.json()).detail).toContain("Too many sessions");
  }
  await page.screenshot({ path: "test-results/biometric-capture.png" });
  // UI-only acceptance branch: every request is intercepted here; no mock grant
  // is ever sent to FastAPI, Cloud or the transactional attendance function.
  let confirmations = 0;
  await page.route("**/api/asistencia/biometria", async route => {
    const body = route.request().postDataJSON();
    const result = body.operation === "start" ? { id: "isolated-ui-only", challenge: "turn_left_then_center" } : body.operation === "evidence" ? { authorized: true, grant: "isolated-ui-only", cosine_score: 0.99 } : body.operation === "confirm" ? { registered: true, eventId: "isolated-ui-only" } : {};
    if (body.operation === "confirm") confirmations++;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.getByRole("button", { name: "Iniciar captura" }).click();
  await expect(page.getByRole("button", { name: "Confirmar marcación" })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Confirmar marcación" }).click();
  await expect(page.getByText("Marcación confirmada", { exact: false })).toBeVisible();
  expect(confirmations).toBe(1);
});

test("owner evaluation panel is integrated and usable on mobile", async ({ page, context }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: profile } = await admin.from("user_profiles").select("user_id").eq("role", "owner").eq("is_active", true).limit(1).single();
  if (!profile) throw new Error("Development owner fixture missing");
  const { data: account } = await admin.auth.admin.getUserById(profile.user_id);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: account.user!.email! });
  if (!link?.properties?.hashed_token) throw new Error("Cannot create development owner session");
  const auth = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => [], setAll: async cookies => { await context.addCookies(cookies.map(cookie => ({ name: cookie.name, value: cookie.value, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" as const }))); } } });
  const { error } = await auth.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (error) throw new Error("Cannot authenticate development owner");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/personal/biometria");
  await expect(page.getByRole("heading", { name: "Evaluación biométrica", exact: true })).toBeVisible();
  await expect(page.getByLabel("Participante y tienda")).toBeVisible();
  await page.getByRole("button", { name: "Actualizar reporte" }).click();
  await expect(page.getByText("Métricas observadas", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Exportar reporte JSON" })).toBeVisible();
  await page.screenshot({ path: "test-results/biometric-panel-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Biometría facial", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Operación biométrica").selectOption("enroll");
  await expect(page.getByRole("button", { name: "Iniciar captura" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Iniciar captura" })).toBeEnabled();
});
