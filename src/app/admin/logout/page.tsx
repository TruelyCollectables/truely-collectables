import { redirect } from "next/navigation";
import { cookies } from "next/headers";

export default async function LogoutPage() {
  const cookieStore = await cookies();

  cookieStore.set("admin_auth", "", {
    maxAge: 0,
    path: "/",
  });

  redirect("/admin/login");
}