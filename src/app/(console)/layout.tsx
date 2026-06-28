import { ConsoleLayout } from "@/components/console/layout";

export default function ConsoleRouteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ConsoleLayout>{children}</ConsoleLayout>;
}
