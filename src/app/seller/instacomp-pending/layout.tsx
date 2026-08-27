import ChecklistReadinessDashboard from "./ChecklistReadinessDashboard";

export default function InstaCompPendingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <ChecklistReadinessDashboard />
      {children}
    </>
  );
}