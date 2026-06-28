"use client";

import { ConsoleHeader } from "@/components/console/header";
import { ConsoleRuntimeProvider } from "@/components/console/runtime-provider";
import { ConsoleSidebar } from "@/components/console/sidebar";

export function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConsoleRuntimeProvider>
      <div className="console-layout">
        <ConsoleSidebar />
        <div className="console-main-layout">
          <ConsoleHeader />
          <main className="console-content">{children}</main>
        </div>
      </div>
    </ConsoleRuntimeProvider>
  );
}
