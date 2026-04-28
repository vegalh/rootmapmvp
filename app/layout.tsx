import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rootmap MVP",
  description: "AI-assisted observation and off-screen activity guidance for ages 2–8."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
