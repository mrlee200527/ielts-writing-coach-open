import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "雅思作文助手", description: "IELTS Academic Task 1 写作工作台" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
