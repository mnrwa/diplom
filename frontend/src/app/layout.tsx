import type { Metadata } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { Providers } from "./providers";
import { Header } from "@/components/layout/Header";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "VELTO — Логистическая платформа",
  description:
    "Логистическая платформа с публичным трекингом заказа, созданием отправки, диспетчерской панелью и кабинетом водителя.",
  icons: {
    icon: "/favicon.ico", 
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="min-h-screen">
        <Providers>
          <Header />
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
