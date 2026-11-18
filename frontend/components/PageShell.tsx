import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";

export default function PageShell({
  children,
  className = "",
  contentClassName = "",
  hideFooter = false,
}: {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  hideFooter?: boolean;
}) {
  return (
    <div className={`borderland-bg relative min-h-screen overflow-hidden text-bone ${className}`}>
      <SiteHeader />
      <div className={`relative z-10 ${contentClassName}`}>{children}</div>
      {!hideFooter && <SiteFooter />}
    </div>
  );
}
