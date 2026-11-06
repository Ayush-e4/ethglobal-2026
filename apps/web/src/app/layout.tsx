import { APP } from "@app/shared";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { PwaRegister } from "@/components/shell/Pwa";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: APP.name,
  description: APP.tagline,
  applicationName: APP.name,
  // Added to an iPhone's home screen: opens full screen, with our name and icon.
  appleWebApp: { capable: true, title: APP.name, statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

// Phones: edge to edge (the composer keeps clear of the home bar with safe-area padding).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
