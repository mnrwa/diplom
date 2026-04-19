"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
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
    <main className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">

        {/* Card */}
        <div className="rounded-[28px] border border-sand bg-white px-8 py-10 shadow-sm">

          {/* Logo + brand */}
          <div className="mb-8 flex items-center gap-3">
            <div className="h-10 w-10 overflow-hidden rounded-xl">
              <img src="/img/logo.png" alt="VELTO" className="h-full w-full object-cover" />
            </div>
            <span className="text-xl font-bold tracking-tight text-plum">VELTO</span>
          </div>

          {/* Heading */}
          <h1 className="text-2xl font-bold text-plum">
            {mode === "login" ? "Вход в систему" : "Регистрация"}
          </h1>
          <p className="mt-1.5 text-sm text-olive">
            {mode === "login"
              ? "Введите данные, чтобы продолжить"
              : "Создайте аккаунт диспетчера"}
          </p>

          {/* Mode switcher */}
          <div className="mt-6 grid grid-cols-2 rounded-2xl bg-sand p-1">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => { setMode(item); setError(""); }}
                className={
                  item === mode
                    ? "rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-plum"
                    : "rounded-xl px-4 py-2.5 text-sm text-olive transition hover:text-plum"
                }
              >
                {item === "login" ? "Войти" : "Регистрация"}
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="mt-6 space-y-4">
            {mode === "register" && (
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-olive">Имя</span>
                <input
                  autoFocus
                  className="w-full rounded-2xl border border-warmsilver bg-white px-4 py-3 text-plum outline-none transition focus:border-focusblue focus:ring-0"
                  placeholder="Иван Иванов"
                  value={form.name}
                  onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-olive">Email</span>
              <input
                type="email"
                autoComplete="email"
                className="w-full rounded-2xl border border-warmsilver bg-white px-4 py-3 text-plum outline-none transition focus:border-focusblue"
                placeholder="example@company.ru"
                value={form.email}
                onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-olive">Пароль</span>
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="w-full rounded-2xl border border-warmsilver bg-white px-4 py-3 text-plum outline-none transition focus:border-focusblue"
                placeholder="Минимум 6 символов"
                value={form.password}
                onChange={(e) => setForm((c) => ({ ...c, password: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
            </label>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-pinterest/20 bg-pinterest/5 px-4 py-3 text-sm text-pinterest">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-pinterest px-5 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <ArrowRight className="h-4 w-4" />}
            {mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>

          {/* Demo accounts */}
          <div className="mt-6 border-t border-sand pt-5">
            <button
              type="button"
              onClick={() => setShowDemo((v) => !v)}
              className="flex w-full items-center justify-between text-sm text-olive transition hover:text-plum"
            >
              <span>Демо-аккаунты</span>
              {showDemo
                ? <ChevronUp className="h-4 w-4" />
                : <ChevronDown className="h-4 w-4" />}
            </button>

            {showDemo && (
              <div className="mt-3 space-y-2">
                <DemoAccount
                  label="Диспетчер"
                  email="admin@logistics.local"
                  password="Admin123!"
                  onFill={() => setForm((c) => ({ ...c, email: "admin@logistics.local", password: "Admin123!" }))}
                />
                <DemoAccount
                  label="Водитель"
                  email="driver.morozov@logistics.local"
                  password="Driver123!"
                  onFill={() => setForm((c) => ({ ...c, email: "driver.morozov@logistics.local", password: "Driver123!" }))}
                />
              </div>
            )}
          </div>
        </div>

        {/* Back link */}
        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-olive transition hover:text-plum">
            ← На главную
          </Link>
        </div>
      </div>
    </main>
  );
}

function DemoAccount({
  label,
  email,
  password,
  onFill,
}: {
  label: string;
  email: string;
  password: string;
  onFill: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onFill}
      className="flex w-full items-center justify-between rounded-2xl border border-sand bg-fog px-4 py-3 text-left transition hover:border-warmsilver"
    >
      <div>
        <span className="block text-sm font-medium text-plum">{label}</span>
        <span className="block text-xs text-olive">{email}</span>
      </div>
      <span className="text-xs text-warmsilver">Заполнить</span>
    </button>
  );
}
