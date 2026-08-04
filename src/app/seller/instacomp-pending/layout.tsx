import ChecklistIdentityGuard from "./ChecklistIdentityGuard";

export default function InstaCompPendingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <ChecklistIdentityGuard>{children}</ChecklistIdentityGuard>;
}
