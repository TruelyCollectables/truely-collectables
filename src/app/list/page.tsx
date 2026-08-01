import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ListCardsPage() {
  redirect("/admin/pending-card-import");
}
