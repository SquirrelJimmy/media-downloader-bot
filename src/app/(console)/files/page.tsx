import { redirect } from "next/navigation";

export default function FilesRoutePage() {
  redirect("/tasks?tab=downloads");
}
