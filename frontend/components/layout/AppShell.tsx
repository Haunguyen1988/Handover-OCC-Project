'use client';

import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CriticalBanner } from './CriticalBanner';
import { FloatingActionButton } from './FloatingActionButton';
import { useShiftTheme } from '../../hooks/useShiftTheme';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../hooks/useI18n';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { CommandPaletteProvider, useCommandPalette, useRegisterCommands } from '../../hooks/useCommandPalette';
import { CommandPalette } from '../cmdk/CommandPalette';
import { ShortcutsOverlay } from '../cmdk/ShortcutsOverlay';
import { buildDefaultCommands, type Command } from '../../lib/commands';
import type { AckAlert, Shift, ThemeMode, UserSummary } from '../../lib/types';

const EMPTY_COMMANDS: ReadonlyArray<Command> = [];

export interface AppShellProps {
  user: UserSummary | null;
  /** Stale unacknowledged High/Critical summary; banner hides when severity is 'none'. */
  ackAlert: AckAlert;
  /** Force the shift accent (e.g. from the active handover). */
  shiftOverride?: Shift | null;
  initialTheme?: ThemeMode;
  recordCount?: number;
  children: ReactNode;
}

/**
 * Top-level shell: topbar + sidebar + critical banner + content.
 * Wires global keyboard shortcuts (`N`, `D`, `L`, `T`, `?`, `Cmd/Ctrl+K`)
 * and mounts the command palette + shortcuts overlay.
 */
export function AppShell({
  user,
  ackAlert,
  shiftOverride,
  initialTheme,
  recordCount,
  children,
}: AppShellProps) {
  const { t } = useI18n();
  const searchRef = useRef<HTMLInputElement>(null);
  useShiftTheme(shiftOverride ?? null);

  const handleSignOut = useCallback(() => {
    signOut({ callbackUrl: '/signin' });
  }, []);

  return (
    <CommandPaletteProvider defaultCommands={EMPTY_COMMANDS}>
      <CommandPaletteWiring
        searchRef={searchRef}
        onSignOut={handleSignOut}
        initialTheme={initialTheme}
      />
      <div className="grid min-h-screen grid-cols-[15rem_1fr]" data-i18n-loaded={t !== undefined ? '1' : '0'}>
        <Sidebar recordCount={recordCount} signOut={handleSignOut} />
        <div className="flex min-h-screen flex-col">
          <TopBar user={user} initialTheme={initialTheme} onSignOut={handleSignOut} searchInputRef={searchRef} />
          <CriticalBanner ackAlert={ackAlert} />
          <main className="flex-1 overflow-y-auto px-6 py-6">
            {children}
          </main>
        </div>
        <FloatingActionButton />
      </div>
      <CommandPalette currentRole={user?.role} />
      <ShortcutsOverlay />
    </CommandPaletteProvider>
  );
}

/**
 * Lives inside the provider so it can register the default commands
 * with full access to `useRouter`, `useTheme`, and `setShortcutsOpen`,
 * and so it can drive the global keystroke handler.
 */
function CommandPaletteWiring({
  searchRef,
  onSignOut,
  initialTheme,
}: {
  searchRef: React.RefObject<HTMLInputElement>;
  onSignOut?: () => void;
  initialTheme?: ThemeMode;
}) {
  const router = useRouter();
  const { toggle: toggleLocale } = useI18n();
  const { toggleTheme } = useTheme(initialTheme);
  const { open, shortcutsOpen, setOpen, setShortcutsOpen } = useCommandPalette();

  const defaultCommands = useMemo(
    () =>
      buildDefaultCommands({
        navigate: (href) => router.push(href),
        toggleTheme,
        toggleLocale,
        signOut: onSignOut,
        openShortcutsOverlay: () => setShortcutsOpen(true),
      }),
    [router, toggleTheme, toggleLocale, onSignOut, setShortcutsOpen]
  );

  useRegisterCommands(defaultCommands);

  useKeyboardShortcuts({
    onNew: () => router.push('/handover/new'),
    onDashboard: () => router.push('/dashboard'),
    onLog: () => router.push('/log'),
    onSearch: () => searchRef.current?.focus(),
    onToggleTheme: toggleTheme,
    onPalette: () => setOpen(!open),
    onHelp: () => setShortcutsOpen(!shortcutsOpen),
    onEscape: () => {
      if (open) setOpen(false);
      else if (shortcutsOpen) setShortcutsOpen(false);
    },
  });

  return null;
}
