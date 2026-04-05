import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export interface InviteQrCodeProps {
  url: string;
  isDarkMode: boolean;
  label?: string;
  size?: number;
  className?: string;
}

/** QR code pour une URL d’invitation (même contenu que le lien cliquable). */
export const InviteQrCode: React.FC<InviteQrCodeProps> = ({
  url,
  isDarkMode,
  label,
  size = 120,
  className = '',
}) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    QRCode.toDataURL(url, {
      width: size,
      margin: 1,
      color: {
        dark: isDarkMode ? '#e2e8f0' : '#0f172a',
        light: isDarkMode ? '#0f172a' : '#ffffff',
      },
    })
      .then((u) => {
        if (!cancelled) setDataUrl(u);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, size, isDarkMode]);

  if (error || !dataUrl) {
    return (
      <div
        className={`flex items-center justify-center rounded border text-[10px] px-2 py-3 ${isDarkMode ? 'border-slate-600 text-slate-500' : 'border-slate-300 text-slate-500'} ${className}`}
        style={{ width: size, height: size }}
        role="img"
        aria-label={label || 'QR'}
      >
        …
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      <img src={dataUrl} width={size} height={size} alt="" className="rounded border border-slate-500/30" />
      {label ? (
        <span className={`text-[10px] text-center max-w-[140px] ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
          {label}
        </span>
      ) : null}
    </div>
  );
};

export default InviteQrCode;
