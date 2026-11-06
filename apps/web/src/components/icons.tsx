import type { SVGProps } from "react";

/** Line icons from the mocks. Always decorative: the control next to them carries the label. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Shikigami's mark: a hitogata, the paper figure a shikigami lives in (the app icon's shape). */
export const LogoMark = (p: IconProps) => (
  <Icon strokeWidth={0} {...p}>
    <path
      fill="currentColor"
      d="M3.88 10.18 L9.48 8.92 L14.52 8.92 L20.12 10.18 L20.12 12.14 L15.08 12.0 L15.5 17.88 L16.34 22.08 L13.4 22.08 L12.0 18.44 L10.6 22.08 L7.66 22.08 L8.5 17.88 L8.92 12.0 L3.88 12.14 Z"
    />
    <circle fill="currentColor" cx="12.0" cy="5.14" r="3.22" />
  </Icon>
);
export const PlusIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const SearchIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
  </Icon>
);
export const TasksIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5" />
  </Icon>
);
export const MarketIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4h16l1 5H3l1-5Z" />
    <path d="M5 9v11h14V9" />
    <path d="M10 20v-5h4v5" />
  </Icon>
);
export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const WalletIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6" />
    <path d="M17 14h.01" />
  </Icon>
);
export const BoardIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4h16v16H4z" />
    <path d="M8 9h3M8 13h8M8 17h5" />
    <path d="M15 7v4" />
  </Icon>
);
export const LedgerIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Icon>
);
export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </Icon>
);
export const SendIcon = (p: IconProps) => (
  <Icon strokeWidth={2.2} {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </Icon>
);
export const CheckIcon = (p: IconProps) => (
  <Icon strokeWidth={2.5} {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
export const ChevronIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);
export const BackIcon = (p: IconProps) => (
  <Icon strokeWidth={2.2} {...p}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);
export const ShareIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </Icon>
);
export const ExitIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" />
  </Icon>
);
export const InfoIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);
export const PasskeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 11c0 3.5-1 6.5-2.5 8.5" />
    <path d="M8.5 6.8A5 5 0 0 1 17 10.5c0 1.6-.2 3.2-.6 4.7" />
    <path d="M6.6 9A6.9 6.9 0 0 0 6 11.7c0 1.9-.5 3.6-1.4 5" />
    <path d="M14.3 14.3c-.3 2-.9 3.9-1.8 5.5" />
    <path d="M12 3.5a7.5 7.5 0 0 1 7.5 7.5c0 .6 0 1.2-.1 1.8" />
  </Icon>
);
export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
);
export const GaugeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="M12 18l4-6" />
    <path d="M8 18h8" />
  </Icon>
);
export const MenuIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
export const CloseIcon = (p: IconProps) => (
  <Icon strokeWidth={2} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const PlaneIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.5 13.5 4 12l-1.5 1.5 6 3 3 6L13 21l-1.5-6.5L17 9c1.2-1.2 1.6-3 .9-3.9-.9-.7-2.7-.3-3.9.9z" />
  </Icon>
);
export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);
export const HotelIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 20V8l9-4 9 4v12M3 20h18M9 20v-5h6v5M8 10h.01M12 10h.01M16 10h.01" />
  </Icon>
);
export const PinIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);
export const StarIcon = (p: IconProps) => (
  <Icon {...p} fill="currentColor" strokeWidth={0}>
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />
  </Icon>
);

export const ImageIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m20.5 16-4.8-4.8a1.5 1.5 0 0 0-2.1 0L5 19.5" />
  </Icon>
);
export const ScanIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
  </Icon>
);
export const QrIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
  </Icon>
);
