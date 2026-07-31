import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_SESSION_COOKIE_NAMES,
  isValidAdminSessionValue,
} from "../../lib/admin-session";

export default async function ListLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();

  for (const name of ADMIN_SESSION_COOKIE_NAMES) {
    const value = cookieStore.get(name)?.value;
    if (await isValidAdminSessionValue(value)) {
      return children;
    }
  }

  redirect(`/admin/login?next=${encodeURIComponent("/list")}`);
}
