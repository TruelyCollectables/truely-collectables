from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"Could not locate {label} block")
    return text.replace(old, new, 1)


def main() -> None:
    path = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
    text = path.read_text()

    text = replace_once(
        text,
        '''import { createClient } from "@supabase/supabase-js";
''',
        '''import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
''',
        "benchmark Supabase import",
    )

    old = '''async function cleanupBenchmarkScan(scanId: unknown) {
  const id = clean(scanId);
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!id) return { status: "skipped", message: "No saved scan ID was returned." };
  if (!url || !key) return { status: "error", message: "Supabase service-role cleanup is not configured." };

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from("instacomp_scans").delete().eq("id", id);
  return error
    ? { status: "error", message: error.message }
    : { status: "deleted", message: "Benchmark scan row removed after grading." };
}
'''
    new = '''async function cleanupBenchmarkScan(scanId: unknown) {
  const id = clean(scanId);
  if (!id) return { status: "skipped", message: "No saved scan ID was returned." };

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const { error, count } = await supabase
      .from("instacomp_scans")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) return { status: "error", message: error.message };
    if (count !== 1) {
      return {
        status: "error",
        message: `Benchmark cleanup deleted ${count ?? 0} rows instead of exactly one.`,
      };
    }
    return { status: "deleted", message: "Benchmark scan row removed after grading." };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unknown benchmark cleanup error.",
    };
  }
}
'''
    text = replace_once(text, old, new, "benchmark cleanup")
    path.write_text(text)


if __name__ == "__main__":
    main()
