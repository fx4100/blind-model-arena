import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-primary text-on-primary hover:bg-blue-600 active:bg-blue-700 shadow-sm',
  secondary:
    'bg-transparent text-primary border border-primary hover:bg-primary/10 active:bg-primary/20',
  ghost:
    'bg-transparent text-foreground hover:bg-muted',
  destructive:
    'bg-destructive text-white hover:bg-red-600 active:bg-red-700',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1 text-sm rounded-xl font-semibold',
  md: 'px-4 py-2 text-base rounded-xl font-semibold',
  lg: 'px-6 py-3 text-lg rounded-xl font-bold',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`cursor-pointer font-medium inline-flex items-center justify-center gap-2
          ${variantClasses[variant]} ${sizeClasses[size]}
          ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
          ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';