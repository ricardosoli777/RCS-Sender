import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...values: ClassValue[]) { return twMerge(clsx(values)); }
const buttonVariants = cva('button', { variants: { variant: {
  primary: 'buttonPrimary', secondary: 'buttonSecondary', danger: 'buttonDanger'
} }, defaultVariants: { variant: 'primary' } });
export function Button({ className, variant, asChild, ...props }: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant }), className)} {...props} />;
}
export function Card({ className, ...props }: ComponentProps<'section'>) { return <section className={cn('card', className)} {...props} />; }
export function Badge({ children }: { children: React.ReactNode }) { return <span className="badge">{children}</span>; }
