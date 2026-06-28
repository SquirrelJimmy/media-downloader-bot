import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; reason?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = Array.isArray(params.next) ? params.next[0] : params.next;
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  return <LoginForm nextPath={nextPath ?? "/"} reason={reason} />;
}
