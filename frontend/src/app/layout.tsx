import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Adaptive Logistics Platform",
  description:
    "Логистическая платформа с публичным трекингом заказа, созданием отправки, диспетчерской панелью и кабинетом водителя.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body className="app-body">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
