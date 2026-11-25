import React from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/core/session/SessionContext';

export const metadata: Metadata = {
  title: 'Toàn Trung CRM — Hệ thống Quản trị Marketing & Kinh doanh',
  description: 'Nền tảng quản trị Marketing, Kinh doanh & Thiết kế 3D nội bộ Công ty Cổ phần Điện tử Viễn thông Toàn Trung',
  icons: {
    icon: '/brand/logo-toan-trung.png',
    shortcut: '/brand/logo-toan-trung.png',
  },
  other: {
    'text-scale': 'scale',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}

