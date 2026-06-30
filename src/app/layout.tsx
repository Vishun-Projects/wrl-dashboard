import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Analytics } from '@vercel/analytics/next';
import { Toaster } from 'sonner';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { getUserInfo } from '@/lib/auth/session';
import { ThemeScript } from '@/components/theme/ThemeScript';
import { resolveAppTheme } from '@/lib/ui/theme';

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialUser = await getUserInfo();
  const initialTheme = resolveAppTheme(initialUser?.theme);

  return (
    <html lang="en" data-theme={initialTheme} suppressHydrationWarning>
      <body className={`${dmSans.variable} ${jetbrainsMono.variable} antialiased font-sans`}>
        <ThemeScript />
        <DashboardLayout initialUser={initialUser}>
          {children}
        </DashboardLayout>
        <Toaster position="bottom-right" richColors closeButton />
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
