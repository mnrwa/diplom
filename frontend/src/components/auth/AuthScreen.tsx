"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Loader2, AlertCircle } from "lucide-react";
import { login, register } from "@/lib/api";
import { saveSession } from "@/lib/session";

export default function AuthScreen({
  initialMode,
  next,
}: {
  initialMode: "login" | "register";
  next?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDemo, setShowDemo] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError("");

    try {
      const response =
        mode === "login"
          ? await login(form.email, form.password)
          : await register(form.email, form.password, form.name);

      saveSession(response.user);

      const candidate = next?.startsWith("/") ? next : null;
      const target = candidate && !candidate.startsWith("/login") ? candidate : "/lk";

      router.push(target);
    } catch (err: any) {
      setError(err?.response?.data?.message || "Неверный email или пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-fog px-4 py-16">
      <div className="w-full max-w-[420px]">

        {/* Back */}
        <Link href="/" className="mb-8 inline-flex items-center gap-1.5 text-sm text-warmsilver hover:text-plum transition-colors">
          <span>←</span> На главную
        </Link>

        {/* Card */}
        <div className="rounded-3xl border border-sand bg-white px-8 py-9 shadow-card">

          {/* Wordmark */}
          <div className="mb-8">
            <span className="text-[13px] font-bold tracking-[0.09em] text-plum uppercase">VELTO</span>
            <p className="mt-0.5 text-xs text-warmsilver">Платформа управления логистикой</p>
          </div>

          {/* Heading */}
          <h1 className="text-xl font-bold text-plum">
            {mode === "login" ? "Войдите в систему" : "Создайте аккаунт"}
          </h1>
          <p className="mt-1 text-sm text-warmsilver">
            {mode === "login"
              ? "Введите рабочие данные для входа"
              : "Регистрация для диспетчеров и перевозчиков"}
          </p>

          {/* Mode switcher */}
          <div className="mt-6 grid grid-cols-2 rounded-xl bg-fog p-1">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => { setMode(item); setError(""); }}
                className={[
                  "rounded-lg py-2.5 text-sm font-medium transition",
                  item === mode
                    ? "bg-white text-plum shadow-card"
                    : "text-warmsilver hover:text-olive",
                ].join(" ")}
              >
                {item === "login" ? "Вход" : "Регистрация"}
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="mt-5 space-y-4">
            {mode === "register" && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-warmsilver">
                  Имя
                </label>
                <input
                  autoFocus
                  className="w-full rounded-xl border border-sand bg-fog px-4 py-3 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-brand focus:bg-white transition"
                  placeholder="Иван Петров"
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-warmsilver">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                className="w-full rounded-xl border border-sand bg-fog px-4 py-3 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-brand focus:bg-white transition"
                placeholder="example@company.ru"
                value={form.email}
                onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-warmsilver">
                Пароль
              </label>
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="w-full rounded-xl border border-sand bg-fog px-4 py-3 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-brand focus:bg-white transition"
                placeholder={mode === "login" ? "Ваш пароль" : "Минимум 6 символов"}
                value={form.password}
                onChange={(e) => setForm((c) => ({ ...c, password: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-plum px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-olive disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {mode === "login" ? "Войти" : "Зарегистрироваться"}
          </button>

          {/* Demo accounts */}
          <div className="mt-6 border-t border-sand pt-5">
            <button
              type="button"
              onClick={() => setShowDemo((v) => !v)}
              className="flex w-full items-center justify-between text-sm text-olive hover:text-plum transition-colors"
            >
              <span>Демо-доступ для тестирования</span>
              {showDemo ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {showDemo && (
              <div className="mt-3 space-y-2">
                <DemoAccount
                  label="Диспетчер"
                  role="Полный доступ к диспетчерской"
                  email="admin@logistics.local"
                  password="Admin123!"
                  onFill={() => {
                    setMode("login");
                    setForm((c) => ({ ...c, email: "admin@logistics.local", password: "Admin123!" }));
                  }}
                />
                <DemoAccount
                  label="Водитель"
                  role="Кабинет водителя, GPS, чат"
                  email="driver.morozov@logistics.local"
                  password="Driver123!"
                  onFill={() => {
                    setMode("login");
                    setForm((c) => ({ ...c, email: "driver.morozov@logistics.local", password: "Driver123!" }));
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function DemoAccount({
  label,
  role,
  email,
  password,
  onFill,
}: {
  label: string;
  role: string;
  email: string;
  password: string;
  onFill: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFill}
      className="flex w-full items-center justify-between rounded-xl border border-sand bg-fog px-4 py-3 text-left transition hover:border-brand/40 hover:bg-emerald-50/30"
    >
      <div>
        <span className="block text-sm font-semibold text-plum">{label}</span>
        <span className="block text-xs text-warmsilver mt-0.5">{role}</span>
        <span className="block text-xs text-olive font-mono mt-1">{email}</span>
      </div>
      <span className="shrink-0 rounded-lg bg-white border border-sand px-2.5 py-1 text-xs font-medium text-olive">
        Войти
      </span>
    </button>
  );
}
