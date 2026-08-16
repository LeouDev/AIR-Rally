/**
 * Hand-drawn, simplified brand glyphs for the share sheet — not official
 * brand-kit assets (none are installed as a dependency and none are
 * fetched from the network), just recognizable approximations in each
 * platform's characteristic color, same spirit as any generic share-sheet
 * icon set.
 */

export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ig-grad" x1="0" y1="24" x2="24" y2="0">
          <stop offset="0" stopColor="#FEDA75" />
          <stop offset="0.5" stopColor="#D62976" />
          <stop offset="1" stopColor="#4F5BD5" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="18" height="18" rx="5" stroke="url(#ig-grad)" strokeWidth="2" />
      <circle cx="12" cy="12" r="4.2" stroke="url(#ig-grad)" strokeWidth="2" />
      <circle cx="17.4" cy="6.6" r="1.2" fill="url(#ig-grad)" />
    </svg>
  );
}

export function MessengerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 2.04C6.5 2.04 2 6.13 2 11.14c0 2.85 1.44 5.4 3.7 7.06V22l3.4-1.87c.91.25 1.87.39 2.9.39 5.5 0 10-4.09 10-9.13S17.5 2.04 12 2.04Z"
        fill="#006AFF"
      />
      <path d="m6.8 13.87 3.4-3.6 2.6 2 3.4-3.6-3.4 5.87-2.6-2Z" fill="#fff" />
    </svg>
  );
}

export function IMessageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M12 3C6.5 3 2 6.8 2 11.5c0 2.6 1.4 5 3.6 6.6-.1 1-.5 2.4-1.3 3.4 1.5-.1 3-.7 4.1-1.4.9.2 1.7.4 2.6.4 5.5 0 10-3.8 10-8.5S17.5 3 12 3Z"
        fill="#0A84FF"
      />
    </svg>
  );
}

export function ThreadsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <text x="12" y="17.5" textAnchor="middle" fontSize="17" fontWeight="700" fill="#000">
        @
      </text>
    </svg>
  );
}

export function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.9 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

export function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.6 5.82c-1.1-1.2-1.66-2.6-1.66-4.3l-.01-.52h-3.32v14.5a2.6 2.6 0 1 1-1.85-2.49V9.66c-.32-.05-.65-.07-.99-.07-3.45 0-6.24 2.79-6.24 6.24s2.79 6.24 6.24 6.24 6.24-2.79 6.24-6.24V9.01c1.29.92 2.8 1.38 4.3 1.38V7.06c-.98 0-1.87-.32-2.71-1.24Z" />
    </svg>
  );
}
