"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowRight, Briefcase, KeyRound, Loader2, Truck } from "lucide-react";
import { login, register } from "@/lib/api";
import { saveSession } from "@/lib/session";

export default function AuthScreen({
  initialMode,
}: {
  initialMode: "login" | "register";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setLoading(true);
    setError("");

    try {
      const response =
        mode === "login"
          ? await login(form.email, form.password)
          : await register(form.email, form.password, form.name);

      saveSession(response.access_token, response.user);
      router.push(response.user.role === "DRIVER" ? "/driver" : "/dashboard");
    } catch (err: any) {
      setError(err?.response?.data?.message || "Не удалось выполнить вход");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 md:px-6">
      <div className="grid w-full gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden rounded-[40px] border border-white/70 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_30%),linear-gradient(145deg,_rgba(255,255,255,0.96),_rgba(241,245,249,0.92))] p-8 shadow-[0_36px_100px_rgba(148,163,184,0.22)] md:p-10">
          <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm text-slate-600">
            ← На главную
          </Link>

          <div className="mt-8 flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-3xl bg-slate-900 text-white shadow-lg">
              <Truck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Adaptive Logistics Platform
              </p>
              <h1 className="mt-2 font-[Georgia] text-3xl text-slate-900 md:text-4xl">
                Вход в диспетчерскую и кабинет водителя
              </h1>
            </div>
          </div>

          <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600">
            Светлая версия интерфейса собрана как рабочая админка: выдача учёток
            водителям, маршруты от склада до ПВЗ, карта с моковыми координатами и
            персональные кабинеты под роль пользователя.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <FeatureCard
              icon={<Briefcase className="h-5 w-5" />}
              title="Админский контур"
              text="Управление водителями, складами, ПВЗ, маршрутами и лентой событий."
            />
            <FeatureCard
              icon={<KeyRound className="h-5 w-5" />}
              title="Роли и доступ"
              text="Водитель попадает в свой кабинет, диспетчер — в расширенную панель."
            />
          </div>

          <div className="mt-8 rounded-[32px] border border-slate-200/80 bg-white/80 p-6">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-400">
              Демо-аккаунты
            </p>
            <div className="mt-4 grid gap-3 text-sm text-slate-600">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <strong className="block text-slate-900">Администратор</strong>
                admin@logistics.local / Admin123!
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <strong className="block text-slate-900">Водитель</strong>
                driver.morozov@logistics.local / Driver123!
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[40px] border border-white/70 bg-white/95 p-8 shadow-[0_36px_100px_rgba(148,163,184,0.22)] md:p-10">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Доступ
          </p>
          <h2 className="mt-3 font-[Georgia] text-3xl text-slate-900">
            {mode === "login" ? "Открыть систему" : "Создать диспетчерский аккаунт"}
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Водителей лучше создавать из админки, чтобы сразу выдавать им логин,
            пароль и привязку к транспорту.
          </p>

          <div className="mt-8 grid grid-cols-2 rounded-full border border-slate-200 bg-slate-100 p-1">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={
                  item === mode
                    ? "rounded-full bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm"
                    : "rounded-full px-4 py-3 text-sm text-slate-500"
                }
              >
                {item === "login" ? "Вход" : "Регистрация"}
              </button>
            ))}
          </div>

          <div className="mt-8 space-y-4">
            {mode === "register" ? (
              <label className="block">
                <span className="mb-2 block text-sm text-slate-500">Имя</span>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-300 focus:bg-white"
                  placeholder="Например, Ольга Диспетчер"
                  value={form.name}
                  onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm text-slate-500">Email</span>
              <input
                type="email"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-300 focus:bg-white"
                placeholder="dispatch@company.ru"
                value={form.email}
                onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm text-slate-500">Пароль</span>
              <input
                type="password"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-300 focus:bg-white"
                placeholder="Минимум 6 символов"
                value={form.password}
                onChange={(e) => setForm((current) => ({ ...current, password: e.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
              />
            </label>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-4 text-sm font-semibold text-white shadow-lg shadow-slate-300 transition hover:bg-slate-800 disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>
        </section>
      </div>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200/80 bg-white/82 p-5">
      <div className="mb-4 inline-flex rounded-2xl bg-slate-900 p-3 text-white">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-slate-600">{text}</p>
    </div>
  );
}
