'use client';

import React from 'react';
import Image from 'next/image';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { cn } from '@/lib/cn';

const authFont = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const AUTH_INPUT_CLASS =
  'h-12 w-full rounded-[10px] border border-slate-200/90 bg-[#f7f8fa] px-3.5 text-[13.5px] font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400/90 outline-none shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,background-color,box-shadow] duration-150 hover:border-slate-300 hover:bg-white focus:border-slate-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(15,23,42,0.06)] disabled:opacity-60';

const AUTH_LABEL_CLASS =
  'text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500';

const AUTH_BTN_CLASS =
  'group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-slate-900 text-[14px] font-semibold text-white shadow-[0_10px_28px_-8px_rgba(15,23,42,0.45),inset_0_1px_0_rgba(255,255,255,0.12)] transition-[transform,background-color,box-shadow] duration-150 hover:bg-slate-800 hover:shadow-[0_14px_32px_-10px_rgba(15,23,42,0.5)] active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50';

export function authInputClassName(extra?: string) {
  return cn(AUTH_INPUT_CLASS, extra);
}

export function authLabelClassName(extra?: string) {
  return cn(AUTH_LABEL_CLASS, extra);
}

export function authButtonClassName(extra?: string) {
  return cn(AUTH_BTN_CLASS, extra);
}

export function AuthAlert({
  variant,
  children,
}: {
  variant: 'error' | 'success' | 'info';
  children: React.ReactNode;
}) {
  const styles =
    variant === 'error'
      ? 'border-rose-200/80 bg-rose-50/90 text-rose-800'
      : variant === 'success'
        ? 'border-emerald-200/80 bg-emerald-50/90 text-emerald-900'
        : 'border-amber-200/70 bg-amber-50/80 text-amber-950';
  const dot =
    variant === 'error'
      ? 'bg-rose-500'
      : variant === 'success'
        ? 'bg-emerald-500'
        : 'bg-amber-500';

  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-[12.5px] leading-snug',
        styles
      )}
      role="alert"
    >
      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', dot)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

type AuthSplitShellProps = {
  children: React.ReactNode;
  headline?: React.ReactNode;
  support?: string;
};

/** Compact light split auth: brand photo left, polished form panel right. */
export function AuthSplitShell({
  children,
  headline = (
    <>
      Reports that bring the close into <span className="text-amber-600">focus.</span>
    </>
  ),
  support =
    'MIS, call register, ARCP, and field audits — reporting for Western Refrigeration teams.',
}: AuthSplitShellProps) {
  return (
    <div className={cn(authFont.className, 'flex min-h-screen text-slate-900 antialiased')}>
      {/* Left — leave alone; user signed off */}
      <aside className="relative hidden w-1/2 flex-col overflow-hidden border-r border-slate-200/80 lg:flex">
        <Image
          src="/auth-brand-bg.png"
          alt=""
          fill
          priority
          sizes="50vw"
          className="object-cover object-center"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              'linear-gradient(160deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.5) 42%, rgba(255,255,255,0.28) 70%, rgba(255,255,255,0.75) 100%)',
          }}
        />

        <div className="relative z-[1] flex h-full flex-col justify-between p-9 xl:p-12">
          <div className="flex items-center gap-3">
            <Image
              src="/western-head-logo-2025.png"
              alt="Western Refrigeration"
              width={132}
              height={52}
              className="h-10 w-auto object-contain"
              priority
            />
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold leading-tight text-slate-900">
                Western Refrigeration Pvt. Ltd.
              </p>
              <p className="text-[12px] text-slate-500">Reports portal</p>
            </div>
          </div>

          <div className="max-w-md space-y-3 pb-2">
            <h1 className="text-[2rem] font-semibold leading-[1.15] tracking-[-0.02em] text-slate-900 xl:text-[2.25rem]">
              {headline}
            </h1>
            <p className="max-w-sm text-[13.5px] leading-relaxed text-slate-600">{support}</p>
          </div>
        </div>
      </aside>

      {/* Right — soft canvas + elevated card */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              'linear-gradient(155deg, #eef1f5 0%, #f7f8fa 42%, #e8ecf1 100%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.45]"
          aria-hidden
          style={{
            backgroundImage:
              'radial-gradient(ellipse 70% 50% at 80% 0%, rgba(255,255,255,0.95), transparent 55%), radial-gradient(ellipse 50% 40% at 10% 100%, rgba(251,191,36,0.08), transparent 50%)',
          }}
        />
        {/* Soft grid — depth without noise */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          aria-hidden
          style={{
            backgroundImage:
              'linear-gradient(rgba(15,23,42,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.035) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage:
              'radial-gradient(ellipse 80% 70% at 50% 45%, black 20%, transparent 75%)',
          }}
        />

        <div className="relative z-[1] flex items-center gap-2.5 border-b border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-md lg:hidden">
          <Image
            src="/western-head-logo-2025.png"
            alt="Western Refrigeration"
            width={100}
            height={40}
            className="h-8 w-auto object-contain"
            priority
          />
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-semibold text-slate-900">
              Western Refrigeration Pvt. Ltd.
            </p>
            <p className="text-[11px] text-slate-500">Reports portal</p>
          </div>
        </div>

        <div className="relative z-[1] flex flex-1 items-center justify-center p-5 sm:p-8">
          <div className="w-full max-w-[400px]">
            <div
              className={cn(
                'relative overflow-hidden rounded-2xl border border-white/80 bg-white/85 p-7 sm:p-8',
                'shadow-[0_1px_1px_rgba(15,23,42,0.04),0_8px_24px_-6px_rgba(15,23,42,0.1),0_24px_48px_-18px_rgba(15,23,42,0.16)]',
                'backdrop-blur-sm'
              )}
            >
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full blur-3xl"
                aria-hidden
                style={{ background: 'rgba(251,191,36,0.1)' }}
              />
              <div className="relative z-[1]">{children}</div>
            </div>
            <p className="mt-5 text-center text-[11px] font-medium tracking-[0.04em] text-slate-400">
              Internal access · Western Refrigeration Pvt. Ltd.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
