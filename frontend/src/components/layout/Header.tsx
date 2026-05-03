"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname() || "/";

  const isWorkspace =
    pathname.startsWith("/lk") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/driver");

  if (isWorkspace) return null;

  const isLogin = pathname.startsWith("/login");
  const isTrack = pathname.startsWith("/track");

  if (isLogin || isTrack) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-sand bg-cream/92 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-10">
          <Link href="/">
            <span className="text-[15px] font-bold tracking-[0.07em] text-plum uppercase">
              VELTO
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-7">
            <Link href="/#tracking" className="text-sm text-warmsilver hover:text-plum transition-colors">
              Отслеживание
            </Link>
            <Link href="/marketplace" className="text-sm text-warmsilver hover:text-plum transition-colors">
              Биржа грузов
            </Link>
            <Link href="/#features" className="text-sm text-warmsilver hover:text-plum transition-colors">
              Возможности
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-olive hover:text-plum transition-colors">
            Войти
          </Link>
          <Link
            href="/login?mode=register"
            className="inline-flex h-9 items-center rounded-xl bg-plum px-4 text-sm font-semibold text-white hover:bg-olive transition-colors"
          >
            Начать работу
          </Link>
        </div>
      </div>
    </header>
  );
}
