import type { Metadata } from "next";
import { Geist, Geist_Mono, Cinzel, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import BackgroundManager from "./components/BackgroundManager";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Helios — MCP Server Generator",
  description: "Transform complex APIs into clean, agent-friendly MCP server tools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/Background-Midnight(1).svg" as="image" />
        <link rel="preload" href="/Background-Dusk(2).svg" as="image" />
        <link rel="preload" href="/Background-Sunrise(3).svg" as="image" />
        <link rel="preload" href="/Background-Midday-nosun.svg" as="image" />
        <link rel="preload" href="/Background-Sunset(5).svg" as="image" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cinzel.variable} ${cormorant.variable} antialiased`}
      >
        <BackgroundManager />
        {children}
      </body>
    </html>
  );
}
