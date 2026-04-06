/**
 * INET PMS Logo — inline SVG, no external image file needed.
 * Usage: <InetLogo size={40} /> or <InetLogo size={28} />
 */
export default function InetLogo({ size = 36, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="INET PMS"
    >
      <rect width="48" height="48" rx="12" fill="url(#inetGrad)" />
      {/* Signal tower / telecom icon */}
      <line x1="24" y1="38" x2="24" y2="22" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18 38h12" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      {/* Arc 1 */}
      <path d="M19 26a7 7 0 0 1 10 0" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* Arc 2 */}
      <path d="M14.5 21.5a13 13 0 0 1 19 0" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* Arc 3 */}
      <path d="M10 17a19 19 0 0 1 28 0" stroke="rgba(255,255,255,0.3)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <defs>
        <linearGradient id="inetGrad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2563eb" />
          <stop offset="1" stopColor="#7b6ff7" />
        </linearGradient>
      </defs>
    </svg>
  );
}
