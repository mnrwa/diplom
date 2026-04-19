"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";

export function Header() {
  const pathname = usePathname() || "/";

  // На страницах кабинета хедер не нужен — там своя шапка
  const isWorkspace =
    pathname.startsWith("/lk") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/driver");

  if (isWorkspace) return null;

  const isLogin = pathname.startsWith("/login");

  return (
    <header className="sticky top-0 z-50 border-b border-sand/60 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="h-9 w-9 overflow-hidden rounded-lg">
            <img
              src="/img/logo.png"
              alt="VELTO"
              className="h-full w-full object-cover"
            />
          </div>
          <span className="text-xl font-bold tracking-tight text-plum">
            VELTO
          </span>
        </Link>

        {/* Right nav */}
        <nav className="flex items-center gap-3">
          {!isLogin && (
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-2xl bg-pinterest px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              <LogIn className="h-4 w-4" />
              Войти
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
