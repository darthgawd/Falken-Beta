import type { Metadata } from "next";
import "./global.css";
import { Providers } from "../components/Providers";

export const metadata: Metadata = {
  title: "BOTBYTE Arena Observer",
  description: "Real-time leaderboard and match tracker for the BOTBYTE Protocol.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
