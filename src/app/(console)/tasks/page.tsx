import { TasksPage } from "@/components/console/pages/tasks-page";

export default async function TasksRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const params = await searchParams;
  const tab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab = tab === "downloads" ? "downloads" : "tasks";
  return <TasksPage key={initialTab} initialTab={initialTab} />;
}
