import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AnimatedDialogProvider, useAnimatedDialog } from './components/animated-dialog';
import SmsVerification from './pages/SmsVerification';
import TemporaryEmail from './pages/TemporaryEmail';
import { KycPage } from './pages/KycPage';
import { SupportPage } from './pages/SupportPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import AdminConsole from './pages/AdminConsole';
import ServicesPage from './pages/ServicesPage';
import SocialBoostPage from './pages/SocialBoostPage';
import EmailProPage from './pages/EmailProPage';
import ChatPage from './pages/ChatPage';
import BillsPage from './pages/BillsPage';
import { apiRequest, apiUrl } from './pages/page-api';
import { CipherAvatar } from './components/CipherAvatar';
import {
  useBuyAirtime, useBuyData, useBuySmsNumber, useChangePassword, useFundWallet,
  useFundWalletBankTransfer, useGetDashboardSummary, useGetKycStatus, useGetMe,
  useGetWallet, useGetWalletStats, useListBillCategories, useListBillProviders,
  useListBanks, useListDataPlans, useListNetworks, useListSmsCountries,
  useListSmsHistory, useListSmsServices, useListTransactions, useLogin,
  usePayBill, useRegister, useSendOtp, useSubmitKyc, useUpdateProfile,
  useValidateBill,
  useVerifyOtp, useWalletTransfer, useWithdrawFunds,
} from '@workspace/api-client-react';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';
import {
  Activity, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Banknote,
  Bell, Bolt, Check, CircleHelp, Copy, CreditCard, FileText,
  Fingerprint, Globe2, Home, Landmark, LockKeyhole, LogOut, Menu, MessageSquare,
  Layers3, MoreHorizontal, Network as NetworkIcon, Plus, Receipt, RefreshCw, Send as SendIcon,
  Settings, ShieldCheck, Smartphone, Target, Tv, UserRound, WalletCards, Wifi, X, Eye, EyeOff,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useRoute } from 'wouter';
import './landing.css';

const queryClient = new QueryClient();
setBaseUrl((import.meta.env.VITE_API_URL ?? '').trim() || null);
const OTP_RESEND_SECONDS = 30;
const BALANCE_VISIBILITY_STORAGE_KEY = 'cipherpay_balance_visible';
const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 2 });
const authDraft: { email: string; password: string } = { email: '', password: '' };
const formatGroupedDigits = (value: string | number) => {
  const digits = String(value).replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('en-US') : '';
};
const parseGroupedDigits = (value: string) => Number(value.replace(/,/g, '')) || 0;
const nav = [
  { href: '/', label: 'Overview', icon: Home },
  { href: '/fund', label: 'Fund wallet', icon: Plus },
  { href: '/send', label: 'Send money', icon: SendIcon },
  { href: '/chat', label: 'Find & chat', icon: MessageSquare },
  { href: '/airtime', label: 'Airtime & data', icon: Smartphone },
  { href: '/bills', label: 'Pay bills', icon: Receipt },
  { href: '/sms', label: 'SMS verification', icon: MessageSquare },
  { href: '/temporary-email', label: 'Temporary email', icon: Globe2 },
  { href: '/services', label: 'Services', icon: Layers3 },
  { href: '/transactions', label: 'Transactions', icon: Activity },
];
const utilityNav = [
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/profile', label: 'Profile', icon: UserRound },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/kyc', label: 'Identity & KYC', icon: ShieldCheck },
  { href: '/support', label: 'Support', icon: CircleHelp },
  { href: '/admin', label: 'Admin console', icon: LockKeyhole },
];

function useToken() {
  return typeof window !== 'undefined' ? window.localStorage.getItem('cipherpay_token') : null;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className={`brand ${compact ? 'brand-compact' : ''}`} data-testid="link-brand">
    <span className="brand-mark"><span /></span><span>Cipher<span className="brand-orange">Pay</span></span>
  </Link>;
}

function Field({ label, ...props }: { label: string; [key: string]: unknown }) {
  return <label className="field"><span>{label}</span><input {...props as any} /></label>;
}

function Button({ children, className = '', variant = 'primary', ...props }: { children: ReactNode; className?: string; variant?: string; [key: string]: unknown }) {
  return <button className={`btn btn-${variant} ${className}`} {...props as any}>{children}</button>;
}

function PageTitle({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{detail && <p>{detail}</p>}</div>{action}</div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const { confirm } = useAnimatedDialog();
  const me = useGetMe({ query: { enabled: !!useToken(), queryKey: ['/api/auth/me'] } });
  const user = me.data as any;
  const initials = user ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}` : 'CP';
  useEffect(() => {
    document.documentElement.classList.toggle('menu-open', mobileOpen);
    document.body.classList.toggle('menu-open', mobileOpen);
    return () => {
      document.documentElement.classList.remove('menu-open');
      document.body.classList.remove('menu-open');
    };
  }, [mobileOpen]);
  useEffect(() => {
    let active = true;
    const checkSession = async () => {
      const token = useToken();
      if (!token) return;
      try {
        const response = await fetch(apiUrl('/api/auth/me'), {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
          cache: 'no-store',
        });
        if (response.status === 401) {
          localStorage.removeItem('cipherpay_token');
          sessionStorage.removeItem('cipherpay_admin_token');
          queryClient.clear();
          if (active) setLocation('/login');
        }
      } catch {
        // Do not log users out on a temporary network failure.
      }
    };
    void checkSession();
    const interval = window.setInterval(() => void checkSession(), 10_000);
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'cipherpay_token' && event.newValue === null) {
        queryClient.clear();
        setLocation('/login');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, [setLocation]);

  useEffect(() => {
    let active = true;
    const loadUnreadCount = async () => {
      if (!useToken()) {
        if (active) setUnreadNotifications(0);
        return;
      }
      try {
        const response = await apiRequest<{ unread: number }>('/api/notifications/unread-count');
        if (active) setUnreadNotifications(Number(response.unread ?? 0));
      } catch {
        if (active) setUnreadNotifications(0);
      }
    };
    void loadUnreadCount();
    const interval = window.setInterval(() => void loadUnreadCount(), 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [location]);
  const logout = async () => {
    const confirmed = await confirm({
      title: 'Log out of CipherPay?',
      description: 'You will need to sign in again to access your account.',
      confirmLabel: 'Log out',
      destructive: true,
    });
    if (!confirmed) return;
    localStorage.removeItem('cipherpay_token');
    queryClient.clear();
    setLocation('/login');
  };
  const linkList = (items: typeof nav) => items.map(({ href, label, icon: Icon }) => (
    <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`nav-item ${location === href ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
    </Link>
  ));
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-top"><Logo compact /><button className="icon-btn mobile-close" onClick={() => setMobileOpen(false)} data-testid="button-close-menu"><X size={19} /></button></div>
      <div className="nav-group"><span className="nav-caption">ALL</span>{linkList(nav)}</div>
      <div className="nav-group"><span className="nav-caption">Account</span>{linkList(utilityNav.filter((item) => item.href !== '/admin' || user?.isAdmin))}</div>
      <div className="sidebar-bottom">
        {user && <div className="user-menu-wrap">
          <button className="user-row" onClick={() => setUserMenuOpen((open) => !open)} aria-expanded={userMenuOpen} aria-haspopup="menu" data-testid="button-user-menu">
            <CipherAvatar src={user.avatarUrl} seed={user.id || user.email} gender={user.gender} size={38} alt="" /><span className="user-copy"><b>{user.firstName} {user.lastName}</b><small>{user.email}</small></span><MoreHorizontal size={17} />
          </button>
          {userMenuOpen && <div className="user-menu" role="menu" aria-label="Account menu">
            <button type="button" className="user-menu-item" role="menuitem" onClick={() => { setUserMenuOpen(false); setLocation('/profile'); }} data-testid="button-user-profile"><UserRound size={16} /><span>Profile</span></button>
            <button type="button" className="user-menu-item user-menu-logout" role="menuitem" onClick={() => { setUserMenuOpen(false); void logout(); }} data-testid="button-user-logout"><LogOut size={16} /><span>Log out</span></button>
          </div>}
        </div>}
      </div>
    </aside>
    {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-scrim" />}
    <main className="main-area">
       <header className="topbar"><button className="icon-btn menu-toggle" onClick={() => setMobileOpen(true)} data-testid="button-open-menu"><Menu size={21} /></button><div className="mobile-logo"><Logo /></div><div className="topbar-spacer" /><button type="button" className="icon-btn notification-button" onClick={() => setLocation(location === '/notifications' ? '/' : '/notifications')} aria-label={location === '/notifications' ? 'Close notifications' : unreadNotifications > 0 ? `Open notifications, ${unreadNotifications} unread` : 'Open notifications'} aria-pressed={location === '/notifications'} data-testid="button-notifications"><Bell size={19} />{unreadNotifications > 0 && <i />}</button>{user && <span className="topbar-name">{user.firstName}</span>}<button className="logout-link" onClick={() => void logout()} data-testid="button-logout"><LogOut size={16} /> <span>Log out</span></button></header>
      <div className="content">{children}</div>
    </main>
  </div>;
}

function AuthLayout({ children, title, detail }: { children: ReactNode; title: string; detail: string }) {
  const [location] = useLocation();
  const routeName = location.split('?')[0].replace('/', '') || 'auth';
  const authMode = routeName === 'register' ? 'register' : routeName === 'login' ? 'login' : 'recovery';
  return <div className={`auth-page auth-page-${authMode}`} data-auth-route={routeName}>
    <div className="auth-visual">
      <Logo />
      <div className="auth-visual-grid" aria-hidden="true" />
      <div className="auth-visual-ring auth-visual-ring-one" aria-hidden="true" />
      <div className="auth-visual-ring auth-visual-ring-two" aria-hidden="true" />
      <div className="orb orb-one" /><div className="orb orb-two" />
      <div className="auth-quote"><span className="auth-overline">CIPHERPAY</span><span className="quote-mark">“</span><h2>Your digital<br /><em>sidekick.</em></h2><p>One calm place to fund, spend, send, and stay in control.</p><div className="auth-benefits"><span><b>01</b> Move with clarity</span><span><b>02</b> Stay protected</span><span><b>03</b> Keep momentum</span></div></div><div className="auth-footer"><span>Built for the way life moves.</span><span>© 2025 CipherPay</span></div>
    </div>
    <div className="auth-form-wrap"><div className="auth-form-inner"><div className="mobile-auth-brand"><Logo /></div><div className="eyebrow">CIPHERPAY / PERSONAL</div><h1>{title}</h1><p className="auth-detail">{detail}</p>{children}<p className="auth-legal">By continuing, you agree to our Terms and Privacy Policy.</p></div></div>
  </div>;
}

