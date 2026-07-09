import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: number;
  text?: string;
  className?: string;
}

export function Spinner({ size = 24, text, className = '' }: SpinnerProps) {
  return (
    <div className={`flex items-center gap-3 text-foreground/50 ${className}`} role="status">
      <Loader2 size={size} className="animate-spin text-primary" />
      {text && <span className="text-sm">{text}</span>}
    </div>
  );
}