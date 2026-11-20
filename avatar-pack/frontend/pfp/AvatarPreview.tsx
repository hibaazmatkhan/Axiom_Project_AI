type AvatarPreviewProps = {
  src?: string | null;
  label: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZES = {
  sm: "h-9 w-9 text-[10px]",
  md: "h-16 w-16 text-sm",
  lg: "h-28 w-28 text-2xl",
};

export default function AvatarPreview({ src, label, size = "md", className = "" }: AvatarPreviewProps) {
  const initials = label.slice(0, 2).toUpperCase();
  return (
    <div className={`relative grid shrink-0 place-items-center overflow-hidden border border-gold/40 bg-gradient-to-br from-gold/20 via-panel to-void ${SIZES[size]} ${className}`}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="font-display tracking-[0.08em] text-bone">{initials}</span>}
      <span className="absolute bottom-0.5 right-1 text-[9px] text-gold">&#9824;</span>
    </div>
  );
}