function LandingPage() {
  const features = [
    { icon: WalletCards, title: 'One wallet. More control.', text: 'Fund your CipherPay wallet and keep everyday activity in one clear place.' },
    { icon: Receipt, title: 'Bills without the friction.', text: 'Handle airtime, data and bill payments through focused, simple flows.' },
    { icon: MessageSquare, title: 'Connect instantly.', text: 'Find people by CipherPay code and chat with text, images, GIFs and replies.' },
    { icon: Smartphone, title: 'SMS verification.', text: 'Access practical digital services from one account instead of juggling tools.' },
  ];
  return <div className="cp-landing">
    <div className="cp-landing-grid" aria-hidden="true" />
    <nav className="cp-landing-nav" aria-label="Landing navigation">
      <div className="cp-landing-nav-inner">
        <Logo />
        <div className="cp-landing-links"><a href="#features">Features</a><a href="#experience">Experience</a><a href="#security">Security</a><Link href="/support">Support</Link></div>
        <div className="cp-landing-nav-actions"><Link className="cp-land-btn ghost" href="/login">Log in</Link><Link className="cp-land-btn primary" href="/register">Get started <ArrowRight size={15}/></Link></div>
      </div>
    </nav>
    <section className="cp-hero">
      <div className="cp-hero-copy">
        <span className="cp-kicker"><i/> EVERYTHING, IN ONE PLACE</span>
        <h1>Less friction.<span>More life.</span></h1>
        <p>CipherPay brings your wallet, payments, digital services and communication together in one beautifully simple platform.</p>
        <div className="cp-hero-actions"><Link className="cp-land-btn primary" href="/register">Create your account <ArrowRight size={17}/></Link><Link className="cp-land-btn ghost" href="/login">I already have an account</Link></div>
        <div className="cp-hero-note"><span><ShieldCheck size={13}/> Built around control</span><span><Bolt size={13}/> Fast everyday tools</span></div>
      </div>
      <div className="cp-orbit-stage">
        <div className="cp-orbit-glow"/><div className="cp-orbit"/><div className="cp-orbit two"/>
        <div className="cp-wallet-card">
          <div className="cp-card-top"><span className="cp-card-label">CIPHERPAY / WALLET</span><span className="cp-card-chip"/></div>
          <div className="cp-card-balance"><small>AVAILABLE BALANCE</small>₦24,680.00</div>
          <div className="cp-card-bottom"><span>READY WHEN YOU ARE</span><span className="cp-card-orb"/></div>
        </div>
        <div className="cp-float-pill one"><i className="cp-dot"/> <strong>Payment complete</strong></div>
        <div className="cp-float-pill two"><Globe2 size={15}/> <strong>Digital services</strong></div>
      </div>
    </section>
    <section className="cp-section" id="features">
      <div className="cp-section-head"><div><span className="cp-kicker">THE CIPHERPAY SYSTEM</span><h2>Everything you need.<br/>Nothing you don't.</h2></div><p>Designed to feel calm even when your day isn't. Every tool has a clear purpose, every flow gets out of your way.</p></div>
      <div className="cp-feature-grid">{features.map(({icon:Icon,title,text})=><article className="cp-feature" key={title}><span className="cp-feature-icon"><Icon size={20}/></span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>
    <section className="cp-section" id="experience">
      <div className="cp-showcase">
        <article className="cp-show-card"><span className="cp-kicker">A BETTER DEFAULT</span><h3>Small details. Big difference.</h3><p>Animated states, clear confirmations and focused screens make the platform feel responsive instead of mechanical.</p>
        <div className="cp-toggle-demo"><span>Stay in control</span><span className="cp-toggle"><i/></span></div>
        <div className="cp-mini-list"><div className="cp-mini-row"><ShieldCheck size={16}/><span>Protected account</span><span>Ready</span></div><div className="cp-mini-row"><RefreshCw size={16}/><span>Live service flow</span><span>Active</span></div></div></article>
        <article className="cp-show-card large" id="security"><span className="cp-kicker">ONE ACCOUNT / MANY TOOLS</span><h3>Your digital sidekick, without the cringe.</h3><p>Move from funding to payments, verification, chat and digital services without losing the thread. CipherPay keeps the important pieces close and the clutter out of sight.</p><div className="cp-mini-list"><div className="cp-mini-row"><WalletCards size={16}/><span>Wallet & transfers</span><span>01</span></div><div className="cp-mini-row"><Receipt size={16}/><span>Bills & airtime</span><span>02</span></div><div className="cp-mini-row"><MessageSquare size={16}/><span>Find & chat</span><span>03</span></div><div className="cp-mini-row"><Globe2 size={16}/><span>Digital services</span><span>04</span></div></div></article>
      </div>
    </section>
    <section className="cp-section"><div className="cp-cta"><span className="cp-kicker">CIPHERPAY</span><h2>Make everyday feel simpler.</h2><p>One place for the things you do often, with an interface that gets out of your way.</p><div className="cp-hero-actions"><Link className="cp-land-btn primary" href="/register">Get started <ArrowRight size={17}/></Link><Link className="cp-land-btn ghost" href="/login">Log in</Link></div></div></section>
    <footer className="cp-footer"><span>© 2026 CipherPay</span><span>Payments · Digital services · Communication</span></footer>
    <section className="cp-endcap" aria-label="CipherPay closing section">
      <div className="cp-endcap-inner">
        <div><span className="cp-kicker">KEEP MOVING</span><h2>One account.<br/><span>Less to think about.</span></h2></div>
        <Link className="cp-endcap-link" href="/register">Get started <ArrowRight size={17}/></Link>
      </div>
      <div className="cp-endcap-word">CIPHERPAY</div>
    </section>
    <section className="cp-endcap" aria-label="CipherPay closing section">
      <div className="cp-endcap-inner">
        <div><span className="cp-kicker">KEEP MOVING</span><h2>One account.<br/><span>Less to think about.</span></h2></div>
        <Link className="cp-endcap-link" href="/register">Get started <ArrowRight size={17}/></Link>
      </div>
      <div className="cp-endcap-word">CIPHERPAY</div>
    </section>
  </div>;
}

function MobileWelcome() {
  return <main className="mobile-welcome">
    <div className="mobile-welcome-orb mobile-welcome-orb-one" />
    <div className="mobile-welcome-orb mobile-welcome-orb-two" />
    <div className="mobile-welcome-grid" aria-hidden="true" />
    <div className="mobile-welcome-ring mobile-welcome-ring-one" aria-hidden="true" />
    <div className="mobile-welcome-ring mobile-welcome-ring-two" aria-hidden="true" />
    
    <div className="mobile-welcome-inner">
      <Logo />
      <div className="mobile-welcome-copy">
        <span className="mobile-welcome-overline">CIPHERPAY</span>
        <h1>Your digital<br /><em>sidekick.</em></h1>
        <p>Fund your wallet, send with confidence, and handle payments in one secure place.</p>
      </div>
      <div className="mobile-welcome-pills" aria-label="CipherPay features">
        <span>Send</span><span>Pay</span><span>Stay in control</span>
      </div>
      <div className="mobile-welcome-actions">
        <Link href="/login" className="mobile-welcome-primary">Continue to CipherPay <ArrowRight size={17} /></Link>
        <Link href="/register" className="mobile-welcome-secondary">Create an account</Link>
      </div>
      <p className="mobile-welcome-legal">Simple tools for the way life moves.</p>
    </div>
  </main>;
}

function MobileEntryGate() {
  const [, setLocation] = useLocation();
  const token = useToken();
  const [isMobile, setIsMobile] = useState<boolean | null>(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 600px)').matches : null
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(max-width: 600px)');
    const update = () => {
      setIsMobile(query.matches);
      if (!query.matches && !useToken()) setLocation('/login');
    };
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, [setLocation]);

  if (token) return <ProtectedArea><Dashboard /></ProtectedArea>;
  if (isMobile) return <MobileWelcome />;
  return <LoadingPage title="Opening sign in" />;
}

type BuddyGaze = { x: number; y: number };
type BuddyMood = 'idle' | 'success' | 'error';

function updateBuddyGaze(input: HTMLInputElement, buddy: HTMLDivElement | null, setGaze: (gaze: BuddyGaze) => void) {
  if (!buddy) return;
  const style = window.getComputedStyle(input);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;
  context.font = style.font;
  const caretIndex = input.selectionStart ?? input.value.length;
  const textWidth = context.measureText(input.value.slice(0, caretIndex)).width;
  const leftPadding = Number.parseFloat(style.paddingLeft) || 0;
  const rightPadding = Number.parseFloat(style.paddingRight) || 0;
  const caretOffset = Math.max(leftPadding, Math.min(input.clientWidth - rightPadding, leftPadding + textWidth - input.scrollLeft));
  const inputRect = input.getBoundingClientRect();
  const buddyRect = buddy.getBoundingClientRect();
  const targetX = inputRect.left + caretOffset;
  const targetY = inputRect.top + inputRect.height / 2;
  const originX = buddyRect.left + buddyRect.width / 2;
  const originY = buddyRect.top + buddyRect.height / 2;
  const angle = Math.atan2(targetY - originY, targetX - originX);
  setGaze({ x: Math.cos(angle) * 6, y: Math.sin(angle) * 4 });
}

function AuthBuddy({ field, hasText, gaze = { x: 0, y: 3 }, typing = false, mood = 'idle', buddyRef }: { field: 'email' | 'name' | 'password' | 'idle'; hasText: boolean; gaze?: BuddyGaze; typing?: boolean; mood?: BuddyMood; buddyRef?: RefObject<HTMLDivElement | null> }) {
  const isPassword = field === 'password';
  const eyeStyle = { '--buddy-eye-x': `${gaze.x}px`, '--buddy-eye-y': `${gaze.y}px` } as CSSProperties;
  return <div ref={buddyRef} className={`auth-buddy ${isPassword ? 'covering' : ''} ${hasText ? 'awake' : ''} mood-${mood} ${typing ? 'typing' : ''}`} aria-hidden="true">
    <div className="buddy-aura" />
    <div className="buddy-ear buddy-ear-left" /><div className="buddy-ear buddy-ear-right" />
    <div className="buddy-face">
      <span className="buddy-hair" />
      <span className="buddy-eye buddy-eye-left" style={eyeStyle}><i className="buddy-pupil" /></span><span className="buddy-eye buddy-eye-right" style={eyeStyle}><i className="buddy-pupil" /></span>
      <span className="buddy-cheek buddy-cheek-left" /><span className="buddy-cheek buddy-cheek-right" />
      <span className="buddy-mouth" />
      <span className="buddy-paw buddy-paw-left"><i /><i /></span><span className="buddy-paw buddy-paw-right"><i /><i /></span>
    </div>
  </div>;
}

function Login() {
  const [, setLocation] = useLocation();
  const mutation = useLogin();
  const [email, setEmail] = useState(authDraft.email);
  const [password, setPassword] = useState(authDraft.password);
  const [code, setCode] = useState('');
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpNotice, setOtpNotice] = useState('');
  const [otpPending, setOtpPending] = useState(false);
  const [otpResendPending, setOtpResendPending] = useState(false);
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [activeField, setActiveField] = useState<'email' | 'password' | 'idle'>('idle');
  const [gaze, setGaze] = useState<BuddyGaze>({ x: 0, y: 3 });
  const [typing, setTyping] = useState(false);
  const [faceMood, setFaceMood] = useState<BuddyMood>('idle');
  const [faceReaction, setFaceReaction] = useState(0);
  const buddyRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (otpResendCooldown <= 0) return;
    const timer = window.setInterval(() => setOtpResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [otpResendCooldown]);
  const trackInput = (event: any) => {
    setFaceMood('idle');
    updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze);
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 260);
  };
  const reactFace = (mood: Exclude<BuddyMood, 'idle'>) => {
    setFaceMood('idle');
    setFaceReaction((value) => value + 1);
    window.requestAnimationFrame(() => setFaceMood(mood));
  };

  const acceptSession = (token: string, adminToken?: string) => {
    localStorage.setItem('cipherpay_token', token);
    if (adminToken) sessionStorage.setItem('cipherpay_admin_token', adminToken);
    setLocation('/');
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setActiveField('idle');
    mutation.mutate(
      { data: { email, password } },
      {
        onSuccess: (result: any) => {
          if (result.requiresOtp) {
            reactFace('success');
            setOtpRequired(true);
            setOtpResendCooldown(OTP_RESEND_SECONDS);
            setOtpNotice(result.otpDelivery === 'email'
              ? `We sent a six-digit code to ${result.email ?? email}.`
              : 'We could not email a sign-in code. Please contact support.');
            return;
          }
          if (result.requiresEmailVerification) {
            reactFace('success');
            setLocation(`/verify-email?email=${encodeURIComponent(result.email ?? email.trim().toLowerCase())}`);
            return;
          }
          if (!result.token) {
            setError('Sign-in did not return a session. Please try again.');
            return;
          }
           acceptSession(result.token, result.adminToken);
        },
         onError: (reason: any) => { reactFace('error'); setError(reason?.message ?? 'We could not sign you in. Check your details and try again.'); },
      },
    );
  };
  const verifyLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setOtpPending(true);
    try {
      const response = await fetch(apiUrl('/api/auth/verify-login-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const result = await response.json().catch(() => null);
       if (!response.ok) throw new Error(result?.error ?? 'The code could not be verified.');
      if (!result?.token) throw new Error('The server did not return a sign-in session.');
       reactFace('success');
       acceptSession(result.token, result.adminToken);
    } catch (reason: any) {
       reactFace('error');
      setError(reason?.message ?? 'The code could not be verified.');
    } finally {
      setOtpPending(false);
    }
  };
  const resendLogin = async () => {
    if (otpResendCooldown > 0 || otpResendPending) return;
    setError('');
    setOtpResendPending(true);
    try {
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, resend: true }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? 'We could not resend the sign-in code.');
      setOtpNotice(result?.otpDelivery === 'email'
        ? `A new six-digit code was sent to ${email}.`
        : 'We could not email a sign-in code. Please contact support.');
      setOtpResendCooldown(OTP_RESEND_SECONDS);
    } catch (reason: any) {
      setError(reason?.message ?? 'We could not resend the sign-in code.');
    } finally {
      setOtpResendPending(false);
    }
  };
  return <AuthLayout title={otpRequired ? 'Verify your sign-in.' : 'Welcome back.'} detail={otpRequired ? 'Enter the one-time code to finish signing in.' : 'Sign in to continue to CipherPay.'}>
    {otpRequired
       ? <form className="auth-form" onSubmit={verifyLogin}>
         <AuthBuddy key={`login-buddy-${faceReaction}`} field="idle" hasText gaze={{ x: 0, y: 0 }} mood={faceMood} buddyRef={buddyRef} />
        <div className="otp-notice" role="status">{otpNotice}</div>
        <Field label="Six-digit code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={(event: any) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required data-testid="input-login-otp" />
        {error && <div className="error-box" role="alert">{error}</div>}
        <Button type="submit" className="full-btn" disabled={otpPending || code.length !== 6} data-testid="button-verify-login-otp">{otpPending ? 'Verifying…' : 'Verify and sign in'} <ArrowRight size={17} /></Button>
        <button type="button" className="text-link back-to-login" onClick={() => void resendLogin()} disabled={otpResendPending || otpResendCooldown > 0}>{otpResendPending ? 'Sending…' : otpResendCooldown > 0 ? `Resend code in ${otpResendCooldown}s` : 'Resend code'}</button>
        <button type="button" className="text-link back-to-login" onClick={() => { setOtpRequired(false); setCode(''); setError(''); }}>Back to sign in</button>
      </form>
      : <form className="auth-form" onSubmit={submit}>
           <AuthBuddy key={`login-buddy-${faceReaction}`} field={activeField} hasText={Boolean(email || password)} gaze={gaze} typing={typing} mood={faceMood} buddyRef={buddyRef} />
          <Field label="Email address" type="email" autoComplete="email" placeholder="you@example.com" value={email} onFocus={(event: any) => { setActiveField('email'); trackInput(event); }} onSelect={trackInput} onChange={(event: any) => { const value = event.target.value; authDraft.email = value; setEmail(value); setActiveField('email'); trackInput(event); }} required data-testid="input-email" />
           <label className="field"><span>Password</span><div className="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Your password" value={password} onFocus={(event: any) => { setActiveField('password'); trackInput(event); }} onSelect={trackInput} onChange={(event: any) => { const value = event.target.value; authDraft.password = value; setPassword(value); setActiveField('password'); trackInput(event); }} required data-testid="input-password" /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-toggle-password">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <div className="form-between"><label className="check"><input type="checkbox" /> Keep me signed in</label><Link href="/forgot-password" className="text-link" data-testid="link-forgot-password">Forgot password?</Link></div>
        {error && <div className="error-box" role="alert">{error}</div>}
        <Button type="submit" className="full-btn" disabled={mutation.isPending} data-testid="button-login">{mutation.isPending ? 'Signing in…' : 'Sign in'} <ArrowRight size={17} /></Button>
      </form>}
    {!otpRequired && <p className="auth-switch">New to CipherPay? <Link href="/register" className="text-link" data-testid="link-register">Create an account</Link></p>}
  </AuthLayout>;
}

