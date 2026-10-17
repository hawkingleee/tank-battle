import "./globals.css";

export const metadata = {
  title: "李欢大战坦克",
  description: "使用 Next.js + Canvas 实现的经典坦克大战游戏",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
