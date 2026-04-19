import AuthScreen from "@/components/auth/AuthScreen";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { mode?: string; next?: string };
}) {
  const initialMode = searchParams?.mode === "register" ? "register" : "login";
  const next = typeof searchParams?.next === "string" ? searchParams.next : undefined;
  return <AuthScreen initialMode={initialMode} next={next} />;
}
