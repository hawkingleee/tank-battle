import "./globals.css";

export const metadata = {
  title: "坦克大战 · Tank Battle",
  description: "使用 Next.js + Canvas 实现的经典坦克大战游戏",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
