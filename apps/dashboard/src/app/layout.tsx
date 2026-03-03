import type { Metadata } from "next";
import { DM_Mono } from "next/font/google";
import "./global.css";
import { Providers } from "../components/Providers";

const dmMono = DM_Mono({
  weight: ["300", "400", "500"],
  subsets: ["latin"],
  variable: "--font-dm-mono",
});

export const metadata: Metadata = {
  title: "FALKEN Arena Observer",
  description: "Real-time leaderboard and match tracker for the FALKEN Protocol.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmMono.variable}`}>
      <body className="antialiased font-mono">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
