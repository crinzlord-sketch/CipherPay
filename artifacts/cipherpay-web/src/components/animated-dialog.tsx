import { AlertTriangle, Check, HelpCircle, X } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type DialogOptions = {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  destructive?: boolean;
  format?: 'grouped-number';
};

type DialogRequest =
  | (DialogOptions & {
      kind: 'confirm';
      resolve: (value: boolean | null) => void;
    })
  | (DialogOptions & {
      kind: 'prompt';
      resolve: (value: string | null) => void;
    });

type DialogContextValue = {
  confirm: (options: DialogOptions) => Promise<boolean>;
  prompt: (options: DialogOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function formatGroupedNumber(value: string) {
  const negative = value.trim().startsWith('-');
  const digits = value.replace(/\D/g, '');
  if (!digits) return negative ? '-' : '';
  return `${negative ? '-' : ''}${Number(digits).toLocaleString('en-US')}`;
}

function AnimatedDialog({ request, close }: { request: DialogRequest; close: (value: boolean | string | null) => void }) {
  const [value, setValue] = useState(() => request.format === 'grouped-number'
    ? formatGroupedNumber(request.defaultValue ?? '')
    : request.defaultValue ?? '');
  const isPrompt = request.kind === 'prompt';

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  return (
    <div className="animated-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(null); }}>
      <section className="animated-dialog" role="dialog" aria-modal="true" aria-labelledby="animated-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="animated-dialog-close" onClick={() => close(null)} aria-label="Close dialog">
          <X size={17} />
        </button>
        <span className={`animated-dialog-icon ${request.destructive ? 'destructive' : ''}`}>
          {request.destructive ? <AlertTriangle size={21} /> : isPrompt ? <HelpCircle size={21} /> : <Check size={21} />}
        </span>
        <h2 id="animated-dialog-title">{request.title}</h2>
        {request.description && <p>{request.description}</p>}
        {isPrompt && (
          <input
            autoFocus
            className="animated-dialog-input"
            value={value}
            placeholder={request.placeholder}
            inputMode={request.format === 'grouped-number' ? 'numeric' : undefined}
            onChange={(event) => setValue(request.format === 'grouped-number'
              ? formatGroupedNumber(event.target.value)
              : event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') close(value);
            }}
          />
        )}
        <div className="animated-dialog-actions">
          <button type="button" className="animated-dialog-button quiet" onClick={() => close(null)}>Cancel</button>
          <button type="button" className={`animated-dialog-button ${request.destructive ? 'danger' : 'primary'}`} onClick={() => close(isPrompt ? value : true)}>
            {request.confirmLabel ?? (isPrompt ? 'Continue' : 'Confirm')}
          </button>
        </div>
      </section>
    </div>
  );
}

export function AnimatedDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<DialogRequest | null>(null);

  const confirm = (options: DialogOptions) =>
    new Promise<boolean>((resolve) => setRequest({
      ...options,
      kind: 'confirm',
      resolve: (value) => resolve(value ?? false),
    }));
  const prompt = (options: DialogOptions) =>
    new Promise<string | null>((resolve) => setRequest({ ...options, kind: 'prompt', resolve }));
  const close = (value: boolean | string | null) => {
    if (!request) return;
    if (request.kind === 'confirm') request.resolve(typeof value === 'boolean' ? value : null);
    else request.resolve(typeof value === 'string' ? value : null);
    setRequest(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {request && <AnimatedDialog request={request} close={close} />}
    </DialogContext.Provider>
  );
}

export function useAnimatedDialog() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useAnimatedDialog must be used inside AnimatedDialogProvider');
  return context;
}