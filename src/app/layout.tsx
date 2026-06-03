import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WRL",
  description: "Real-time call review and management portal",
};

import { Toaster } from 'sonner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${jetbrainsMono.variable} antialiased font-sans`}>
        <DashboardLayout>
          {children}
        </DashboardLayout>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
