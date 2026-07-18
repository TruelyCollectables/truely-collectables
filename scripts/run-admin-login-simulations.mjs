import { readFile } from "node:fs/promises";
import { safeAdminLoginNextPath } from "../src/lib/admin-login-destination.ts";

const loginPageSource = await readFile(
  new URL("../src/app/admin/login/page.tsx", import.meta.url),
  "utf8",
);
const loginRouteSource = await readFile(
  new URL("../src/app/api/admin/login/route.ts", import.meta.url),
  "utf8",
);

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

scenario("admin login page labels native submits while posting", () => {
  assert(
    loginPageSource.includes('import AdminSubmitButton from "../AdminSubmitButton";'),
    "Expected admin login page to import the shared admin submit button.",
  );
  assert(
    (loginPageSource.match(/<AdminSubmitButton/g) || []).length >= 2,
    "Expected password and local rescue login forms to use pending-aware submit buttons.",
  );

  for (const label of ["Signing in...", "Opening admin..."]) {
    assert(
      loginPageSource.includes(label),
      `Expected admin login pending label ${label}.`,
    );
  }

  for (const fragment of [
    "Submit the typed ADMIN_PASSWORD and create the admin session cookie for this browser.",
    "Uses the password box above. If accepted, TCOS refreshes the admin cookie",
    "sends this browser to the destination shown on the left.",
    "Open the admin locally without the password box; this route is accepted only on localhost in non-production.",
    "It does not use the typed password field.",
  ]) {
    assert(
      loginPageSource.includes(fragment),
      `Expected admin login action-scope guidance ${fragment}.`,
    );
  }
});

scenario("admin login route keeps password paste and local rescue guards", () => {
  for (const fragment of [
    "password.trim()",
    "safeAdminLoginNextPath",
    "verifyLocalDevelopmentAdminPassword",
    "localDevelopmentLogin",
    "jsonBodyNextPath",
    "typeof record.next === \"string\"",
    "typeof record.nextPath === \"string\"",
    "appendExpiredAdminSessionCookies",
    "appendAdminSessionCookies",
  ]) {
    assert(
      loginRouteSource.includes(fragment),
      `Expected admin login route guard fragment ${fragment}.`,
    );
  }
});

scenario("admin local rescue login stays localhost-only and non-production", () => {
  for (const fragment of [
    "process.env.NODE_ENV !== \"production\"",
    "hostname === \"localhost\"",
    "hostname === \"127.0.0.1\"",
    "hostname === \"::1\"",
    "loginPayload.localDevelopmentLogin &&\n    isLocalDevelopmentAdminHost(hostname)",
    "!isLocalDevelopmentLogin &&\n    !canUseLocalDevelopmentPasswordFile",
    "isLocalDevelopmentLogin ||\n    (await verifySubmittedAdminPassword(loginPayload.password, hostname))",
  ]) {
    assert(
      loginRouteSource.includes(fragment),
      `Expected admin local rescue boundary fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    "const localDevelopmentLoginAvailable = process.env.NODE_ENV !== \"production\";",
    "{localDevelopmentLoginAvailable ? (",
    "Localhost-only rescue button.",
    "It does not use the typed password field.",
    "Disabled in production and",
    "rejected for non-local hosts.",
  ]) {
    assert(
      loginPageSource.includes(fragment),
      `Expected admin login page local rescue guidance fragment ${fragment}.`,
    );
  }
});

scenario("admin login destination guard prevents login and logout loops", () => {
  assert(
    safeAdminLoginNextPath("/admin/products") === "/admin/products",
    "Expected normal admin workbench destinations to be preserved.",
  );
  assert(
    safeAdminLoginNextPath("/admin/login?next=%2Fadmin") === "/admin",
    "Expected login destinations to collapse to the command center.",
  );
  assert(
    safeAdminLoginNextPath("/admin/logout") === "/admin",
    "Expected logout destinations to collapse to the command center.",
  );
  assert(
    safeAdminLoginNextPath("/api/admin/login") === "/admin",
    "Expected API login destinations to collapse to the command center.",
  );
  assert(
    safeAdminLoginNextPath("//evil.example/admin") === "/admin",
    "Expected protocol-relative destinations to be rejected.",
  );
});

scenario("admin login shows operator-readable failure guidance", () => {
  for (const message of [
    "Invalid admin password.",
    "Admin password is not configured.",
    "Admin password was accepted, but the server could not create an admin session.",
    "Too many failed attempts were recorded.",
    "Admin login request was not readable.",
  ]) {
    assert(
      loginPageSource.includes(message),
      `Expected login failure guidance ${message}.`,
    );
  }
});

scenario("admin login fails cleanly when session creation fails", () => {
  for (const fragment of [
    "let sessionValue: string;",
    "createAdminSessionValue()",
    "loginPayload.nextPath",
    "loginRedirect(\n        req,\n        \"session_error\",\n        loginPayload.nextPath,\n      )",
    "admin_session_not_created",
    "appendExpiredAdminSessionCookies(sessionErrorResponse.headers, hostname)",
    "recordAdminLoginAttempt({\n    check: loginCheck,\n    success: true,",
  ]) {
    assert(
      loginRouteSource.includes(fragment),
      `Expected admin login session-failure fragment ${fragment}.`,
    );
  }
});

scenario("admin login preserves intended destination for browser and API clients", () => {
  for (const fragment of [
    "function loginRedirect(req: Request, code: string, nextPath?: string)",
    "url.searchParams.set(\"next\", redirectNextPath)",
    "nextPath: jsonBodyNextPath(body, queryNextPath)",
    "NextResponse.redirect(new URL(loginPayload.nextPath, requestOrigin(req)), 303)",
    "NextResponse.json({ success: true, nextPath: loginPayload.nextPath })",
    "loginRedirect(req, \"bad_request\", loginPayload.nextPath)",
    "loginRedirect(req, \"missing_password\", loginPayload.nextPath)",
  ]) {
    assert(
      loginRouteSource.includes(fragment),
      `Expected admin login destination-preservation fragment ${fragment}.`,
    );
  }
});

const failed = [];

for (const item of scenarios) {
  try {
    item.run();
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failed.push({ name: item.name, error });
    console.error(`✗ ${item.name}`);
    console.error(error);
  }
}

console.log(
  `Admin login simulations: ${scenarios.length - failed.length}/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
