import { AppShell } from "@/components/shell";

// Every signed-in route shares the shell: header, tab bar and the "How it was planned" panel.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
