from pathlib import Path


def replace_scenario_source(text: str, name: str) -> str:
    marker = f'scenario("{name}", () => {{'
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f"missing scenario: {name}")
    next_scenario = text.find('\nscenario("', start + len(marker))
    end = len(text) if next_scenario < 0 else next_scenario
    block = text[start:end]
    if "adminPageSource" not in block:
        raise SystemExit(f"scenario has no adminPageSource reference: {name}")
    block = block.replace("adminPageSource", "legacyAdminDashboardSource")
    return text[:start] + block + text[end:]


sim_path = Path("scripts/run-admin-dashboard-actions-simulations.mjs")
sim = sim_path.read_text("utf-8")

source_marker = '''const adminPageSource = await readFile(
  new URL("../src/app/admin/page.tsx", import.meta.url),
  "utf8",
);
'''
source_addition = source_marker + '''const legacyAdminDashboardSource = await readFile(
  new URL("../src/app/admin/LegacyAdminDashboard.tsx", import.meta.url),
  "utf8",
);
const advancedAdminPageSource = await readFile(
  new URL("../src/app/admin/advanced/page.tsx", import.meta.url),
  "utf8",
);
'''
if "const legacyAdminDashboardSource" not in sim:
    if source_marker not in sim:
        raise SystemExit("missing admin page source marker")
    sim = sim.replace(source_marker, source_addition, 1)

for scenario_name in [
    "admin command center price radar forms use pending-aware submits",
    "inventory bridge and manual product submits explain scope",
    "admin command center exposes no-dead-end operator action map",
    "admin command center uses professional command presentation",
    "admin command center exposes first-screen operator attention strip",
    "admin command center exposes a professional priority playbook",
    "admin command center keeps lower operating panels visually finished",
    "admin command center surfaces data-source health before counts",
    "admin command center keeps critical operator routes one click away",
    "admin static page inventory stays linked and runtime-smoked",
    "admin command center uses professional playbook copy",
]:
    if f'scenario("{scenario_name}"' in sim and f'scenario("{scenario_name}"' in sim:
        # Idempotent: only rewrite blocks that still point at the simple Admin Home.
        start = sim.find(f'scenario("{scenario_name}", () => {{')
        next_scenario = sim.find('\nscenario("', start + 1)
        end = len(sim) if next_scenario < 0 else next_scenario
        if "adminPageSource" in sim[start:end]:
            sim = replace_scenario_source(sim, scenario_name)

architecture_scenario = '''scenario("simple admin home routes card work to KINGMAKER and preserves advanced admin", () => {
  for (const fragment of [
    "Cards live in KINGMAKER. Admin stays simple.",
    "Enter KINGMAKER",
    'href="/kingmaker"',
    'href: "/admin/advanced"',
    "The full legacy command center is preserved here instead of cluttering Admin Home.",
  ]) {
    assert(
      adminPageSource.includes(fragment),
      `Expected simple Admin Home architecture fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    'import LegacyAdminDashboard from "../LegacyAdminDashboard";',
    "<LegacyAdminDashboard />",
    'href="/admin"',
    'href="/kingmaker"',
    "The original command center is preserved here for diagnostics and uncommon operations.",
  ]) {
    assert(
      advancedAdminPageSource.includes(fragment),
      `Expected Advanced Admin preservation fragment ${fragment}.`,
    );
  }
});

'''
if 'scenario("simple admin home routes card work to KINGMAKER and preserves advanced admin"' not in sim:
    insertion = 'scenario("category review page does not show false-clear import queues", () => {'
    if insertion not in sim:
        raise SystemExit("missing scenario insertion point")
    sim = sim.replace(insertion, architecture_scenario + insertion, 1)

sim_path.write_text(sim, "utf-8")

guard_path = Path("scripts/check-production-guardrails.mjs")
guard = guard_path.read_text("utf-8")
old = 'assertFileIncludes("admin dashboard shipping evidence validator source", "src/app/admin/page.tsx", ['
new = 'assertFileIncludes("advanced admin dashboard shipping evidence validator source", "src/app/admin/LegacyAdminDashboard.tsx", ['
if old in guard:
    guard = guard.replace(old, new, 1)
elif new not in guard:
    raise SystemExit("missing production guardrail admin dashboard assertion")

guard_path.write_text(guard, "utf-8")

print("Patched Admin audit contracts for simple Admin Home + preserved Advanced Admin split.")
