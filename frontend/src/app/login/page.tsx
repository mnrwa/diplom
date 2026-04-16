import AuthScreen from "@/components/auth/AuthScreen";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { mode?: string };
}) {
  const initialMode = searchParams?.mode === "register" ? "register" : "login";
  return <AuthScreen initialMode={initialMode} />;
}
