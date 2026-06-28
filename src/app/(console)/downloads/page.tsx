import { redirect } from "next/navigation";

export default function DownloadsRoutePage() {
  redirect("/tasks?tab=downloads");
}