function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/api/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? 'We could not send a reset code.');
      setLocation(`/reset-password?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (reason: any) {
      setError(reason?.message ?? 'We could not send a reset code.');
    } finally {
      setPending(false);
    }
  };

  return <AuthLayout title="Reset your password." detail="We’ll send a six-digit code to your registered email address.">
    <form className="auth-form" onSubmit={submit}>
      <Field label="Email address" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event: any) => setEmail(event.target.value)} required data-testid="input-forgot-email" />
      {error && <div className="error-box" role="alert">{error}</div>}
      <Button type="submit" className="full-btn" disabled={pending} data-testid="button-forgot-password">{pending ? 'Sending code…' : 'Send reset code'} <ArrowRight size={17} /></Button>
      <Link href="/login" className="text-link back-to-login" data-testid="link-back-to-login">Back to sign in</Link>
    </form>
  </AuthLayout>;
}

function VerifyEmail() {
  const [, setLocation] = useLocation();
  const email = new URLSearchParams(window.location.search).get('email') ?? '';
  const verify = useVerifyOtp();
  const resend = useSendOtp();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendCooldown, setResendCooldown] = useState(OTP_RESEND_SECONDS);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    verify.mutate(
      { data: { target: email, code } },
      {
        onSuccess: () => setLocation('/'),
        onError: (reason: any) => setError(reason?.message ?? 'The verification code could not be confirmed.'),
      },
    );
  };

  const resendCode = () => {
    setError('');
    setNotice('');
    resend.mutate(
      { data: { target: email, type: 'email', purpose: 'verification' } },
      {
        onSuccess: () => {
          setNotice('A new verification code has been sent to your email.');
          setResendCooldown(OTP_RESEND_SECONDS);
        },
        onError: (reason: any) => setError(reason?.message ?? 'We could not resend the verification code.'),
      },
    );
  };

  return <AuthLayout title="Check your email." detail={email ? `We sent a verification code to ${email}.` : 'Enter the code from your verification email.'}>
    <form className="auth-form" onSubmit={submit}>
      <Field label="Six-digit verification code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={(event: any) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required data-testid="input-email-otp" />
      {error && <div className="error-box" role="alert">{error}</div>}
      {notice && <div className="success-box" role="status">{notice}</div>}
      <Button type="submit" className="full-btn" disabled={verify.isPending || code.length !== 6 || !email} data-testid="button-verify-email">{verify.isPending ? 'Verifying…' : 'Verify email'} <ArrowRight size={17} /></Button>
      <button type="button" className="text-link back-to-login" onClick={resendCode} disabled={resend.isPending || resendCooldown > 0 || !email}>{resend.isPending ? 'Sending…' : resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}</button>
      <Link href="/login" className="text-link back-to-login">Back to sign in</Link>
    </form>
  </AuthLayout>;
}

function ResetPassword() {
  const [, setLocation] = useLocation();
  const email = new URLSearchParams(window.location.search).get('email') ?? '';
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resendCooldown, setResendCooldown] = useState(OTP_RESEND_SECONDS);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const resend = async () => {
    setResending(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(apiUrl('/api/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resend: true }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? 'We could not resend the code.');
      setSuccess('A new reset code has been sent.');
      setResendCooldown(OTP_RESEND_SECONDS);
    } catch (reason: any) {
      setError(reason?.message ?? 'We could not resend the code.');
    } finally {
      setResending(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (code.length !== 6) { setError('Enter the six-digit code from your email.'); return; }
    if (password.length < 8) { setError('Your new password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('The new passwords do not match.'); return; }
    setPending(true);
    try {
      const response = await fetch(apiUrl('/api/auth/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, newPassword: password }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? 'We could not reset your password.');
      setLocation('/login');
    } catch (reason: any) {
      setError(reason?.message ?? 'We could not reset your password.');
    } finally {
      setPending(false);
    }
  };

  return <AuthLayout title="Choose a new password." detail={email ? `Enter the code sent to ${email}.` : 'Enter the code from your password-reset email.'}>
    <form className="auth-form" onSubmit={submit}>
      <Field label="Six-digit reset code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={code} onChange={(event: any) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required data-testid="input-reset-code" />
      <label className="field"><span>New password</span><div className="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required data-testid="input-reset-password" /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
      <Field label="Confirm new password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Repeat your new password" minLength={8} value={confirm} onChange={(event: any) => setConfirm(event.target.value)} required data-testid="input-confirm-reset-password" />
      {error && <div className="error-box" role="alert">{error}</div>}
      {success && <div className="success-box" role="status"><Check size={17} />{success}</div>}
      <Button type="submit" className="full-btn" disabled={pending || !email} data-testid="button-reset-password">{pending ? 'Saving password…' : 'Save new password'} <ArrowRight size={17} /></Button>
      <button type="button" className="text-link back-to-login" onClick={() => void resend()} disabled={resending || resendCooldown > 0 || !email} data-testid="button-resend-reset-code">{resending ? 'Resending…' : resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}</button>
    </form>
  </AuthLayout>;
}

function Register() {
  const [, setLocation] = useLocation();
  const mutation = useRegister();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: authDraft.email, phone: '', password: authDraft.password, confirmPassword: '' });
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [activeField, setActiveField] = useState<'name' | 'email' | 'password' | 'idle'>('idle');
  const [gaze, setGaze] = useState<BuddyGaze>({ x: 0, y: 3 });
  const [typing, setTyping] = useState(false);
  const [faceMood, setFaceMood] = useState<BuddyMood>('idle');
  const [faceReaction, setFaceReaction] = useState(0);
  const buddyRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const update = (key: string) => (event: any) => {
    const value = event.target.value;
    if (key === 'email' || key === 'password') authDraft[key] = value;
    setForm((current) => ({ ...current, [key]: value }));
    setFaceMood('idle');
    setActiveField(key === 'firstName' || key === 'lastName' ? 'name' : key === 'password' || key === 'confirmPassword' ? 'password' : key === 'email' ? 'email' : 'idle');
    if (key === 'firstName' || key === 'lastName' || key === 'email' || key === 'password' || key === 'confirmPassword') {
      updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze);
      setTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 260);
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    mutation.mutate({
      data: {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        gender,
      },
    }, {
      onSuccess: (result: any) => {
        setFaceMood('success');
        setFaceReaction((value) => value + 1);
        authDraft.email = '';
        authDraft.password = '';
        localStorage.setItem('cipherpay_token', result.token);
        if (result.requiresEmailVerification) {
          setLocation(`/verify-email?email=${encodeURIComponent(form.email.trim().toLowerCase())}`);
        } else {
          setLocation('/');
        }
      },
       onError: (reason: any) => { setFaceMood('error'); setFaceReaction((value) => value + 1); setError(reason?.message ?? 'We could not create your account. Please review your details.'); },
    });
  };
  return <AuthLayout title="Start with CipherPay." detail="A calmer way to manage your day-to-day."><form className="auth-form" onSubmit={submit}><AuthBuddy key={`register-buddy-${faceReaction}`} field={activeField} hasText={Boolean(form.firstName || form.lastName || form.email || form.password || form.confirmPassword)} gaze={gaze} typing={typing} mood={faceMood} buddyRef={buddyRef} /><div className="field-row"><Field label="First name" placeholder="Ada" value={form.firstName} onFocus={(event: any) => { setActiveField('name'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('firstName')} required data-testid="input-first-name" /><Field label="Last name" placeholder="Okafor" value={form.lastName} onFocus={(event: any) => { setActiveField('name'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('lastName')} required data-testid="input-last-name" /></div><Field label="Email address" type="email" autoComplete="username" placeholder="you@example.com" value={form.email} onFocus={(event: any) => { setActiveField('email'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('email')} required data-testid="input-email" /><Field label="Phone number" type="tel" placeholder="Your phone number" value={form.phone} onChange={update('phone')} required data-testid="input-phone" /><label className="field"><span>Avatar style</span><select value={gender} onChange={(event) => setGender(event.target.value as 'male' | 'female')} data-testid="select-avatar-gender"><option value="male">Male</option><option value="female">Female</option></select></label><label className="field"><span>Create password</span><div className="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 6 characters" value={form.password} onFocus={(event: any) => { setActiveField('password'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('password')} required minLength={6} data-testid="input-password" /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-toggle-password">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><label className="field"><span>Confirm password</span><div className="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Repeat your password" value={form.confirmPassword} onFocus={(event: any) => { setActiveField('password'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('confirmPassword')} required minLength={6} data-testid="input-confirm-password" /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-toggle-confirm-password">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>{error && <div className="error-box">{error}</div>}<Button type="submit" className="full-btn" disabled={mutation.isPending} data-testid="button-register">{mutation.isPending ? 'Creating account…' : 'Create account'} <ArrowRight size={17} /></Button></form><p className="auth-switch">Already have an account? <Link href="/login" className="text-link" data-testid="link-login">Sign in</Link></p></AuthLayout>;
}

function Dashboard() {
  const [moreOpen, setMoreOpen] = useState(false);
  const [balanceVisible, setBalanceVisible] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(BALANCE_VISIBILITY_STORAGE_KEY) !== 'false';
  });
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const summary = useGetDashboardSummary({ query: { enabled: !!useToken(), queryKey: ['/api/dashboard'] } });
  const wallet = useGetWallet({ query: { enabled: !!useToken(), queryKey: ['/api/wallet'] } });
  const stats = useGetWalletStats({ query: { enabled: !!useToken(), queryKey: ['/api/wallet/stats'] } });
  const user = useGetMe({ query: { enabled: !!useToken(), queryKey: ['/api/auth/me'] } });
  const data: any = summary.data;
  const w: any = data?.wallet ?? wallet.data;
  const transactions: any[] = data?.recentTransactions ?? [];
  const s: any = stats.data;
  const displayBalance = (value: any) => balanceVisible ? money.format(value ?? 0) : '••••••';
  useEffect(() => {
    window.localStorage.setItem(BALANCE_VISIBILITY_STORAGE_KEY, String(balanceVisible));
  }, [balanceVisible]);
  if (summary.isLoading && wallet.isLoading) return <LoadingPage title="Loading your wallet" />;
  if (summary.isError && wallet.isError) return <ErrorPage retry={() => { summary.refetch(); wallet.refetch(); }} />;
  return (
    <>
      <PageTitle eyebrow="OVERVIEW / TODAY" title={`Good to see you, ${user.data?.firstName ?? 'there'}.`} detail="Your next move starts here." action={<div className="overview-head-actions"><div className="overview-user-badge"><CipherAvatar src={user.data?.avatarUrl} seed={user.data?.id || user.data?.email} gender={user.data?.gender} size={46} alt="" /><div><b>{user.data?.firstName} {user.data?.lastName}</b><span>{user.data?.email}</span></div></div><Link href="/fund" className="btn btn-primary" data-testid="link-fund-wallet"><Plus size={17} /> Fund wallet</Link></div>} />
      <section className="dashboard-grid">
         <div className="balance-card"><div className="balance-top"><span>Available balance</span><button type="button" className="balance-visibility" onClick={() => setBalanceVisible((visible) => !visible)} aria-label={balanceVisible ? 'Hide balance' : 'Show balance'} aria-pressed={!balanceVisible} title={balanceVisible ? 'Hide balance' : 'Show balance'} data-testid="button-toggle-balance">{balanceVisible ? <Eye size={16} /> : <EyeOff size={16} />}</button></div><div className="balance-value" data-testid="text-wallet-balance">{displayBalance(w?.balance)}</div><div className="balance-bottom"><span>Ledger balance <b>{displayBalance(w?.ledgerBalance)}</b></span><span className="mono">{w?.currency ?? 'NGN'}</span></div><div className="balance-shine" /></div>
        <div className="quick-actions"><div className="section-head"><h2>Move money</h2><span>Quick actions</span></div>
          <div className="action-row">
            <div className="more-action-wrap">
              <button type="button" className="action-tile more-action-tile" aria-expanded={moreOpen} aria-haspopup="menu" onClick={() => setMoreOpen((open) => !open)} data-testid="button-quick-more">
                <span className="action-icon purple"><MoreHorizontal size={19} /></span><b>More</b><small>Other services</small>
              </button>
              {moreOpen && <div className="more-menu" role="menu" aria-label="More quick actions">
                <Link href="/send" role="menuitem" onClick={() => setMoreOpen(false)}><ArrowUpRight size={16} /><span><b>Send money</b><small>Transfer to a CipherPay user</small></span></Link>
                <Link href="/bills" role="menuitem" onClick={() => setMoreOpen(false)}><Receipt size={16} /><span><b>Pay bills</b><small>Electricity, cable and more</small></span></Link>
                <Link href="/sms" role="menuitem" onClick={() => setMoreOpen(false)}><MessageSquare size={16} /><span><b>SMS verification</b><small>Rent a number and receive a code</small></span></Link>
                <Link href="/temporary-email" role="menuitem" onClick={() => setMoreOpen(false)}><Globe2 size={16} /><span><b>Temporary email</b><small>Create a disposable inbox</small></span></Link>
                <Link href="/services" role="menuitem" onClick={() => setMoreOpen(false)}><Layers3 size={16} /><span><b>Services</b><small>Social Boost and Email Pro</small></span></Link>
                <Link href="/transactions" role="menuitem" onClick={() => setMoreOpen(false)}><Activity size={16} /><span><b>Transactions</b><small>Review your wallet activity</small></span></Link>
              </div>}
            </div>
            <Link href="/fund" className="action-tile" data-testid="link-quick-fund"><span className="action-icon orange"><ArrowDownLeft size={19} /></span><b>Fund wallet</b><small>Card or transfer</small></Link>
            <Link href="/airtime" className="action-tile" data-testid="link-quick-airtime"><span className="action-icon green"><Smartphone size={19} /></span><b>Buy airtime</b><small>Stay connected</small></Link>
          </div>
        </div>
      </section>
       <section className="dashboard-lower">
         <div className="panel transactions-panel"><div className="section-head"><div><h2>Recent activity</h2><span>Your latest wallet movements</span></div><Link href="/transactions" className="text-link" data-testid="link-view-transactions">View all <ArrowRight size={15} /></Link></div>{summary.isFetching && <div className="skeleton-line" />}{transactions.length ? transactions.slice(0, 5).map((tx: any) => <TransactionRow key={tx.id} tx={tx} onClick={setSelectedTransaction} />) : <EmptyState icon={<Activity size={22} />} title="Your activity will show here" text="Fund your wallet or make a payment to get started." action={<Link href="/fund" className="text-link" data-testid="link-empty-fund">Fund wallet</Link>} />}</div>
         <div className="panel insight-panel"><div className="section-head"><div><h2>Money snapshot</h2><span>This month</span></div></div><div className="pulse-number">{s ? money.format(s.monthlySpend) : '₦0.00'}</div><span className="muted">Spent this month</span><div className="mini-bars"><i style={{ height: '36%' }} /><i style={{ height: '57%' }} /><i style={{ height: '44%' }} /><i style={{ height: '78%' }} /><i style={{ height: '61%' }} /><i style={{ height: '88%' }} /><i className="today" style={{ height: '67%' }} /></div><div className="pulse-meta"><span>Funded <b>{s ? money.format(s.totalFunded) : '₦0'}</b></span><span>Transfers <b>{s?.totalTransfers ?? 0}</b></span><span>Withdrawals <b>{s ? money.format(s.totalWithdrawn) : '₦0'}</b></span></div></div>
       </section>
       {selectedTransaction && <TransactionReceipt transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />}
    </>
  );
}

function isIncomingTransaction(tx: any) {
  const type = String(tx.type ?? '').toLowerCase();
  const description = String(tx.description ?? '').toLowerCase();
  return ['fund', 'funding', 'deposit', 'credit', 'transfer_in', 'refund', 'admin_credit'].includes(type)
    || /fund|deposit|added|credited|refund|received|cashback|top[\s-]?up/.test(description);
}

function TransactionRow({ tx, onClick }: { tx: any; onClick?: (tx: any) => void }) {
  const positive = isIncomingTransaction(tx);
  return <button type="button" className="transaction-row transaction-row-button" onClick={() => onClick?.(tx)} aria-label={`View details for ${tx.description || tx.type || 'transaction'}`} data-testid={`row-transaction-${tx.id}`}>
    <span className={`tx-icon ${positive ? 'tx-positive' : 'tx-negative'}`}>{positive ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span>
    <span className="tx-copy"><b>{tx.description || tx.type}</b><small>{tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' }) : 'Recently'} · {tx.status}</small></span>
    <span className={positive ? 'amount-positive' : 'amount-negative'}>{positive ? '+' : '−'}{money.format(Math.abs(tx.amount ?? 0))}</span>
  </button>;
}

function TransactionReceipt({ transaction, onClose }: { transaction: any; onClose: () => void }) {
  const positive = isIncomingTransaction(transaction);
  const status = String(transaction.status ?? 'unknown');
  const details = [
    ['Reference', transaction.reference || 'Not available'],
    ['Type', String(transaction.type ?? 'transaction').replaceAll('_', ' ')],
    ['Date', transaction.createdAt ? new Date(transaction.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available'],
    ['Fee', transaction.fee == null ? '—' : money.format(transaction.fee)],
    ['Balance before', transaction.balanceBefore == null ? '—' : money.format(transaction.balanceBefore)],
    ['Balance after', transaction.balanceAfter == null ? '—' : money.format(transaction.balanceAfter)],
  ];
  return <div className="animated-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="animated-dialog transaction-receipt" role="dialog" aria-modal="true" aria-labelledby="transaction-receipt-title" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="animated-dialog-close" onClick={onClose} aria-label="Close transaction receipt"><X size={17} /></button>
      <span className={`receipt-status-icon ${positive ? 'positive' : ''}`}><Check size={21} /></span>
      <span className="receipt-kicker">CIPHERPAY / RECEIPT</span>
      <h2 id="transaction-receipt-title">{transaction.description || 'Transaction details'}</h2>
      <strong className={`receipt-amount ${positive ? 'positive' : ''}`}>{positive ? '+' : '−'}{money.format(Math.abs(transaction.amount ?? 0))}</strong>
      <span className={`receipt-status receipt-status-${status}`}>{status}</span>
      <div className="receipt-details">{details.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    </section>
  </div>;
}
function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon">{icon}</span><b>{title}</b><p>{text}</p>{action}</div>; }
function LoadingPage({ title = 'Loading' }: { title?: string }) { return <div className="loading-state"><div className="loading-mark" /><h2>{title}</h2><div className="skeleton-block" /><div className="skeleton-block short" /></div>; }
function ErrorPage({ retry }: { retry: () => void }) { return <div className="center-state"><div className="error-symbol">!</div><h2>Something went off course</h2><p>We could not load this view. Your money is safe.</p><Button onClick={retry} variant="secondary" data-testid="button-retry"><RefreshCw size={16} /> Try again</Button></div>; }

function TransferAccountPanel({ result, requestedAmount, paymentStatus, onClose, onReset }: { result: any; requestedAmount: number; paymentStatus: 'waiting' | 'success' | 'failed'; onClose: () => void; onReset: () => void }) {
  const [copiedField, setCopiedField] = useState('');
  const account = result.account;
  const permanent = Boolean(account.permanent);
  const amount = Number(account.amount ?? requestedAmount);
  const paymentStatusLabel = paymentStatus === 'success' ? 'Payment received' : paymentStatus === 'failed' ? 'Payment failed' : permanent ? 'Personal account' : 'Awaiting payment';
  const paymentMessage = paymentStatus === 'success'
    ? 'Flutterwave confirmed your transfer and the money has been added to your wallet.'
    : paymentStatus === 'failed'
      ? 'Flutterwave could not confirm this transfer. Please start a new deposit or contact support if money left your bank.'
      : permanent
        ? 'This is your permanent CipherPay deposit account. You can use it anytime and send any amount; successful transfers are credited automatically.'
        : 'Send the exact amount below. We are checking Flutterwave automatically and will update your wallet when the transfer settles.';
  const expiresAt = permanent ? 'Permanent' : account.expiresAt
    ? new Date(account.expiresAt).toLocaleString('en-NG', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Until payment is received';
  const copyField = async (field: string, value: string) => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField((current) => current === field ? '' : current), 1800);
    } catch {
      setCopiedField('');
    }
  };
  const copyButton = (field: string, value: string, label: string) => (
    <button
      type="button"
      className={`transfer-copy ${copiedField === field ? 'copied' : ''}`}
      onClick={() => void copyField(field, value)}
      aria-label={`Copy ${label}`}
      data-testid={`button-copy-transfer-${field}`}
    >
      {copiedField === field ? <Check size={14} /> : <Copy size={14} />}
      <span>{copiedField === field ? 'Copied' : 'Copy'}</span>
    </button>
  );
  return (
    <section className="transfer-account-panel" aria-live="polite" data-testid="panel-transfer-account">
      <button type="button" className="transfer-modal-close" onClick={onClose} aria-label="Close transfer account details" data-testid="button-close-transfer-account"><X size={17} /></button>
      <div className="transfer-panel-heading">
        <span className={`transfer-success-mark ${paymentStatus}`}><Check size={18} /></span>
        <div>
          <span className="eyebrow">{paymentStatus === 'success' ? 'BANK TRANSFER / SUCCESS' : paymentStatus === 'failed' ? 'BANK TRANSFER / ATTENTION' : 'BANK TRANSFER / READY'}</span>
          <h2 id="transfer-account-title">{paymentStatus === 'success' ? 'Funding successful' : paymentStatus === 'failed' ? 'Funding needs attention' : permanent ? 'Your personal deposit account' : 'Transfer account generated'}</h2>
          <p>{paymentStatus === 'success' ? 'Your payment was confirmed and your wallet has been credited.' : paymentStatus === 'failed' ? 'This funding attempt could not be completed.' : paymentMessage}</p>
        </div>
        <span className={`transfer-status transfer-status-${paymentStatus}`}>{paymentStatusLabel}</span>
      </div>

      <div className="transfer-amount-banner">
        <div>
          <span>Amount to send</span>
          <strong>{money.format(amount)}</strong>
        </div>
        <div className="transfer-amount-note"><Banknote size={16} /><span>Wallet credit</span></div>
      </div>

      {paymentStatus !== 'success' && <div className="transfer-account-card">
        <div className="transfer-bank-heading">
          <span className="transfer-bank-icon"><Landmark size={18} /></span>
          <div><span>Send to this account</span><strong>{account.bankName || "Flutterwave MFB"}</strong></div>
          <span className="transfer-live-dot"><i /> Live account</span>
        </div>
        <div className="transfer-detail-list">
          <div className="transfer-detail-row">
            <span>Account name</span>
            <div><strong>{account.accountName || 'CipherPay'}</strong></div>
          </div>
          <div className="transfer-detail-row transfer-detail-highlight">
            <span>Account number</span>
            <div><strong className="transfer-account-number">{account.accountNumber}</strong>{copyButton('account', String(account.accountNumber), 'account number')}</div>
          </div>
          {!permanent && <div className="transfer-detail-row">
            <span>Transfer reference</span>
            <div><strong className="transfer-reference">{result.reference || 'Generated automatically'}</strong>{result.reference && copyButton('reference', String(result.reference), 'transfer reference')}</div>
          </div>}
          <div className="transfer-detail-row">
            <span>Account availability</span>
            <div><strong>{expiresAt}</strong></div>
          </div>
        </div>
      </div>}

      {paymentStatus === 'success' && (
        <div className="success-box transfer-funding-success" role="status">
          <Check size={20} />
          <div><b>Funding successful</b><span>{money.format(amount)} has been added to your CipherPay wallet.</span></div>
        </div>
      )}

      {paymentStatus === 'failed' && (
        <div className="error-box" role="alert">
          This funding attempt could not be completed. Your wallet was not credited by this attempt.
        </div>
      )}

      {paymentStatus !== 'success' && paymentStatus !== 'failed' && (
        <>
          <div className="transfer-instructions">
            <div className="transfer-instructions-heading"><span className="transfer-info-icon"><FileText size={15} /></span><div><strong>How to complete your deposit</strong><span>Use your bank app</span></div></div>
            <ol>
              <li><span>01</span><p>Open your bank app and choose <b>Transfer</b>.</p></li>
              <li><span>02</span><p>Enter the account details above and send <b>{permanent && amount <= 0 ? 'any amount' : money.format(amount)}</b>.</p></li>
              <li><span>03</span><p>Keep this page open while we confirm the payment and credit your wallet.</p></li>
            </ol>
          </div>
          <div className="transfer-warning"><ShieldCheck size={16} /><p>{account.note || (permanent ? 'This account belongs to your CipherPay wallet. Use it for future deposits too.' : 'Only send the exact amount shown. Do not send money to this account after it expires.')}</p></div>
        </>
      )}

      <div className="transfer-panel-footer"><span>Reference: <b>{result.reference || '—'}</b></span><button type="button" className="transfer-new-button" onClick={onReset}>Start another deposit <ArrowRight size={14} /></button></div>
    </section>
  );
}

function Fund() {
  const mutation = useFundWallet();
  const bankMutation = useFundWalletBankTransfer();
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState('card');
  const [result, setResult] = useState<any>(null);
  const [paymentStatus, setPaymentStatus] = useState<'waiting' | 'success' | 'failed'>('waiting');
  const [transferOpen, setTransferOpen] = useState(false);
  const [error, setError] = useState('');
  const routes: Array<{ value: string; icon: any; label: string; note: string }> = [
    { value: 'card', icon: CreditCard, label: 'Debit card', note: 'Instant card payment' },
    { value: 'bank_transfer', icon: Landmark, label: 'Bank transfer', note: 'Get a transfer account' },
  ];
  useEffect(() => {
    if (!result?.account || !result.reference) return;
    let active = true;
    let timer: number | undefined;
    const pollPayment = async () => {
      try {
        const token = useToken();
        const response = await fetch(apiUrl('/api/wallet/fund/verify'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
          body: JSON.stringify({ reference: result.reference }),
        });
        const payload = await response.json().catch(() => null) as { status?: string; error?: string } | null;
        if (!active) return;
        if (payload?.status === 'success') {
          setPaymentStatus('success');
          void queryClient.invalidateQueries({ queryKey: ['/api/wallet'] });
          return;
        }
        if (payload?.status === 'failed' || response.status === 400) {
          setPaymentStatus('failed');
          return;
        }
      } catch {
        // The Flutterwave webhook remains the source of truth; transient polling
        // failures should not tell the user that a valid payment failed.
      }
      if (active) timer = window.setTimeout(() => void pollPayment(), 5000);
    };
    void pollPayment();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [result?.account?.accountNumber, result?.reference]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setPaymentStatus('waiting');
    setTransferOpen(false);
    const mutationToRun: any = channel === 'bank_transfer' ? bankMutation : mutation;
    mutationToRun.mutate(
      { data: { amount: parseGroupedDigits(amount), channel } },
      {
        onSuccess: (value: any) => {
          setResult(value);
          if (value.account) {
            setPaymentStatus('waiting');
            setTransferOpen(true);
          }
        },
        onError: (reason: any) => setError(reason?.message ?? 'Could not prepare wallet funding.'),
      },
    );
  };
  return (
    <>
      <PageTitle eyebrow="MONEY / FUND" title="Add money to your wallet." detail="Choose the route that works for you. Funds appear as soon as they settle." />
      <div className="form-layout">
        <form className="panel main-form" onSubmit={submit}>
          <div className="form-section-title"><span className="step">01</span><div><h2>How much?</h2><p>Enter an amount in naira.</p></div></div>
          <label className="amount-input"><span>₦</span><input type="text" inputMode="numeric" min="100" placeholder="0.00" value={amount} onChange={(e) => setAmount(formatGroupedDigits(e.target.value))} required data-testid="input-fund-amount" /></label><div style={{marginTop:8,fontSize:12,color:'var(--muted-foreground, #737373)'}}>Minimum funding amount: <b>₦100</b>.</div>
          <div className="amount-chips">{['5000', '10000', '25000', '50000'].map((value) => <button type="button" key={value} onClick={() => setAmount(formatGroupedDigits(value))} className="amount-chip" data-testid={`button-amount-${value}`}>₦{Number(value).toLocaleString()}</button>)}</div>
          <div className="form-section-title with-top"><span className="step">02</span><div><h2>Choose a route</h2><p>Select how you want to pay.</p></div></div>
          <div className="choice-grid">{routes.map(({ value, icon: Icon, label, note }) => <button type="button" key={value} className={`choice-card ${channel === value ? 'selected' : ''}`} onClick={() => setChannel(value)} data-testid={`button-channel-${value}`}><span className="choice-check">{channel === value && <Check size={13} />}</span><span className="choice-icon"><Icon size={19} /></span><b>{label}</b><small>{note}</small></button>)}</div>
          {error && <div className="error-box" role="alert">{error}</div>}
           {result && !result.account && <div className="success-box"><Check size={17} /><div><b>Payment link ready</b><span>Continue to complete your funding.</span></div>{result.authorizationUrl && <a href={result.authorizationUrl} target="_blank" rel="noreferrer" className="text-link" data-testid="link-payment">Continue</a>}</div>}
           {!result?.account && <Button type="submit" className="full-btn" disabled={!amount || mutation.isPending || bankMutation.isPending} data-testid="button-fund-submit">{mutation.isPending || bankMutation.isPending ? 'Preparing…' : 'Continue to funding'} <ArrowRight size={17} /></Button>}
        </form>
        <div className="side-note"><span className="side-note-icon"><ShieldCheck size={20} /></span><h3>Built for peace of mind.</h3><p>Every transaction is encrypted and your funds stay visible at every step.</p><div className="side-rule" /><b style={{display:'block',marginBottom:6}}>Funding limit</b><span style={{fontSize:12,lineHeight:1.5}}>Minimum deposit: ₦100.</span><div className="side-rule" /><span className="mono">CIPHER / SECURE-01</span></div>
      </div>
      {result?.account && transferOpen && <div className="transfer-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTransferOpen(false); }}>
        <div className="transfer-modal-card" role="dialog" aria-modal="true" aria-labelledby="transfer-account-title" onMouseDown={(event) => event.stopPropagation()}>
          <TransferAccountPanel result={result} requestedAmount={parseGroupedDigits(amount)} paymentStatus={paymentStatus} onClose={() => setTransferOpen(false)} onReset={() => { setResult(null); setAmount(''); setTransferOpen(false); }} />
        </div>
      </div>}
      {result?.account && !transferOpen && <div className={`transfer-payment-dock ${paymentStatus}`} role="status">
        <span className="transfer-dock-pulse" />
        <div><b>{paymentStatus === 'success' ? 'Wallet funded' : paymentStatus === 'failed' ? 'Transfer needs attention' : 'Transfer account still active'}</b><small>{paymentStatus === 'success' ? 'Flutterwave confirmed your payment.' : 'We are still tracking this Flutterwave transfer.'}</small></div>
        <button type="button" onClick={() => setTransferOpen(true)} data-testid="button-reopen-transfer">View details <ArrowRight size={14} /></button>
      </div>}
    </>
  );
}

function Send() {
  const mutation = useWalletTransfer();
  const [mode, setMode] = useState<'cipherpay' | 'bank'>('cipherpay');
  const [form, setForm] = useState({ recipientEmail: '', amount: '', note: '' });
  const [bankForm, setBankForm] = useState({ bankCode: '', bankName: '', accountNumber: '', accountName: '', narration: '' });
  const [banks, setBanks] = useState<any[]>([]);
  const [bankSearch, setBankSearch] = useState('');
  const [bankOpen, setBankOpen] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [sendingBank, setSendingBank] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [resultStatus, setResultStatus] = useState<'pending' | 'success' | 'failed'>('pending');
  const [error, setError] = useState('');
  const [recipient, setRecipient] = useState<any>(null);
  const [recipientChecking, setRecipientChecking] = useState(false);
  const recipientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== 'bank' || banks.length) return;
    let active = true;
    setLoadingBanks(true);
    apiRequest<{ data: any[] }>('/api/bank/list')
      .then((payload) => { if (active) setBanks(payload.data ?? []); })
      .catch((e: any) => { if (active) setError(e?.message ?? 'Could not load banks.'); })
      .finally(() => { if (active) setLoadingBanks(false); });
    return () => { active = false; };
  }, [mode, banks.length]);

  const bankQuery = bankSearch.trim().toLowerCase();
  const filteredBanks = banks
    .filter((bank) => String(bank.name ?? '').toLowerCase().includes(bankQuery))
    .sort((a, b) => {
      const an = String(a.name ?? '').toLowerCase();
      const bn = String(b.name ?? '').toLowerCase();
      const as = an === bankQuery ? 0 : an.startsWith(bankQuery) ? 1 : 2;
      const bs = bn === bankQuery ? 0 : bn.startsWith(bankQuery) ? 1 : 2;
      return as - bs || an.localeCompare(bn);
    });

  const resolveBankAccount = async (bankCode = bankForm.bankCode, accountNumber = bankForm.accountNumber) => {
    const digits = String(accountNumber ?? '').replace(/\D/g, '').slice(0, 10);
    if (!bankCode || digits.length !== 10) return;
    setError('');
    setResolving(true);
    try {
      const payload = await apiRequest<{ accountName: string; accountNumber: string; bankCode: string }>(
        '/api/bank/resolve',
        { method: 'POST', body: { bankCode, accountNumber: digits } },
      );
      setBankForm((current) => ({
        ...current,
        accountName: payload.accountName,
        accountNumber: payload.accountNumber,
        bankCode: payload.bankCode,
      }));
    } catch (e: any) {
      setBankForm((current) => ({ ...current, accountName: '' }));
      setError(e?.message ?? 'Could not verify account.');
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (mode !== 'cipherpay') return;
    const email = form.recipientEmail.trim().toLowerCase();
    setRecipient(null);
    if (!email || !email.includes('@')) { setRecipientChecking(false); return; }
    if (recipientTimer.current) clearTimeout(recipientTimer.current);
    setRecipientChecking(true);
    recipientTimer.current = setTimeout(() => {
      void apiRequest<any>(`/api/users/lookup-email?email=${encodeURIComponent(email)}`)
        .then((value) => setRecipient(value))
        .catch(() => setRecipient(null))
        .finally(() => setRecipientChecking(false));
    }, 450);
    return () => { if (recipientTimer.current) clearTimeout(recipientTimer.current); };
  }, [form.recipientEmail, mode]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setResult(null);
    setResultStatus('pending');

    if (mode === 'cipherpay') {
      mutation.mutate(
        { data: { ...form, amount: parseGroupedDigits(form.amount) } as any },
        {
          onSuccess: (value: any) => { setResult(value); setResultStatus('success'); },
          onError: (reason: any) => setError(reason?.message ?? 'The transfer could not be completed.'),
        },
      );
      return;
    }

    if (!bankForm.bankCode || !/^\d{10}$/.test(bankForm.accountNumber)) {
      setError('Choose a bank and enter a valid 10-digit account number.');
      return;
    }
    if (!bankForm.accountName) {
      await resolveBankAccount();
      return;
    }
    const amount = parseGroupedDigits(form.amount);
    if (!(amount > 0)) {
      setError('Enter an amount to send.');
      return;
    }

    setSendingBank(true);
    try {
      const payload = await apiRequest<any>('/api/wallet/withdraw', {
        method: 'POST',
        body: {
          amount,
          bankCode: bankForm.bankCode,
          accountNumber: bankForm.accountNumber,
          accountName: bankForm.accountName,
          narration: bankForm.narration || undefined,
        },
      });
      setResult(payload);
      setResultStatus('pending');
      void queryClient.invalidateQueries({ queryKey: ['/api/wallet'] });
      const txId = Number(payload?.transaction?.id);
      if (Number.isFinite(txId) && txId > 0) {
        let settled = false;
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2500));
          try {
            const statusPayload = await apiRequest<any>('/api/wallet/withdraw/refresh/' + txId, { method: 'POST' });
            if (statusPayload?.status === 'success') { settled = true; setResultStatus('success'); void queryClient.invalidateQueries({ queryKey: ['/api/wallet'] }); break; }
            if (statusPayload?.status === 'failed') { settled = true; setResultStatus('failed'); setError(statusPayload?.message ?? 'The bank transfer failed and your funds were refunded.'); break; }
          } catch { }
        }
        if (!settled) setResultStatus('pending');
      }
    } catch (e: any) {
      setError(e?.message ?? 'The bank transfer could not be completed.');
      setResult(null);
      setResultStatus('failed');
    } finally {
      setSendingBank(false);
    }
  };

  const busy = mutation.isPending || sendingBank;
  return <>
    <PageTitle
      eyebrow="MONEY / SEND"
      title="Send money, simply."
      detail="Move funds to another CipherPay user or send directly to any Nigerian bank account."
    />
    <div className="form-layout">
      <form className="panel main-form" onSubmit={submit}>
        <div className="tabs send-tabs">
          <button type="button" className={`tab ${mode === 'cipherpay' ? 'active' : ''}`} onClick={() => { setMode('cipherpay'); setError(''); setResult(null); }}>
            CipherPay user
          </button>
          <button type="button" className={`tab ${mode === 'bank' ? 'active' : ''}`} onClick={() => { setMode('bank'); setError(''); setResult(null); }}>
            Bank account
          </button>
        </div>

        {mode === 'cipherpay' ? (
          <>
            <div className="form-section-title"><span className="step">01</span><div><h2>Who are you sending to?</h2><p>Use their CipherPay email address.</p></div></div><div style={{marginBottom:14,fontSize:12,color:'var(--muted-foreground, #737373)'}}>Minimum transfer: <b>₦100</b>. A small transfer fee is added to the sender's debit.</div>
            <Field label="Recipient email" type="email" placeholder="friend@example.com" value={form.recipientEmail} onChange={(event: any) => setForm({ ...form, recipientEmail: event.target.value })} required data-testid="input-recipient-email" />
            {(recipientChecking || recipient) && <div className="recipient-preview">
              {recipient ? <><CipherAvatar src={recipient.avatarUrl} seed={recipient.id || recipient.email} gender={recipient.gender} size={52} alt="" /><div><b>{recipient.firstName} {recipient.lastName}</b><small>{recipient.email}{recipient.isSelf ? ' · This is you' : ' · CipherPay user'}</small></div><span className="recipient-verified">Verified</span></> : <div className="recipient-checking">Checking CipherPay account…</div>}
            </div>}
          </>
        ) : (
          <>
            <div className="form-section-title"><span className="step">01</span><div><h2>Where should it go?</h2><p>Choose a Nigerian bank and verify the account before sending.</p></div></div><div style={{marginBottom:14,fontSize:12,color:'var(--muted-foreground, #737373)'}}>Minimum bank transfer: <b>₦100</b>.</div>
            <div className="bank-picker">
              <label className="field"><span>Bank</span>
                <button type="button" className="bank-picker-trigger" onClick={() => setBankOpen((open) => !open)}>
                  <span>{bankForm.bankName || (loadingBanks ? 'Loading banks…' : 'Select a bank')}</span><ArrowRight size={15} className={bankOpen ? 'bank-picker-arrow open' : 'bank-picker-arrow'} />
                </button>
              </label>
              {bankOpen && <div className="bank-picker-menu">
                <input autoFocus className="bank-search-input" placeholder="Search banks…" value={bankSearch} onChange={(event) => setBankSearch(event.target.value)} />
                <div className="bank-picker-list">
                  {filteredBanks.map((bank) => (
                    <button type="button" key={bank.code} className="bank-picker-option" onClick={() => {
                      setBankForm((current) => ({ ...current, bankCode: String(bank.code), bankName: String(bank.name), accountName: '' }));
                      setBankOpen(false);
                      if (bankForm.accountNumber.replace(/\D/g, '').length === 10) {
                        void resolveBankAccount(String(bank.code), bankForm.accountNumber);
                      }
                      setBankSearch('');
                    }}>{bank.name}</button>
                  ))}
                  {!filteredBanks.length && <div className="bank-picker-empty">No banks match that search.</div>}
                </div>
              </div>}
            </div>
            <Field
              label="Account number"
              type="text"
              inputMode="numeric"
              maxLength={10}
              placeholder="0123456789"
              value={bankForm.accountNumber}
              onChange={(event: any) => {
                const digits = event.target.value.replace(/\D/g, '').slice(0, 10);
                setBankForm((current) => ({ ...current, accountNumber: digits, accountName: '' }));
                if (digits.length === 10 && bankForm.bankCode) {
                  void resolveBankAccount(bankForm.bankCode, digits);
                }
              }}
              onBlur={() => resolveBankAccount()}
              required
              data-testid="input-bank-account-number"
            />
            {bankForm.accountName && <div className="resolved-account"><Check size={16} /><div><small>Account name</small><b>{bankForm.accountName}</b></div></div>}
          </>
        )}

        {(mode === 'cipherpay' || (mode === 'bank' && Boolean(bankForm.accountName) && !resolving)) && <div className="field-row">
          <Field label="Amount (₦)" type="text" inputMode="numeric" min="1" placeholder="0.00" value={form.amount} onChange={(event: any) => setForm({ ...form, amount: formatGroupedDigits(event.target.value) })} required data-testid="input-send-amount" />
          {mode === 'cipherpay'
            ? <Field label="Note (optional)" placeholder="What's this for?" value={form.note} onChange={(event: any) => setForm({ ...form, note: event.target.value })} data-testid="input-send-note" />
            : <Field label="Narration (optional)" placeholder="What is this for?" value={bankForm.narration} onChange={(event: any) => setBankForm((current) => ({ ...current, narration: event.target.value.slice(0, 120) }))} data-testid="input-bank-narration" />
          }
        </div>}

        {resolving && <div className="muted-line">Verifying account details…</div>}
        {error && <div className="error-box" role="alert">{error}</div>}

        {(mode === 'cipherpay' || bankForm.accountName) && <Button type="submit" className="full-btn" disabled={busy || resolving} data-testid="button-send-submit">
          {busy ? 'Sending…' : mode === 'bank' ? 'Send to bank' : 'Review and send'} <ArrowRight size={17} />
        </Button>}
      </form>
      {result && <TransferResultPop status={resultStatus} mode={mode} amount={parseGroupedDigits(form.amount)} message={result.message} onClose={() => { if (resultStatus !== 'pending') { setResult(null); setError(''); } }} />}
      <div className="side-note violet">
        <span className="side-note-icon"><SendIcon size={20} /></span>
        <h3>{mode === 'bank' ? 'Straight to their bank.' : 'From your wallet to theirs.'}</h3>
        <p>{mode === 'bank' ? 'Bank transfers are sent from the customer wallet assigned to your CipherPay account. The recipient sees the sender name registered on that wallet.' : 'No bank details needed. CipherPay users receive funds instantly.'}</p>
        <div className="side-rule" /><span className="mono">{mode === 'bank' ? 'BANK / DIRECT-01' : 'TRANSFER / FAST-02'}</span>
      </div>
    </div>
  </>;
}

function ProviderLogo({ logo, name }: { logo?: string | null; name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return <span className="vas-provider-logo">{logo ? <img src={logo} alt={`${name} logo`} /> : <span>{initials || 'CP'}</span>}</span>;
}

function billCategoryIcon(id: string) {
  if (id === 'electricity') return <Bolt size={19} />;
  if (id === 'cable') return <Tv size={19} />;
  if (id === 'internet') return <Wifi size={19} />;
  if (id === 'betting') return <Target size={19} />;
  return <Receipt size={19} />;
}


function PurchaseSuccessPop({ kind, phone, onClose }: { kind: 'airtime' | 'data' | 'bill'; phone?: string; onClose: () => void }) {
  const title = kind === 'airtime' ? 'Airtime sent' : kind === 'data' ? 'Data bundle sent' : 'Bill payment successful';
  const detail = kind === 'bill'
    ? 'Your bill payment has been completed successfully.'
    : `Your ${kind === 'airtime' ? 'airtime' : 'data bundle'} was delivered${phone ? ` to ${phone}` : ''}.`;
  return (
    <div className="purchase-success-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="purchase-success-pop" role="dialog" aria-modal="true" aria-labelledby="purchase-success-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="purchase-success-close" onClick={onClose} aria-label="Close success message"><X size={17} /></button>
        <div className="purchase-success-icon"><Check size={26} strokeWidth={2.4} /></div>
        <span className="section-kicker">CIPHERPAY / COMPLETE</span>
        <h2 id="purchase-success-title">{title}</h2>
        <p>{detail}</p>
        <button type="button" className="btn btn-primary purchase-success-button" onClick={onClose}>Done <Check size={16} /></button>
      </section>
    </div>
  );
}

function TransferResultPop({ status, mode, amount, message, onClose }: { status: 'pending' | 'success' | 'failed'; mode: 'bank' | 'cipherpay'; amount?: number; message?: string; onClose: () => void }) {
  const success = status === 'success';
  const failed = status === 'failed';
  const title = failed ? 'Transfer failed' : success ? 'Money sent' : mode === 'bank' ? 'Sending to your bank' : 'Transfer started';
  const detail = failed ? (message || 'The transfer could not be completed.') : success ? (mode === 'bank' ? '₦' + Number(amount || 0).toLocaleString('en-NG') + ' has been sent to the destination account.' : (message || 'The money has been delivered to the recipient.')) : 'Your withdrawal has been submitted and we’re checking the bank transfer status automatically.';
  return (
    <div className="transfer-result-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && (success || failed)) onClose(); }}>
      <section className="transfer-result-pop" role="dialog" aria-modal="true" aria-labelledby="transfer-result-title">
        <button type="button" className="transfer-result-close" onClick={onClose} aria-label="Close transfer message"><X size={17} /></button>
        <div className={'transfer-result-icon ' + (success ? 'success' : failed ? 'failed' : 'pending')}>
          {success ? <Check size={27} strokeWidth={2.5} /> : failed ? <X size={25} strokeWidth={2.5} /> : <RefreshCw size={24} />}
        </div>
        <span className="section-kicker">CIPHERPAY / TRANSFER</span>
        <h2 id="transfer-result-title">{title}</h2>
        <p>{detail}</p>
        {status === 'pending' && <div className="transfer-result-status"><span className="transfer-result-spinner" />Checking transfer status…</div>}
        <button type="button" className="btn btn-primary transfer-result-button" onClick={onClose} disabled={status === 'pending'}>{status === 'pending' ? 'Please wait…' : failed ? 'Close' : 'Done'} {status !== 'pending' && <Check size={16} />}</button>
      </section>
    </div>
  );
}
function Airtime() {
  const networksQuery = useListNetworks();
  const airtime = useBuyAirtime();
  const dataMutation = useBuyData();
  const [tab, setTab] = useState<'airtime' | 'data'>('airtime');
  const [network, setNetwork] = useState('mtn');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [planId, setPlanId] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const dataPlans = useListDataPlans(
    { network },
    { query: { enabled: tab === 'data' && Boolean(network), queryKey: ['/api/data-plans', network], staleTime: 60_000 } } as any,
  );
  const networks: any[] = networksQuery.data ?? [];
  const plans: any[] = dataPlans.data ?? [];
  const selectedNetwork = networks.find((item) => (item.code || item.id) === network);
  const selectedPlan = plans.find((plan) => plan.id === planId);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setDone(false);
    const target: any = tab === 'airtime' ? airtime : dataMutation;
    const data = tab === 'airtime' ? { network, phone, amount: parseGroupedDigits(amount) } : { network, phone, planId };
    target.mutate(
      { data },
      {
        onSuccess: () => setDone(true),
        onError: (reason: any) => setError(reason?.message ?? `Could not buy ${tab}.`),
      },
    );
  };
  const submitting = airtime.isPending || dataMutation.isPending;
  return <>
    <PageTitle eyebrow="EVERYDAY / CONNECT" title="Stay connected, without the scramble." detail="Live Nigerian airtime and data bundles, delivered to any network from your CipherPay wallet." />
    <section className="vas-hero vas-hero-connect">
      <div className="vas-hero-copy"><span className="vas-hero-icon"><Smartphone size={21} /></span><div><span className="eyebrow">LIVE SERVICE RAIL</span><h2>Top up in a few calm steps.</h2><p>Choose a network, confirm the recipient, and we’ll handle the delivery securely behind the scenes.</p></div></div>
      <div className="vas-hero-meta"><span><ShieldCheck size={14} /> Secure delivery rail</span><span><NetworkIcon size={14} /> {networks.length || '—'} networks available</span></div>
    </section>
    <div className="vas-layout">
      <section className="panel service-panel vas-main-card">
        <div className="service-card-heading"><div><span className="section-kicker">01 / CHOOSE A SERVICE</span><h2>What do you need?</h2><p>Prices and bundles are loaded from the live provider catalog.</p></div><span className="service-live-badge"><span /> Live</span></div>
        <div className="tabs vas-tabs" role="tablist" aria-label="Connectivity service">
          <button className={tab === 'airtime' ? 'tab active' : 'tab'} type="button" role="tab" aria-selected={tab === 'airtime'} onClick={() => { setTab('airtime'); setDone(false); setError(''); }} data-testid="tab-airtime"><Banknote size={15} /> Airtime</button>
          <button className={tab === 'data' ? 'tab active' : 'tab'} type="button" role="tab" aria-selected={tab === 'data'} onClick={() => { setTab('data'); setDone(false); setError(''); }} data-testid="tab-data"><Layers3 size={15} /> Data bundles</button>
        </div>
        <form className="service-form vas-form" onSubmit={submit}>
          <div className="network-picker"><div className="field-heading"><span className="form-label">Choose a network</span><small>{selectedNetwork?.name ?? 'Select your carrier'}</small></div><div className="network-options vas-network-options">
            {networksQuery.isLoading ? <div className="loading-inline">Loading live networks…</div> : networks.map((item: any) => {
              const code = item.code || item.id;
              return <button type="button" className={`network-option vas-network-option ${network === code ? 'selected' : ''}`} onClick={() => { setNetwork(code); setPlanId(''); }} key={code} data-testid={`button-network-${code}`}><ProviderLogo logo={item.logo} name={item.name} /><span>{item.name}</span>{network === code && <Check size={15} />}</button>;
            })}
          </div></div>
          {networksQuery.isError && <div className="error-box" role="alert">Could not load mobile networks. Refresh the page to try again.</div>}
          <div className="field-row vas-field-row"><Field label="Recipient phone number" type="tel" placeholder="0803 123 4567" value={phone} onChange={(event: any) => setPhone(event.target.value)} required data-testid="input-service-phone" />{tab === 'airtime' ? <div className="field"><span>Quick amount</span><div className="amount-chips">{[100, 200, 500, 1000].map((value) => <button type="button" className={parseGroupedDigits(amount) === value ? 'amount-chip active' : 'amount-chip'} onClick={() => setAmount(formatGroupedDigits(value))} key={value} data-testid={`button-airtime-amount-${value}`}>{money.format(value)}</button>)}</div></div> : <div className="vas-recipient-note"><ShieldCheck size={15} /><span>We send the bundle directly to this number.</span></div>}</div>
          {tab === 'airtime'
            ? <><Field label="Airtime amount (₦)" type="text" inputMode="numeric" placeholder="Enter amount" value={amount} onChange={(event: any) => setAmount(formatGroupedDigits(event.target.value))} required data-testid="input-airtime-amount" /><div style={{marginTop:8,fontSize:12,color:'var(--muted-foreground, #737373)'}}>Minimum airtime: <b>₦100</b>.</div></>
            : <div><div className="field-heading"><span className="form-label">Choose a data bundle</span><small>{selectedPlan ? `${selectedPlan.size || selectedPlan.name} selected` : 'Select one live plan'}</small></div>{dataPlans.isLoading ? <div className="loading-inline">Loading current data plans…</div> : dataPlans.isError ? <div className="error-box" role="alert">Could not load plans for this network.</div> : plans.length ? <div className="plan-grid vas-plan-grid">{plans.map((plan: any) => <button type="button" className={`plan-card vas-plan-card ${planId === plan.id ? 'selected' : ''}`} onClick={() => setPlanId(plan.id)} key={plan.id} data-testid={`button-plan-${plan.id}`}><span className="plan-card-top"><b>{plan.size || plan.name}</b>{planId === plan.id && <Check size={14} />}</span><small>{plan.validity || 'Provider validity'}</small><strong>{money.format(plan.price)}</strong></button>)}</div> : <div className="loading-inline">No current data plans are available.</div>}</div>}
          <div className="vas-order-summary"><div><span>Order summary</span><strong>{tab === 'airtime' ? `${selectedNetwork?.name ?? 'Network'} airtime` : selectedPlan?.name || 'Choose a data bundle'}</strong></div><div><span>Deliver to</span><strong>{phone || 'Recipient number'}</strong></div><div><span>Wallet debit</span><strong>{tab === 'airtime' ? (amount ? money.format(parseGroupedDigits(amount)) : '—') : selectedPlan ? money.format(selectedPlan.price) : '—'}</strong></div></div>
          {error && <div className="error-box" role="alert">{error}</div>}
          {!done && <Button type="submit" className="service-submit" disabled={submitting || !networks.length || !phone || (tab === 'airtime' ? !amount : !planId)} data-testid="button-service-submit">{submitting ? 'Processing your purchase…' : `Buy ${tab === 'airtime' ? 'airtime' : 'bundle'}`} <ArrowRight size={17} /></Button>}
        </form>
      </section>
      {done && <PurchaseSuccessPop kind={tab} phone={phone} onClose={() => setDone(false)} />}
      <aside className="vas-side-stack">
        <section className="panel vas-side-card"><span className="section-kicker">HOW IT WORKS</span><h3>Simple on purpose.</h3><div className="vas-step"><span>01</span><div><b>Pick the network</b><small>Use the real provider mark to confirm the carrier.</small></div></div><div className="vas-step"><span>02</span><div><b>Enter the number</b><small>We deliver to the recipient you provide.</small></div></div><div className="vas-step"><span>03</span><div><b>Get confirmation</b><small>Your wallet is charged only when the request is accepted.</small></div></div></section>
        <section className="vas-trust-card"><ShieldCheck size={18} /><div><b>Secure delivery</b><p>Your purchase is sent through our live service network and confirmed before we finish the request.</p></div></section>
      </aside>
    </div>
  </>;
}

function ProtectedArea({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const token = useToken();
  useEffect(() => {
    if (!token) setLocation('/login');
  }, [token, setLocation]);
  return token ? <Shell>{children}</Shell> : <LoadingPage title="Opening your account" />;
}

function TransactionsPage() {
  const [page, setPage] = useState(1);
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const limit = 20;
  const query = useListTransactions(
    { page, limit },
    { query: { enabled: !!useToken(), queryKey: ['/api/transactions', page, limit] } } as any,
  );
  const response: any = query.data;
  if (query.isLoading) return <LoadingPage title="Loading transactions" />;
  if (query.isError) return <ErrorPage retry={() => { void query.refetch(); }} />;
  const rows: any[] = response?.data ?? [];
  const total = Number(response?.total ?? 0);
  return <>
    <PageTitle eyebrow="WALLET / ACTIVITY" title="Your transactions." detail="A clear record of wallet activity." />
    <section className="panel transactions-page-panel">
      {rows.length ? rows.map((tx) => <TransactionRow key={tx.id} tx={tx} onClick={setSelectedTransaction} />) : <EmptyState icon={<Activity size={22} />} title="No transactions yet" text="Your wallet activity will appear here." />}
      <div className="pagination-row"><span>Page {page} · {total} total</span><div><button className="btn btn-secondary" type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="btn btn-secondary" type="button" disabled={page * limit >= total} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </section>
    {selectedTransaction && <TransactionReceipt transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />}
  </>;
}

function InfoPage({ title, detail }: { title: string; detail: string }) {
  return <>
    <PageTitle eyebrow="CIPHERPAY / ACCOUNT" title={title} detail={detail} />
    <section className="panel info-page-panel"><span className="info-page-icon"><ShieldCheck size={22} /></span><h2>Your account is protected.</h2><p>For help with this area, contact CipherPay support. Your wallet and transaction records remain available from the navigation.</p><Link href="/transactions" className="btn btn-secondary">View transactions <ArrowRight size={16} /></Link></section>
  </>;
}

function KycDetailRoute() {
  return <ProtectedArea><KycPage /></ProtectedArea>;
}

function App() {
  useEffect(() => {
    setAuthTokenGetter(() => window.localStorage.getItem('cipherpay_token'));
    const storedTheme = window.localStorage.getItem('cipherpay_theme');
    document.documentElement.classList.toggle('dark', storedTheme === 'dark');
    return () => setAuthTokenGetter(null);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AnimatedDialogProvider>
          <Toaster />
          <Switch>
            <Route path="/login"><Login /></Route>
            <Route path="/register"><Register /></Route>
            <Route path="/forgot-password"><ForgotPassword /></Route>
            <Route path="/verify-email"><VerifyEmail /></Route>
            <Route path="/reset-password"><ResetPassword /></Route>
            <Route path="/"><LandingPage /></Route>
            <Route path="/fund"><ProtectedArea><Fund /></ProtectedArea></Route>
            <Route path="/send"><ProtectedArea><Send /></ProtectedArea></Route>
            <Route path="/airtime"><ProtectedArea><Airtime /></ProtectedArea></Route>
            <Route path="/bills/:category/:provider"><ProtectedArea><BillsPage /></ProtectedArea></Route>
            <Route path="/bills/:category"><ProtectedArea><BillsPage /></ProtectedArea></Route>
            <Route path="/bills"><ProtectedArea><BillsPage /></ProtectedArea></Route>
            <Route path="/bills/:category/:provider"><ProtectedArea><BillProviderPage /></ProtectedArea></Route>
            <Route path="/sms"><ProtectedArea><SmsVerification /></ProtectedArea></Route>
            <Route path="/temporary-email"><ProtectedArea><TemporaryEmail /></ProtectedArea></Route>
            <Route path="/services"><ProtectedArea><ServicesPage /></ProtectedArea></Route>
            <Route path="/social-boost"><ProtectedArea><SocialBoostPage /></ProtectedArea></Route>
            <Route path="/email-pro"><ProtectedArea><EmailProPage /></ProtectedArea></Route>
            <Route path="/transactions"><ProtectedArea><TransactionsPage /></ProtectedArea></Route>
            <Route path="/chat/:id"><ProtectedArea><ChatPage /></ProtectedArea></Route>
            <Route path="/chat"><ProtectedArea><ChatPage /></ProtectedArea></Route>
            <Route path="/notifications"><ProtectedArea><NotificationsPage /></ProtectedArea></Route>
            <Route path="/profile"><ProtectedArea><ProfilePage /></ProtectedArea></Route>
            <Route path="/settings"><ProtectedArea><SettingsPage /></ProtectedArea></Route>
            <Route path="/kyc/:verificationType"><KycDetailRoute /></Route>
            <Route path="/kyc"><ProtectedArea><KycPage /></ProtectedArea></Route>
            <Route path="/support"><ProtectedArea><SupportPage /></ProtectedArea></Route>
            <Route path="/admin"><ProtectedArea><AdminOnly><AdminConsole /></AdminOnly></ProtectedArea></Route>
            <Route><ProtectedArea><InfoPage title="Page not found." detail="The page you requested does not exist." /></ProtectedArea></Route>
          </Switch>
        </AnimatedDialogProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const me = useGetMe({ query: { enabled: !!useToken(), queryKey: ['/api/auth/me'] } });
  const user = me.data as any;
  useEffect(() => {
    if (!me.isLoading && !user?.isAdmin) setLocation('/');
  }, [me.isLoading, user, setLocation]);
  return me.isLoading || !user?.isAdmin ? <LoadingPage title="Checking access" /> : <>{children}</>;
}

export default App;

function Bills() {
  const [, setLocation] = useLocation();
  const cats = useListBillCategories();
  const [category, setCategory] = useState('electricity');
  const providers = useListBillProviders(
    { category },
    { query: { queryKey: ['/api/bills/providers', category], staleTime: 60_000 } } as any,
  );
  const categories: any[] = cats.data ?? [];
  const availableProviders: any[] = providers.data ?? [];
  const selectedCategory = categories.find((item: any) => item.id === category);

  return <>
    <PageTitle eyebrow="EVERYDAY / BILLS" title="Bills, without the clutter." detail="Pick what you need, choose your provider, then move to a focused payment screen." />
    <section className="bills-command-hero">
      <div className="bills-command-glow bills-command-glow-one" />
      <div className="bills-command-glow bills-command-glow-two" />
      <div className="bills-command-hero-top"><span className="bills-command-icon"><Receipt size={22} /></span><span className="service-live-badge"><span /> Live provider catalogue</span></div>
      <div className="bills-command-copy"><span className="section-kicker">PAYMENT DESK / 01</span><h2>Choose the bill.<br /><em>We’ll handle the rest.</em></h2><p>Live provider logos, instant customer verification, and a clean checkout flow — no giant form to fight through.</p></div>
      <div className="bills-command-stats"><span><b>{categories.length || '—'}</b><small>bill categories</small></span><span><b>{availableProviders.length || '—'}</b><small>providers available</small></span><span><b>LIVE</b><small>provider connection</small></span></div>
    </section>

    <section className="bills-picker">
      <div className="bills-picker-head"><div><span className="section-kicker">01 / SERVICE</span><h2>What are you paying for?</h2><p>Choose a category first. You’ll get a dedicated provider screen next.</p></div><span className="bills-step-pill">Choose a category</span></div>
      <div className="bills-category-grid">
        {categories.map((item: any, index: number) => <button type="button" key={item.id} className={`bills-category-card ${category === item.id ? 'active' : ''}`} onClick={() => setCategory(item.id)}>
          <span className="bills-category-number">{String(index + 1).padStart(2, '0')}</span><span className="bills-category-symbol">{billCategoryIcon(item.id)}</span><span className="bills-category-text"><b>{item.name}</b><small>{item.description || 'Pay this bill from your wallet.'}</small></span><ArrowRight size={17} />
        </button>)}
      </div>
    </section>

    <section className="bills-provider-panel">
      <div className="bills-provider-head"><div><span className="section-kicker">02 / PROVIDER</span><h2>{selectedCategory?.name ?? 'Bill'} providers</h2><p>Select a provider to open its own payment workspace.</p></div><span className="bills-provider-count">{availableProviders.length} available</span></div>
      {providers.isLoading ? <div className="bills-provider-loading"><RefreshCw size={17} className="spin" /> Loading live providers…</div> : providers.isError ? <div className="error-box" role="alert">Could not load providers for this category. Refresh and try again.</div> : <div className="bills-provider-grid">
        {availableProviders.map((item: any, index: number) => {
          const code = item.code || item.id;
          return <button type="button" className="bills-provider-card" key={item.id} onClick={() => setLocation(`/bills/${category}/${encodeURIComponent(code)}`)} data-testid={`button-bill-provider-${item.id}`}>
            <span className="bills-provider-index">{String(index + 1).padStart(2, '0')}</span><span className="bills-provider-logo"><ProviderLogo logo={item.logo} name={item.name} /></span><span className="bills-provider-info"><b>{item.name}</b><small>{item.description || 'Provider service'}</small></span><span className="bills-provider-open"><ArrowUpRight size={16} /></span>
          </button>;
        })}
      </div>}
    </section>

    <section className="bills-flow-note"><span className="bills-flow-line" /><ShieldCheck size={17} /><span><b>Protected checkout.</b> We verify the customer before your wallet is charged.</span></section>
  </>;
}

function BillProviderPage() {
  const [, params] = useRoute<{ category: string; provider: string }>('/bills/:category/:provider');
  const [, setLocation] = useLocation();
  const category = params?.category || 'electricity';
  const provider = params?.provider ? decodeURIComponent(params.provider) : '';
  const cats = useListBillCategories();
  const providers = useListBillProviders({ category }, { query: { queryKey: ['/api/bills/providers', category], staleTime: 60_000 } } as any);
  const pay = usePayBill();
  const validate = useValidateBill();
  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [meterType, setMeterType] = useState<'prepaid' | 'postpaid'>('prepaid');
  const [validation, setValidation] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [error, setError] = useState('');
  const categories: any[] = cats.data ?? [];
  const availableProviders: any[] = providers.data ?? [];
  const selectedProvider = availableProviders.find((item: any) => (item.code || item.id) === provider);
  const selectedCategory = categories.find((item: any) => item.id === category);

  useEffect(() => {
    if (!providers.isLoading && availableProviders.length && !selectedProvider) setLocation('/bills');
  }, [providers.isLoading, availableProviders.length, selectedProvider, setLocation]);

  const verifyCustomer = () => {
    setError('');
    setValidation(null);
    validate.mutate({ data: { provider, customerId, ...(category === 'electricity' ? { type: meterType } : {}) } as any }, {
      onSuccess: (result: any) => setValidation(result),
      onError: (reason: any) => setError(reason?.message ?? 'We could not verify those bill details.'),
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setDone(null);
    if (!validation) { setError('Verify the customer details before paying this bill.'); return; }
    pay.mutate({ data: { provider, customerId, amount: parseGroupedDigits(amount), customerName: validation.name, phone: phone || customerId, meterType } as any }, {
      onSuccess: (result: any) => setDone(result),
      onError: (reason: any) => setError(reason?.message ?? 'Bill payment failed.'),
    });
  };

  if (providers.isLoading || cats.isLoading || !selectedProvider) return <LoadingPage title="Opening provider" />;

  return <>
    <div className="bills-provider-back"><button type="button" onClick={() => setLocation('/bills')}><ArrowLeft size={16} /> All bill providers</button><span>PAYMENT DESK / {selectedCategory?.name || 'BILL'}</span></div>
    <section className="bills-workspace-hero">
      <div className="bills-workspace-brand"><span className="bills-workspace-logo"><ProviderLogo logo={selectedProvider.logo} name={selectedProvider.name} /></span><div><span className="section-kicker">LIVE PROVIDER</span><h1>{selectedProvider.name}</h1><p>{selectedProvider.description || selectedCategory?.description || 'Secure bill payment.'}</p></div></div>
      <div className="bills-workspace-meta"><span><ShieldCheck size={14} /> Verified customer check</span><span><Check size={14} /> Wallet protected</span></div>
    </section>

    <div className="bills-workspace-grid">
      <section className="panel bills-checkout-card">
        <div className="bills-checkout-head"><div><span className="section-kicker">PAYMENT DETAILS</span><h2>Who are we paying?</h2><p>Enter the account details exactly as they appear on the bill.</p></div><span className="bills-secure-chip"><ShieldCheck size={14} /> Secure</span></div>
        {category === 'electricity' && <div className="bills-meter-switch"><span className="form-label">Meter type</span><div>{(['prepaid', 'postpaid'] as const).map((type) => <button type="button" className={meterType === type ? 'active' : ''} onClick={() => { setMeterType(type); setValidation(null); setDone(null); }} key={type}>{type === 'prepaid' ? 'Prepaid' : 'Postpaid'}</button>)}</div></div>}
        <div className="bills-input-grid">
          <Field label={category === 'electricity' ? 'Meter number' : 'Customer / smartcard number'} placeholder={category === 'electricity' ? 'Enter meter number' : 'Enter customer number'} value={customerId} onChange={(event: any) => { setCustomerId(event.target.value); setValidation(null); setDone(null); }} required data-testid="input-customer-id" />
          <Field label="Receipt phone (optional)" type="tel" placeholder="0803 123 4567" value={phone} onChange={(event: any) => setPhone(event.target.value)} data-testid="input-bill-phone" />
        </div>
        <div className="bills-verify-card"><div className={validation ? 'verified-copy' : ''}>{validation ? <><span className="bills-check-circle"><Check size={15} /></span><div><b>{validation.name}</b><small>{validation.address || 'Customer details verified by the provider.'}</small></div></> : <><span className="bills-verify-icon"><Fingerprint size={18} /></span><div><b>Verify before you pay</b><small>We’ll confirm the account directly with the provider.</small></div></>}</div><Button type="button" variant="secondary" onClick={verifyCustomer} disabled={validate.isPending || !customerId}>{validate.isPending ? <><RefreshCw size={15} className="spin" /> Checking…</> : validation ? 'Verify again' : 'Verify customer'}</Button></div>
        <div className="bills-amount-section"><div className="bills-amount-head"><span className="form-label">Amount</span><span>{selectedProvider.minimumAmount ? `Min ${money.format(selectedProvider.minimumAmount)}` : 'Provider limit'}</span></div><div className="bills-amount-input"><span>₦</span><input type="text" inputMode="numeric" placeholder="0.00" value={amount} onChange={(event) => { setAmount(formatGroupedDigits(event.target.value)); setDone(null); }} required /></div><div className="bills-amount-limit">{selectedProvider.minimumAmount ? money.format(selectedProvider.minimumAmount) : '—'} <span>to</span> {selectedProvider.maximumAmount ? money.format(selectedProvider.maximumAmount) : 'No stated maximum'}</div></div>
        {validation && <div className="bills-review"><div><span>Provider</span><b>{selectedProvider.name}</b></div><div><span>Customer</span><b>{validation.name}</b></div><div><span>Debit</span><b>{amount ? money.format(parseGroupedDigits(amount)) : '—'}</b></div></div>}
        {error && <div className="error-box" role="alert">{error}</div>}
        <Button type="submit" className="bills-pay-button full-btn" disabled={pay.isPending || !validation || !amount}>{pay.isPending ? 'Processing payment…' : `Pay ${selectedProvider.name}`} <ArrowRight size={17} /></Button>
      </section>
      <aside className="bills-workspace-side">
        <section className="panel bills-summary-card"><span className="section-kicker">YOU’RE PAYING</span><div className="bills-summary-provider"><span className="bills-summary-logo"><ProviderLogo logo={selectedProvider.logo} name={selectedProvider.name} /></span><div><b>{selectedProvider.name}</b><small>{selectedCategory?.name || 'Bill payment'}</small></div></div><div className="bills-side-rule" /><div className="bills-side-step"><span>01</span><div><b>Enter details</b><small>Use the exact account or meter number.</small></div></div><div className="bills-side-step"><span>02</span><div><b>Verify</b><small>We confirm the customer with the live provider.</small></div></div><div className="bills-side-step"><span>03</span><div><b>Pay</b><small>Your wallet is charged after verification.</small></div></div></section>
        <section className="bills-trust-panel"><ShieldCheck size={18} /><div><b>Nothing moves too early.</b><p>Customer verification happens before the payment request is submitted.</p></div></section>
      </aside>
    </div>
    {done && <PurchaseSuccessPop kind="bill" onClose={() => setDone(null)} />}
  </>;
}