interface BrandElementProps {
  appName: string;
  showText?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function BrandElement({
  appName,
  showText = false,
  className = "",
  size = "md",
}: BrandElementProps) {
  const boxSize = size === "sm" ? "w-8 h-8" : size === "lg" ? "w-14 h-14" : "w-10 h-10";

  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <div className={`${boxSize} flex items-center justify-center rounded-xl`}>
        <img
          src="/logo.png"
          alt={`${appName} logo`}
          className="size-full object-contain"
          width={56}
          height={56}
        />
      </div>
      {showText && <span className="text-sm font-semibold text-foreground">{appName}</span>}
    </div>
  );
}
