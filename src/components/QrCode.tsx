import { useEffect, useState } from 'react';
import * as QRCode from 'qrcode';

interface QrCodeProps {
  text: string;
  size?: number;
  className?: string;
}

export function QrCode({ text, size = 260, className }: QrCodeProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      width: size,
      errorCorrectionLevel: 'L',
      color: { dark: '#0b0f14', light: '#ffffff' },
    })
      .then((value) => {
        if (!cancelled) setSvg(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [text, size]);

  if (failed) {
    return (
      <div className="qr-box qr-failed" style={{ width: size, height: size }}>
        <span>QR-код не помещается</span>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="qr-box qr-loading" style={{ width: size, height: size }}>
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className={className ? `qr-box ${className}` : 'qr-box'}
      style={{ width: size, height: size }}
      // SVG генерирует библиотека qrcode из переданного текста.
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label="QR-код"
    />
  );
}
