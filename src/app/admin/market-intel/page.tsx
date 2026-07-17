import { redirect } from "next/navigation";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../lib/admin-handoff";

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

export default async function MarketIntelAdminPage({ searchParams }: PageProps) {
  const query = await searchParams;

  redirect(
    addAdminHandoff(
      "/admin/market-intel/purchases",
      query?.[ADMIN_HANDOFF_PARAM],
    ),
  );
}
