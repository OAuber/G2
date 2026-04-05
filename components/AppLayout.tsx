import React from 'react';

/** Enveloppe racine : thème clair/sombre et fond plein écran. */
export function AppLayout({
  isDarkMode,
  children,
}: {
  isDarkMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${isDarkMode ? 'dark [color-scheme:dark]' : '[color-scheme:light]'} flex h-screen h-dvh w-screen overflow-hidden relative transition-colors duration-500`}
    >
      <div className="absolute inset-0 bg-sky-50 dark:bg-black transition-colors duration-500 -z-10" />
      {children}
    </div>
  );
}
