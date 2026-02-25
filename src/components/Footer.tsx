'use client';

import React from 'react';
import Link from 'next/link';
import { FalconIcon } from './FalconIcon';

export function Footer() {
  return (
    <footer className="relative py-12">
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-gold/80 to-transparent" />
      <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-2">
          <FalconIcon className="w-6 h-6 text-zinc-700" color="currentColor" />
          <span className="font-bold text-sm text-zinc-500 uppercase tracking-tighter">FALKEN Protocol</span>
        </div>
        <p className="text-[10px] font-bold text-zinc-700 uppercase tracking-[0.2em]">
          Stakes are real. Logic is absolute. &copy; 2026
        </p>
        <div className="flex gap-6">
          <Link href="/vision" className="text-[10px] font-bold text-zinc-600 hover:text-white uppercase transition-colors">Vision</Link>
          <Link href="/onboarding" className="text-[10px] font-bold text-zinc-600 hover:text-white uppercase transition-colors">Docs</Link>
        </div>
      </div>
    </footer>
  );
}
