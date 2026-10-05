import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "投资 X Buddy · Agent 投研工作台",
  description: "从研究目标到可追溯结论：规划、证据、审批、检查点与研究记忆。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
