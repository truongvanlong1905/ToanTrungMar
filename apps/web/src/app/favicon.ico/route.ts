import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export async function GET() {
  const candidates = [
    path.resolve(process.cwd(), 'public', 'brand', 'logo-toan-trung.png'),
    path.resolve(process.cwd(), 'apps', 'web', 'public', 'brand', 'logo-toan-trung.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }
  }
  return new NextResponse(null, { status: 204 });
}
