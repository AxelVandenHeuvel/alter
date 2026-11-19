/** Alter's logo (the extension icon), for brand marks inside the panel. */
export function Logo({ size, muted = false }: { size: number; muted?: boolean }) {
  return <img className={`logo ${muted ? 'logo--muted' : ''}`} src="/icon/128.png" width={size} height={size} alt="" />;
}
