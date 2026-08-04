import ChecklistIdentityGuard from "./ChecklistIdentityGuard";
import ChecklistReadinessDashboard from "./ChecklistReadinessDashboard";

export default function InstaCompPendingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ChecklistIdentityGuard>
      <ChecklistReadinessDashboard />
      {children}
    </ChecklistIdentityGuard>
  );
}
