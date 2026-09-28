import { AlertTriangle, Check, LoaderCircle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import './cipherpay-pages.css';

export function PageHeading({ eyebrow, title, detail, actions }: { eyebrow: string; title: string; detail: string; actions?: ReactNode }) {
  return <div className="cp-heading"><div><div className="cp-kicker">{eyebrow}</div><h1>{title}</h1><p>{detail}</p></div>{actions && <div className="cp-heading-actions">{actions}</div>}</div>;
}

export function Button({ children, variant = 'primary', className = '', ...props }: { children: ReactNode; variant?: 'primary' | 'soft' | 'quiet' | 'danger'; className?: string; [key: string]: unknown }) {
  return <button className={`cp-btn cp-btn-${variant} ${className}`} {...props as any}>{children}</button>;
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'error' }) {
  return <div className={`cp-notice ${tone === 'success' ? 'cp-notice-success' : tone === 'error' ? 'cp-notice-error' : ''}`} role={tone === 'error' ? 'alert' : 'status'}>{tone === 'success' ? <Check size={16} /> : tone === 'error' ? <AlertTriangle size={16} /> : null}<span>{children}</span></div>;
}

export function LoadingState({ label = 'Loading securely' }: { label?: string }) {
  return <div className="cp-card cp-state"><div className="cp-state-inner"><LoaderCircle className="cp-state-icon" size={44} /><h2>{label}</h2><div className="cp-skeleton" style={{ width: 180 }} /><div className="cp-skeleton" style={{ width: 110 }} /></div></div>;
}

export function ErrorState({ message = 'We could not load this view.', retry }: { message?: string; retry: () => void }) {
  return <div className="cp-card cp-state"><div className="cp-state-inner"><span className="cp-state-icon"><AlertTriangle size={21} /></span><h2>Something needs another look</h2><p>{message}</p><Button variant="soft" type="button" onClick={retry} data-testid="button-retry"><RefreshCw size={15} /> Try again</Button></div></div>;
}