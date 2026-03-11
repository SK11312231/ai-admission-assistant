interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'dark' | 'white';
  className?: string;
}

function LogoMark({ size, variant = 'default' }: { size: number; variant?: string }) {
  const isWhite = variant === 'white';
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 60 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="inquiai-grad" x1="0" y1="0" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isWhite ? 'rgba(255,255,255,0.2)' : '#4F46E5'} />
          <stop offset="100%" stopColor={isWhite ? 'rgba(255,255,255,0.1)' : '#7C3AED'} />
        </linearGradient>
      </defs>

      {/* Background */}
      <rect width="60" height="60" rx="16" fill="url(#inquiai-grad)" />

      {/* Graduation cap — flat diamond top */}
      <polygon points="30,10 54,22 30,34 6,22" fill="white" opacity="0.95" />

      {/* Signal arcs below cap */}
      <path d="M 20 38 Q 20 50 30 50"
        stroke="rgba(255,255,255,0.55)" strokeWidth="2.5"
        strokeLinecap="round" fill="none" />
      <path d="M 40 38 Q 40 50 30 50"
        stroke="rgba(255,255,255,0.55)" strokeWidth="2.5"
        strokeLinecap="round" fill="none" />

      {/* Signal centre dot */}
      <circle cx="30" cy="50" r="2.5" fill="white" />

      {/* Tassel string */}
      <line x1="54" y1="22" x2="54" y2="34"
        stroke="white" strokeWidth="2.5" strokeLinecap="round" />

      {/* Tassel amber dot */}
      <circle cx="54" cy="37" r="3.5" fill="#fbbf24" />
    </svg>
  );
}

export default function Logo({ size = 'md', variant = 'default', className = '' }: LogoProps) {
  const config = {
    sm: { iconSize: 30, fontSize: '18px', gap: '9px' },
    md: { iconSize: 38, fontSize: '22px', gap: '11px' },
    lg: { iconSize: 54, fontSize: '32px', gap: '14px' },
  }[size];

  const inquiColor =
    variant === 'dark'  ? '#e2e8f0'
    : variant === 'white' ? 'rgba(255,255,255,0.9)'
    : '#1e1b4b';

  const aiColor =
    variant === 'dark'  ? '#818cf8'
    : variant === 'white' ? '#ffffff'
    : '#4F46E5';

  return (
    <div
      className={`flex items-center select-none ${className}`}
      style={{ gap: config.gap }}
    >
      <LogoMark size={config.iconSize} variant={variant} />
      <span style={{ lineHeight: 1, letterSpacing: '-0.02em' }}>
        <span style={{
          fontFamily: "'Sora', 'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: config.fontSize,
          fontWeight: 700,
          color: inquiColor,
        }}>Inqui</span>
        <span style={{
          fontFamily: "'Sora', 'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: config.fontSize,
          fontWeight: 800,
          color: aiColor,
        }}>AI</span>
      </span>
    </div>
  );
}
