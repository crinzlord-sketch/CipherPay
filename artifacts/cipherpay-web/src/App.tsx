import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AnimatedDialogProvider, useAnimatedDialog } from './components/animated-dialog';
import SmsVerification from './pages/SmsVerification';
import SmsPoolExtrasPage from './pages/SmsPoolExtrasPage';
import LongTermNumbersPage from './pages/LongTermNumbersPage';
import TemporaryEmail from './pages/TemporaryEmail';
import { KycPage } from './pages/KycPage';
import { SupportPage } from './pages/SupportPage';
import ReferralPage from './pages/ReferralPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import AdminConsole from './pages/AdminConsole';
import DataBundlesPage from './pages/DataBundlesPage';
import SocialBoostPage from './pages/SocialBoostPage';
import SocialAccountsPage from './pages/SocialAccountsPage';
import EmailProPage from './pages/EmailProPage';
import ChatPage from './pages/ChatPage';
import CryptoPage from './pages/CryptoPage';
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
  Activity, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Banknote, BarChart3, Building2, CalendarDays,
  Bell, Bolt, Check, CircleHelp, Copy, CreditCard, FileText,
  Fingerprint, Globe2, Home, Landmark, LockKeyhole, LogOut, Menu, MessageSquare,
  MoreHorizontal, Coins, Network as NetworkIcon, Plus, Receipt, RefreshCw, Send as SendIcon, Megaphone,
  Settings, ShieldCheck, Smartphone, Target, Tv, UserRound, WalletCards, Wifi, X, Eye, EyeOff, Gift, Mail, ShoppingBag, PackagePlus, Instagram,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useRoute } from 'wouter';
import './landing.css';
import LandingExtras from './components/LandingExtras';
import SellerPage from './pages/SellerPage';
import AboutPage from './pages/AboutPage';

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
  { href: '/sms', label: 'SMS verification', icon: MessageSquare },
  { href: '/sms-extras', label: 'International eSIM', icon: Globe2 },
  { href: '/long-term-numbers', label: 'Long-term numbers', icon: Smartphone },
  { href: '/temporary-email', label: 'Temporary email', icon: Globe2 },
  { href: '/email-pro', label: 'Email Pro', icon: Mail },
  { href: '/social-boost', label: 'Social Boost', icon: Megaphone },
  { href: '/social-accounts', label: 'Social Accounts', icon: ShoppingBag },
  { href: '/crypto', label: 'Crypto', icon: Coins },
  { href: '/data', label: 'Data bundles', icon: Wifi },
  { href: '/chat', label: 'Find & chat', icon: MessageSquare },
  { href: '/transactions', label: 'Transactions', icon: Activity },
  { href: '/referrals', label: 'Refer & earn', icon: Gift },
  { href: '/send', label: 'Send money', icon: SendIcon },
];
const utilityNav = [
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/profile', label: 'Profile', icon: UserRound },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/kyc', label: 'Identity & KYC', icon: ShieldCheck },
  { href: '/support', label: 'Support', icon: CircleHelp },
  { href: '/admin', label: 'Admin console', icon: LockKeyhole },
];

const serviceFeatureForPath = (path: string) => {
  if (path === '/fund' || path.startsWith('/fund/')) return 'wallet_funding';
  if (path === '/send' || path.startsWith('/send/')) return 'transfers';
  if (path === '/data' || path.startsWith('/data/')) return 'data';
  if (path === '/sms' || path.startsWith('/sms/')) return 'sms';
  if (path === '/sms-extras' || path.startsWith('/sms-extras/')) return 'sms_esim';
  if (path === '/long-term-numbers' || path.startsWith('/long-term-numbers/')) return 'sms_rentals';
  if (path === '/temporary-email' || path.startsWith('/temporary-email/')) return 'temporary_email';
  if (path === '/social-boost' || path.startsWith('/social-boost/')) return 'social_boost';
  if (path === '/social-accounts' || path.startsWith('/social-accounts/')) return 'social_accounts';
  if (path === '/email-pro' || path.startsWith('/email-pro/')) return 'email_pro';
  if (path === '/crypto' || path.startsWith('/crypto/')) return 'crypto';
  return null;
};

function ServiceMaintenance({ serviceLabel, comingSoon = false }: { serviceLabel: string; comingSoon?: boolean }) {
  return <section className="service-maintenance" aria-live="polite">
    <div className="service-maintenance-mark"><span /><span /><span /></div>
    <span className="eyebrow">{comingSoon ? 'CIPHERPAY / CRYPTO' : 'SERVICE / TEMPORARILY UNAVAILABLE'}</span>
    <h1>{comingSoon ? `${serviceLabel} is coming soon.` : `${serviceLabel} is under maintenance.`}</h1>
    <p>{comingSoon ? 'We’re finishing the wallet, blockchain and NGN off-ramp infrastructure before real assets are enabled. Your CipherPay account stays unchanged while we prepare it.' : 'We’re making a few improvements behind the scenes, so this service is temporarily unavailable. Your account and balance are safe, and there’s nothing you need to do.'}</p>
    <div className="service-maintenance-note"><span>●</span><div><b>{comingSoon ? 'Built for multi-asset crypto.' : 'Thanks for your patience.'}</b><small>{comingSoon ? 'BTC, ETH, SOL, USDT, USDC and additional supported assets will be introduced as provider and compliance onboarding is completed.' : 'Please check back shortly. We’ll restore access as soon as the service is ready.'}</small></div></div>
  </section>;
}

function useToken() {
  return typeof window !== 'undefined' ? window.localStorage.getItem('cipherpay_token') : null;
}

function TikTokLogo({ size = 23 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 448 512" aria-hidden="true" focusable="false" fill="currentColor">
    <path d="M448,209.91a210.06,210.06,0,0,1-122.8-39.7V349.4A162.55,162.55,0,1,1,185,188.31V278.2a74.62,74.62,0,1,0,52.24,71.2V0h88.24a121.18,121.18,0,0,0,1.86,22.17A122.18,122.18,0,0,0,381,95.86a121.43,121.43,0,0,0,67,20.14Z"/>
  </svg>;
}

function Logo({ compact = false, onHomeClick }: { compact?: boolean; onHomeClick?: () => void }) {
  return <Link href="/" onClick={onHomeClick ? (event) => { event.preventDefault(); onHomeClick(); } : undefined} className={`brand ${compact ? 'brand-compact' : ''}`} data-testid="link-brand">
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
  const [notificationReturnPath, setNotificationReturnPath] = useState<string>('/');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [serviceFeatures, setServiceFeatures] = useState<Record<string, boolean> | null>(null);
  const [sellerAccess, setSellerAccess] = useState(false);
  const { confirm } = useAnimatedDialog();
  const me = useGetMe({ query: { enabled: !!useToken(), queryKey: ['/api/auth/me'] } });
  const user = me.data as any;
  const initials = user ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}` : 'CP';
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.querySelector('.content')?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location]);
  useEffect(() => {
    const openFromQuickActions = () => setMobileOpen(true);
    window.addEventListener('cipherpay:open-all-menu', openFromQuickActions);
    return () => window.removeEventListener('cipherpay:open-all-menu', openFromQuickActions);
  }, []);
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
    const loadSellerAccess = async () => {
      if (!useToken()) { if (active) setSellerAccess(false); return; }
      try {
        const response = await apiRequest<any>('/api/sellers/status');
        if (active) setSellerAccess(response?.approved === true);
      } catch {
        if (active) setSellerAccess(false);
      }
    };
    void loadSellerAccess();
    return () => { active = false; };
  }, [location]);
  useEffect(() => {
    const featureKey = serviceFeatureForPath(location);
    if (!featureKey || location.startsWith('/admin') || !useToken()) {
      return;
    }

    const controller = new AbortController();
    const loadServiceFeatures = async () => {
      try {
        const response = await fetch(apiUrl('/api/service-features'), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json();
        if (!controller.signal.aborted) {
          setServiceFeatures(payload.data ?? null);
        }
      } catch {
        // Availability is advisory. A failed check must never blank, reload,
        // or otherwise block the current page; the API enforces maintenance
        // server-side for the actual service request.
      }
    };

    void loadServiceFeatures();
    return () => controller.abort();
  }, [location]);
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
  useEffect(() => {
    let active = true;
    const loadUnreadChats = async () => {
      if (!useToken()) {
        if (active) setUnreadChats(0);
        return;
      }
      try {
        const response = await apiRequest<{ chats?: Array<{ unreadCount?: number }> }>('/api/chat/list');
        const total = (response.chats ?? []).reduce((sum, chat) => sum + Number(chat.unreadCount ?? 0), 0);
        if (active) setUnreadChats(total);
      } catch {
        if (active) setUnreadChats(0);
      }
    };
    void loadUnreadChats();
    const interval = window.setInterval(() => void loadUnreadChats(), 10000);
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
    // Hard-navigate immediately so the authenticated shell and cached user state are gone without a manual refresh.
    window.location.replace('/');
  };
  const allNav = sellerAccess ? [...nav, { href: "/seller", label: "Seller", icon: PackagePlus }] : nav;
  const linkList = (items: typeof nav) => items.map(({ href, label, icon: Icon }) => {
    const badge = href === '/chat' ? unreadChats : href === '/notifications' ? unreadNotifications : 0;
    return (
      <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`nav-item ${location === href ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
        <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{badge > 0 && <b className="nav-unread-badge">{badge > 99 ? '99+' : badge}</b>}
      </Link>
    );
  });
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-top"><Logo compact /><button className="icon-btn mobile-close" onClick={() => setMobileOpen(false)} data-testid="button-close-menu" aria-label="Close navigation"><X size={19} /></button></div>
      <div className="nav-group"><span className="nav-caption">ALL</span>{linkList(allNav)}</div>
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
    <button className={`scrim ${mobileOpen ? "open" : ""}`} onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-scrim" />
    <main className="main-area">
       <header className="topbar"><button className={`icon-btn menu-toggle ${mobileOpen ? "is-open" : ""}`} onClick={() => setMobileOpen((open) => !open)} aria-expanded={mobileOpen} aria-label={mobileOpen ? "Close navigation" : "Open navigation"} data-testid="button-open-menu"><span className="cp-menu-icon"><Menu size={21} /><X size={21} /></span></button><div className="mobile-logo"><Logo /></div><div className="topbar-spacer" /><button type="button" className="icon-btn notification-button" onClick={() => {
        if (location === '/notifications') {
          setLocation(notificationReturnPath || '/');
        } else {
          setNotificationReturnPath(location || '/');
          setLocation('/notifications');
        }
      }} aria-label={location === '/notifications' ? 'Close notifications' : unreadNotifications > 0 ? `Open notifications, ${unreadNotifications} unread` : 'Open notifications'} aria-pressed={location === '/notifications'} data-testid="button-notifications"><Bell size={19} />{unreadNotifications > 0 && <i />}</button>{user && <span className="topbar-name">{user.firstName}</span>}<button className="logout-link" onClick={() => void logout()} data-testid="button-logout"><LogOut size={16} /> <span>Log out</span></button></header>
      <div className="content">{(() => {
        const featureKey = serviceFeatureForPath(location);
        const maintenance = Boolean(!user?.isAdmin && featureKey && serviceFeatures && serviceFeatures[featureKey] === false);
        const labels: Record<string, string> = {
          transfers: 'Transfers',
          data: 'Data bundles',
          wallet_funding: 'Wallet funding',
          airtime: 'Airtime',
          bills: 'Bill payments',
          sms: 'SMS verification',
          temporary_email: 'Temporary email',
          social_boost: 'Social Boost',
          social_accounts: 'Social Accounts',
          email_pro: 'Email Pro',
          crypto: 'Crypto',
        };
        return maintenance ? <ServiceMaintenance serviceLabel={labels[featureKey] ?? 'This service'} comingSoon={featureKey === 'crypto'} /> : children;
      })()}</div>
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
      <div className="auth-sidekick-mockups" aria-hidden="true">
        <div className="auth-sidekick-device sidekick-one"><div className="auth-sidekick-screen"><b>Wallet</b><strong>₦24,680</strong><span>Available balance</span><i>Ready to move</i></div></div>
        <div className="auth-sidekick-device sidekick-two"><div className="auth-sidekick-screen"><b>Activity</b><strong>+₦20,000</strong><span>Wallet funded</span><i>Payment complete</i></div></div>
      </div>
      <div className="auth-quote"><span className="auth-overline">CIPHERPAY</span><span className="quote-mark">“</span><div className="auth-quote-line"><span/><span/><span/></div><h2>Your digital<br /><em>sidekick.</em></h2><p>One calm place to fund, spend, send, and stay in control.</p><div className="auth-benefits"><span><b>01</b> Move with clarity</span><span><b>02</b> Stay protected</span><span><b>03</b> Keep momentum</span></div></div><div className="auth-footer"><span>Built for the way life moves.</span><span>© 2025 CipherPay</span></div>
    </div>
    <div className="auth-form-wrap"><div className="auth-form-inner"><div className="mobile-auth-brand"><Logo /></div><div className="eyebrow">CIPHERPAY / PERSONAL</div><h1>{title}</h1><p className="auth-detail">{detail}</p>{children}<p className="auth-legal">By continuing, you agree to our Terms and Privacy Policy.</p></div></div>
  </div>;
}

function LandingPage() {
  const [, setLocation] = useLocation();
  const [authNavigating, setAuthNavigating] = useState<'login' | 'register' | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [supportForm, setSupportForm] = useState({ email: '', subject: '', category: 'general', message: '' });
  const [supportSending, setSupportSending] = useState(false);
  const [supportSent, setSupportSent] = useState(false);
  const [supportError, setSupportError] = useState('');
  useEffect(() => {
    const root = document.querySelector('.cp-landing');
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-cp-reveal]'));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('is-visible', entry.isIntersecting);
      });
    }, { threshold: 0.14, rootMargin: '-8% 0px -8% 0px' });
    items.forEach((item) => observer.observe(item));
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        root.style.setProperty('--cp-scroll', String(window.scrollY));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);
  const scrollToSection = (id: string) => {
    setMobileNavOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const goToAuth = (mode: 'login' | 'register') => {
    if (authNavigating) return;
    setAuthNavigating(mode);
    window.requestAnimationFrame(() => { window.setTimeout(() => { window.history.pushState({}, '', mode === 'login' ? '/login' : '/register'); window.dispatchEvent(new PopStateEvent('popstate')); }, 560); });
  };
  const openSupport = () => { setMobileNavOpen(false); setSupportSent(false); setSupportError(''); setSupportOpen(true); };
  const submitSupport = async (event: React.FormEvent) => {
    event.preventDefault();
    setSupportSending(true); setSupportError('');
    try {
      await apiRequest('/api/support/contact', { method: 'POST', body: JSON.stringify({ ...supportForm, message: `[Guest email: ${supportForm.email}]\\n\\n${supportForm.message}` }) });
      setSupportSent(true);
      setSupportForm({ email: '', subject: '', category: 'general', message: '' });
    } catch (error: any) { setSupportError(error?.message ?? 'We could not send your message. Please try again.'); }
    finally { setSupportSending(false); }
  };
  const features = [
    { icon: WalletCards, title: 'One wallet. More control.', text: 'Fund your CipherPay wallet and keep your wallet activity in one clear place.' },
    { icon: SendIcon, title: 'CipherPay transfers.', text: 'Send money to other CipherPay users with a protected transfer flow.' },
    { icon: MessageSquare, title: 'Find & chat.', text: 'Find people by CipherPay code and chat with text, images, GIFs and replies.' },
    { icon: Smartphone, title: 'Digital services.', text: 'Use SMS verification, international eSIM, long-term numbers, data bundles and Social Boost from one account.' },
    { icon: ShoppingBag, title: 'Social Accounts.', text: 'Buy social media accounts by platform and country, pay from your CipherPay balance, and receive the account details after purchase.' },
  ];
  return <div className={`cp-landing ${authNavigating ? 'cp-auth-exit' : ''}`}>
    <div className="cp-landing-grid" aria-hidden="true" />
    {typeof document !== 'undefined' && createPortal(
      <nav className="cp-landing-nav" aria-label="Landing navigation">
        <div className="cp-landing-nav-inner">
          <Logo onHomeClick={() => { setMobileNavOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
          <div className="cp-landing-links"><button type="button" onClick={() => setLocation('/about')}>About</button><button type="button" onClick={() => scrollToSection('experience')}>Experience</button><button type="button" onClick={() => scrollToSection('features')}>Features</button><button type="button" onClick={() => scrollToSection('crypto')}>Crypto</button><button type="button" onClick={() => scrollToSection('security')}>Security</button><button type="button" onClick={openSupport}>Support</button></div>
          <div className="cp-landing-nav-actions"><button type="button" className="cp-land-btn ghost" onClick={() => goToAuth('login')}>Log in</button><button type="button" className="cp-land-btn primary" onClick={() => goToAuth('register')}>Get started <ArrowRight size={15}/></button><button type="button" className={`cp-mobile-menu-toggle ${mobileNavOpen ? "is-open" : ""}`} aria-label={mobileNavOpen ? "Close landing menu" : "Open landing menu"} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(v => !v)}><span className="cp-menu-icon"><Menu size={19}/><X size={19}/></span></button></div>
          <div className={`cp-mobile-menu ${mobileNavOpen ? "open" : ""}`} aria-hidden={!mobileNavOpen}>
            <button type="button" onClick={() => { setMobileNavOpen(false); setLocation('/about'); }}>About</button><button type="button" onClick={() => scrollToSection('features')}>Features</button><button type="button" onClick={() => scrollToSection('experience')}>Experience</button><button type="button" onClick={() => scrollToSection('crypto')}>Crypto</button><button type="button" onClick={() => scrollToSection('security')}>Security</button><button type="button" onClick={openSupport}>Support</button><button type="button" onClick={() => { setMobileNavOpen(false); goToAuth('login'); }}>Log in</button><button type="button" onClick={() => { setMobileNavOpen(false); goToAuth('register'); }}>Get started</button>
          </div>
        </div>
      </nav>,
      document.body
    )}
    <section className="cp-hero">
      <div className="cp-hero-copy">
        <span className="cp-kicker"><i/> EVERYTHING, IN ONE PLACE</span>
        <h1>Spend less.<span>Do more.</span></h1>
        <p>CipherPay brings your wallet, payments, digital services and communication together in one beautifully simple platform.</p>
        <div className="cp-hero-actions"><button type="button" className="cp-land-btn primary" onClick={() => goToAuth('register')}>Create your account <ArrowRight size={17}/></button><button type="button" className="cp-land-btn ghost" onClick={() => goToAuth('login')}>I already have an account</button></div>
        <div className="cp-hero-note"><span><ShieldCheck size={13}/> Built around control</span><span><Bolt size={13}/> Fast everyday tools</span></div>
      </div>
      <div className="cp-orbit-stage" data-cp-reveal="hero">
        <div className="cp-orbit-glow"/><div className="cp-orbit"/><div className="cp-orbit two"/>
        <div className="cp-3d-scene" aria-hidden="true">
          <div className="cp-3d-ring cp-3d-ring-a"/>
          <div className="cp-3d-ring cp-3d-ring-b"/>
          <div className="cp-3d-card cp-3d-card-back"><span>CP</span><small>EVERYDAY WALLET</small></div>
          <div className="cp-3d-card cp-3d-card-front"><small>CIPHERPAY</small><b>₦24,680</b><i/></div>
          <div className="cp-3d-coin">CP</div>
        <div className="cp-hero-depth-orbs" aria-hidden="true">
          <span className="cp-depth-orb orb-a">₦</span>
          <span className="cp-depth-orb orb-b">↗</span>
          
          <span className="cp-depth-orb orb-d">CP</span>
        </div>
        <div className="cp-hero-data-ring" aria-hidden="true">
          <i/><i/><i/><i/><i/><i/>
        </div>
        </div>
        <div className="cp-wallet-card">
          <div className="cp-card-top"><span className="cp-card-label">CIPHERPAY / WALLET</span><span className="cp-card-chip"/></div>
          <div className="cp-card-balance"><small>AVAILABLE BALANCE</small>₦24,680.00</div>
          <div className="cp-card-bottom"><span>READY WHEN YOU ARE</span><span className="cp-card-orb"/></div>
        </div>
        <div className="cp-float-pill one"><i className="cp-dot"/> <strong>Payment complete</strong></div>
        <div className="cp-float-pill two"><Globe2 size={15}/> <strong>Digital services</strong></div>
      </div>
    </section>
    <div className="cp-scatter cp-scatter-hero" aria-hidden="true">
      <div className="cp-mockup scatter-a"><div className="mock-screen"><b>Wallet</b><strong>₦24,680</strong><span>Available balance</span><i>↗ Send</i></div></div>
      <div className="cp-mockup scatter-c"><div className="mock-screen"><b>Verify</b><strong>Code confirmed</strong><span>Secure access</span><i>✓ Verified</i></div></div>
    </div>
    <section className="cp-section cp-reveal-section" id="features" data-cp-reveal>
      <div className="cp-section-head"><div><span className="cp-kicker">THE CIPHERPAY SYSTEM</span><h2>Everything you need.<br/>Nothing you don't.</h2></div><p>Designed to feel calm even when your day isn't. Every tool has a clear purpose, every flow gets out of your way.</p></div>
      <div className="cp-feature-grid">{features.map(({icon:Icon,title,text}, index)=><article className="cp-feature" data-cp-reveal style={{'--cp-delay': `${index * 70}ms`} as CSSProperties} key={title}><span className="cp-feature-icon"><Icon size={20}/></span><h3>{title}</h3><p>{text}</p></article>)}</div>
      <div className="cp-3d-feature-stage" aria-hidden="true">
        <div className="cp-3d-feature-cube"><span/><span/><span/><span/><span/><span/></div>
        <div className="cp-3d-cube-shadow"/>
      </div>
      <div className="cp-scatter cp-scatter-features" aria-hidden="true">
        <div className="cp-mockup scatter-d"><div className="mock-screen"><b>Pay bills</b><strong>Electricity</strong><span>₦12,500 • Successful</span><i>Receipt</i></div></div>
      </div>
    </section>
    <LandingExtras />
    <section className="cp-section cp-reveal-section" id="experience" data-cp-reveal>
      <div className="cp-showcase">
        <article className="cp-show-card"><span className="cp-kicker">A BETTER DEFAULT</span><h3>Small details. Big difference.</h3><p>Animated states, clear confirmations and focused screens make the platform feel responsive instead of mechanical.</p>
        <div className="cp-toggle-demo"><span>Stay in control</span><span className="cp-toggle"><i/></span></div>
        <div className="cp-mini-list"><div className="cp-mini-row"><ShieldCheck size={16}/><span>Protected account</span><span>Ready</span></div><div className="cp-mini-row"><RefreshCw size={16}/><span>Live service flow</span><span>Active</span></div></div></article>
        <article className="cp-show-card large cp-clean-security" id="security"><div className="cp-security-intro"><span className="cp-kicker">ONE ACCOUNT / MANY TOOLS</span><span className="cp-security-badge"><ShieldCheck size={14}/> Built around control</span></div><h3>Everything you use.<br/><span>One place to manage it.</span></h3><p>Fund your wallet, send to other CipherPay users, use digital services and stay connected without bouncing between different apps.</p><div className="cp-security-grid"><div className="cp-security-item"><WalletCards size={18}/><div><b>Wallet & transfers</b><small>Fund, send and track activity.</small></div><span>01</span></div><div className="cp-security-item"><Globe2 size={18}/><div><b>eSIM & long-term numbers</b><small>Travel data and provider-connected rentals.</small></div><span>02</span></div><div className="cp-security-item"><MessageSquare size={18}/><div><b>Find & chat</b><small>Connect with people on CipherPay.</small></div><span>03</span></div><div className="cp-security-item"><Megaphone size={18}/><div><b>Social Boost</b><small>Order supported social services through the connected provider.</small></div><span>04</span></div><div className="cp-security-item"><ShoppingBag size={18}/><div><b>Social Accounts</b><small>Buy available social media accounts by platform and country.</small></div><span>05</span></div></div></article>
      </div>
      <div className="cp-scatter cp-scatter-experience" aria-hidden="true">
        <div className="cp-mockup scatter-g"><div className="mock-screen"><b>Messages</b><strong>You're all set.</strong><span>Just now</span><i>Reply</i></div></div>
      </div>
    </section>
    <section className="cp-section cp-reveal-section" data-cp-reveal><div className="cp-cta">
      <div className="cp-3d-cta-prism" aria-hidden="true"><span/><span/><span/><span/></div>
      <div className="cp-scatter cp-scatter-cta" aria-hidden="true"><div className="cp-mockup scatter-j"><div className="mock-screen"><b>Long-term numbers</b><strong>Manage rentals</strong><span>Messages & extensions</span><i>Explore</i></div></div></div>
      <span className="cp-kicker">CIPHERPAY</span><h2>Make everyday feel simpler.</h2><p>One place for the things you do often, with an interface that gets out of your way.</p><div className="cp-hero-actions"><button type="button" className="cp-land-btn primary" onClick={() => goToAuth('register')}>Get started <ArrowRight size={17}/></button><button type="button" className="cp-land-btn ghost" onClick={() => goToAuth('login')}>Log in</button></div></div></section>
    <div className="cp-service-marquee" aria-hidden="true"><div><span key={`MONEY-landing-0`}>MONEY<b>◆</b></span><span key={`PAYMENTS-landing-1`}>PAYMENTS<b>◆</b></span><span key={`CRYPTO-landing-2`}>CRYPTO<b>◆</b></span><span key={`eSIM-landing-3`}>eSIM<b>◆</b></span><span key={`SOCIAL-landing-4`}>SOCIAL<b>◆</b></span><span key={`CHAT-landing-5`}>CHAT<b>◆</b></span><span key={`NUMBERS-landing-6`}>NUMBERS<b>◆</b></span><span key={`EMAIL-landing-7`}>EMAIL<b>◆</b></span><span key={`DATA-landing-8`}>DATA<b>◆</b></span></div></div>
    <footer className="cp-footer cp-footer-premium">
      <div className="cp-footer-glow cp-footer-glow-a" /><div className="cp-footer-glow cp-footer-glow-b" />
      <div className="cp-footer-top">
        <div className="cp-footer-brand"><Logo /><p>One secure place for your wallet, CipherPay transfers, communication and connected digital services.</p></div>
        <div className="cp-footer-col"><span>PRODUCT</span><a href="#experience">Everything</a><a href="#crypto">Crypto</a><a href="#features">Services</a><a href="#security">Security</a></div>
        <div className="cp-footer-col"><span>COMPANY</span><a href="#home">Home</a><a href="/login">Sign in</a><a href="/register">Create account</a><button type="button" onClick={() => setSupportOpen(true)}>Support</button></div>
        <div className="cp-footer-social"><span>FOLLOW CIPHERPAY</span><div className="cp-footer-socials">
          <a className="cp-social-3d cp-social-ig" href="https://www.instagram.com/cipherpay.app" target="_blank" rel="noreferrer" aria-label="CipherPay on Instagram"><Instagram size={23}/></a>
          <a className="cp-social-3d cp-social-tiktok" href="#" aria-label="CipherPay on TikTok"><TikTokLogo size={23}/></a>
          <a className="cp-social-3d cp-social-x" href="#" aria-label="CipherPay on X"><span className="cp-social-xmark">𝕏</span></a>
        </div></div>
      </div>
      <div className="cp-footer-orbit"><span /><span /><span /><b>CP</b></div>
      <div className="cp-footer-bottom"><span>© 2026 CipherPay. All rights reserved.</span><span>Secure payments · Digital services · Communication</span><span>Privacy · Terms</span></div>
    </footer>
    {authNavigating && <div className="cp-auth-transition" aria-hidden="true"><div className="cp-auth-transition-mark"><span className="brand-mark"><span /></span><b>Cipher<span className="brand-orange">Pay</span></b></div><div className="cp-auth-transition-line" /><span>{authNavigating === 'login' ? 'Opening your account' : 'Setting things up'}</span></div>}
    {supportOpen && createPortal(<div className="cp-support-overlay" role="dialog" aria-modal="true" aria-labelledby="guest-support-title">
      <div className="cp-support-modal"><button className="cp-support-close" type="button" onClick={() => setSupportOpen(false)} aria-label="Close support form"><X size={19}/></button>
        {!supportSent ? <form onSubmit={submitSupport}><span className="cp-kicker">GUEST SUPPORT</span><h2 id="guest-support-title">How can we help?</h2><p>Send us the details and we’ll route your message to the CipherPay support team.</p>
          <div className="cp-support-fields"><label><span>Your email</span><input type="email" required value={supportForm.email} onChange={e=>setSupportForm({...supportForm,email:e.target.value})} placeholder="you@example.com"/></label><label><span>Subject</span><input required minLength={3} value={supportForm.subject} onChange={e=>setSupportForm({...supportForm,subject:e.target.value})} placeholder="What do you need help with?"/></label><label><span>Category</span><select value={supportForm.category} onChange={e=>setSupportForm({...supportForm,category:e.target.value})}><option value="general">General</option><option value="payment">Payment</option><option value="wallet">Wallet</option><option value="account">Account</option><option value="technical">Technical issue</option><option value="verification">KYC / verification</option></select></label><label><span>Message</span><textarea required minLength={5} rows={5} value={supportForm.message} onChange={e=>setSupportForm({...supportForm,message:e.target.value})} placeholder="Tell us what happened..."/></label></div>
          <button className="cp-support-submit" type="submit" disabled={supportSending}>{supportSending ? 'Sending…' : 'Send message'} <ArrowRight size={16}/></button>
        </form> : <div className="cp-support-success"><div className="cp-support-success-icon"><Check size={22}/></div><span className="cp-kicker">MESSAGE SENT</span><h2>We’ve got it.</h2><p>Your message has been sent to the CipherPay support team. Keep an eye on your email for a response.</p><button className="cp-support-submit" type="button" onClick={() => setSupportOpen(false)}>Done</button></div>}
      </div>
    </div>, document.body)}

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
    const referral = new URLSearchParams(window.location.search).get('ref');
    if (referral) setForm((current) => ({ ...current, referralCode: referral.trim().toUpperCase() }));
  }, []);
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
    queryClient.clear();
    if (adminToken) sessionStorage.setItem('cipherpay_admin_token', adminToken);
    // Use a real browser navigation after authentication so the protected
    // shell cannot race the token write or leave the landing route mounted.
    window.location.assign('/dashboard');
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
            window.location.assign(`/verify-email?email=${encodeURIComponent(result.email ?? email.trim().toLowerCase())}`);
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
        <div className="otp-help" role="note">
          <Mail size={17} />
          <div>
            <strong>Can’t find your code?</strong>
            <span>Check your Spam or Junk folder. If you find the CipherPay email there, open it and tap <b>Report as not spam</b> (or <b>Not spam</b>) so future emails can reach your inbox.</span>
          </div>
        </div>
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
        <Button type="submit" className="full-btn" disabled={mutation.isPending} data-testid="button-login">{mutation.isPending ? 'Sending OTP…' : 'Sign in'} <ArrowRight size={17} /></Button>
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
        onSuccess: (result: any) => {
          if (!result?.token) {
            setError('Verification succeeded, but no sign-in session was returned. Please sign in again.');
            return;
          }
          localStorage.setItem('cipherpay_token', result.token);
          if (result.adminToken) sessionStorage.setItem('cipherpay_admin_token', result.adminToken);
          setLocation('/dashboard');
        },
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
      <div className="otp-help" role="note">
        <Mail size={17} />
        <div>
          <strong>Can’t find your code?</strong>
          <span>Check your Spam or Junk folder. If you find the CipherPay email there, open it and tap <b>Report as not spam</b> (or <b>Not spam</b>) so future emails can reach your inbox.</span>
        </div>
      </div>
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
      <Field label="Six-digit reset code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={4} placeholder="000000" value={code} onChange={(event: any) => setCode(event.target.value.replace(/\D/g, '').slice(0, 4))} required data-testid="input-reset-code" />
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
  const [form, setForm] = useState({ firstName: '', lastName: '', email: authDraft.email, phone: '', password: authDraft.password, confirmPassword: '', referralCode: '' });
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
        referralCode: form.referralCode.trim().toUpperCase() || undefined,
      } as any,
    }, {
      onSuccess: (result: any) => {
        setFaceMood('success');
        setFaceReaction((value) => value + 1);
        authDraft.email = '';
        authDraft.password = '';
        if (result.requiresEmailVerification) {
          setLocation(`/verify-email?email=${encodeURIComponent(form.email.trim().toLowerCase())}`);
         } else {
          window.location.assign('/dashboard');
        }
      },
       onError: (reason: any) => { setFaceMood('error'); setFaceReaction((value) => value + 1); setError(reason?.message ?? 'We could not create your account. Please review your details.'); },
    });
  };
  return <AuthLayout title="Start with CipherPay." detail="A calmer way to manage your day-to-day."><form className="auth-form" onSubmit={submit}><AuthBuddy key={`register-buddy-${faceReaction}`} field={activeField} hasText={Boolean(form.firstName || form.lastName || form.email || form.password || form.confirmPassword)} gaze={gaze} typing={typing} mood={faceMood} buddyRef={buddyRef} /><div className="field-row"><Field label="First name" placeholder="Ada" value={form.firstName} onFocus={(event: any) => { setActiveField('name'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('firstName')} required data-testid="input-first-name" /><Field label="Last name" placeholder="Okafor" value={form.lastName} onFocus={(event: any) => { setActiveField('name'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('lastName')} required data-testid="input-last-name" /></div><Field label="Email address" type="email" autoComplete="username" placeholder="you@example.com" value={form.email} onFocus={(event: any) => { setActiveField('email'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('email')} required data-testid="input-email" /><Field label="Phone number" type="tel" placeholder="Your phone number" value={form.phone} onChange={update('phone')} required data-testid="input-phone" /><label className="field"><span>Avatar style</span><select value={gender} onChange={(event) => setGender(event.target.value as 'male' | 'female')} data-testid="select-avatar-gender"><option value="male">Male</option><option value="female">Female</option></select></label><Field label="Referral code (optional)" placeholder="e.g. CB7K2P9Q" value={form.referralCode} onChange={update('referralCode')} autoCapitalize="characters" data-testid="input-referral-code" /><label className="field"><span>Create password</span><div className="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 6 characters" value={form.password} onFocus={(event: any) => { setActiveField('password'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('password')} required minLength={6} data-testid="input-password" /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-toggle-password">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><label className="field"><span>Confirm password</span><div className="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Repeat your password" value={form.confirmPassword} onFocus={(event: any) => { setActiveField('password'); updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze); }} onSelect={(event: any) => updateBuddyGaze(event.currentTarget, buddyRef.current, setGaze)} onChange={update('confirmPassword')} required minLength={6} data-testid="input-confirm-password" /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} data-testid="button-toggle-confirm-password">{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>{error && <div className="error-box">{error}</div>}<Button type="submit" className="full-btn" disabled={mutation.isPending} data-testid="button-register">{mutation.isPending ? 'Sending OTP…' : 'Create account'} <ArrowRight size={17} /></Button></form><p className="auth-switch">Already have an account? <Link href="/login" className="text-link" data-testid="link-login">Sign in</Link></p></AuthLayout>;
}

function Dashboard() {
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
  const snapshotMaxDaily = Math.max(...(s?.daily ?? []).map((item: any) => Number(item.spent ?? 0)), 1);
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
        <div className="quick-actions"><div className="section-head"><h2>Explore services</h2><span className="quick-actions-label">Quick actions</span><button type="button" className="quick-actions-view-all" onClick={() => window.dispatchEvent(new Event('cipherpay:open-all-menu'))} aria-label="View all services" data-testid="button-quick-actions-view-all">View All <ArrowRight size={15} /></button></div>
          <div className="action-row">
            <Link href="/social-accounts" className="action-tile" data-testid="link-quick-social-accounts">
              <span className="action-icon purple"><ShoppingBag size={19} /></span><b>Social Accounts</b><small>Buy social accounts</small>
            </Link>
            <Link href="/social-boost" className="action-tile" data-testid="link-quick-social-boost"><span className="action-icon orange"><Target size={19} /></span><b>Social Boost</b><small>Grow your social presence</small></Link>
            <Link href="/sms" className="action-tile" data-testid="link-quick-sms"><span className="action-icon green"><MessageSquare size={19} /></span><b>SMS verification</b><small>Get a verification number</small></Link>
          </div>
        </div>
      </section>
       <section className="dashboard-lower">
         <div className="panel transactions-panel"><div className="section-head"><div><h2>Recent activity</h2><span>Your latest wallet movements</span></div><Link href="/transactions" className="text-link" data-testid="link-view-transactions">View all <ArrowRight size={15} /></Link></div>{summary.isFetching && <div className="skeleton-line" />}{transactions.length ? transactions.slice(0, 5).map((tx: any) => <TransactionRow key={tx.id} tx={tx} onClick={setSelectedTransaction} />) : <EmptyState icon={<Activity size={22} />} title="Your activity will show here" text="Fund your wallet or make a payment to get started." action={<Link href="/fund" className="text-link" data-testid="link-empty-fund">Fund wallet</Link>} />}</div>
         <div className="panel insight-panel"><div className="section-head"><div><h2>Money snapshot</h2><span>This month</span></div><Link href="/spending" className="text-link money-snapshot-view-all" data-testid="link-view-money-snapshot">View all <ArrowRight size={15} /></Link></div><div className="pulse-number">{s ? money.format(s.monthlySpend ?? 0) : "₦0.00"}</div><span className="muted">Spent this month</span><div className="snapshot-period-grid"><div><small>Today</small><b>{s ? money.format(s.todaySpend ?? 0) : "₦0.00"}</b></div><div><small>This week</small><b>{s ? money.format(s.weeklySpend ?? 0) : "₦0.00"}</b></div><div><small>This year</small><b>{s ? money.format(s.yearlySpend ?? 0) : "₦0.00"}</b></div></div><div className="mini-bars">{(s?.daily ?? []).map((day: any) => <i key={day.date} style={{ height: Math.max(10, Math.min(100, ((Number(day.spent ?? 0) / snapshotMaxDaily) * 100))) + "%" }} title={day.label + ": " + money.format(day.spent ?? 0)} />)}</div><div className="pulse-meta"><span>Funded <b>{s ? money.format(s.totalFunded) : "₦0"}</b></span><span>Transfers <b>{s?.totalTransfers ?? 0}</b></span><span>Withdrawals <b>{s ? money.format(s.totalWithdrawn) : "₦0"}</b></span></div></div>
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
  let meta: any = {};
  try { meta = typeof transaction.metadata === 'string' ? JSON.parse(transaction.metadata) : (transaction.metadata ?? {}); } catch { meta = {}; }
  const isExternal = String(transaction.type ?? '') === 'withdraw';
  const isInternal = String(transaction.type ?? '') === 'transfer_out' || String(transaction.type ?? '') === 'transfer_in';
  const [resolvedBankName, setResolvedBankName] = useState('');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    if (!isExternal) return;
    const storedName = String(meta.bankName ?? '').trim();
    const bankCode = String(meta.bankCode ?? '').trim();
    if (storedName && !/^\d+$/.test(storedName)) {
      setResolvedBankName(storedName);
      return;
    }
    let active = true;
    apiRequest<{ data: Array<{ name: string; code: string }> }>('/api/bank/list')
      .then((payload) => {
        if (!active) return;
        const match = (payload.data ?? []).find((bank) => String(bank.code) === bankCode || String(bank.code) === storedName);
        setResolvedBankName(match?.name ?? '');
      })
      .catch(() => {});
    return () => { active = false; };
  }, [isExternal, meta.bankName, meta.bankCode]);

  const bankDisplayName = resolvedBankName || (
    meta.bankName && !/^\d+$/.test(String(meta.bankName).trim())
      ? String(meta.bankName)
      : 'Bank transfer'
  );
  const recipientName = String(meta.accountName ?? '').trim();
  const receiptTitle = isExternal
    ? `Withdrawal to ${recipientName || 'bank account'}`
    : (transaction.description || 'Transaction details');

  const details = isExternal
    ? [
        ['Recipient', recipientName || 'Bank account'],
        ['Bank', bankDisplayName],
        ['Account number', meta.accountNumber || 'Not available'],
        ['Reference', transaction.reference || 'Not available'],
        ['Fee', transaction.fee == null ? '—' : money.format(transaction.fee)],
      ]
    : [
        ...(isInternal && meta.recipientAccount ? [['Recipient account', String(meta.recipientAccount)]] : []),
        ['Reference', transaction.reference || 'Not available'],
        ['Type', String(transaction.type ?? 'transaction').replaceAll('_', ' ')],
        ['Date', transaction.createdAt ? new Date(transaction.createdAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available'],
        ['Fee', transaction.fee == null ? '—' : money.format(transaction.fee)],
      ];

  const receipt = (
    <div className="animated-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="animated-dialog transaction-receipt" role="dialog" aria-modal="true" aria-labelledby="transaction-receipt-title" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="animated-dialog-close" onClick={onClose} aria-label="Close transaction receipt"><X size={17} /></button>
        <span className={`receipt-status-icon ${positive ? 'positive' : ''}`}><Check size={21} /></span>
        <span className="receipt-kicker">CIPHERPAY / RECEIPT</span>
        <h2 id="transaction-receipt-title">{receiptTitle}</h2>
        <strong className={`receipt-amount ${positive ? 'positive' : ''}`}>{positive ? '+' : '−'}{money.format(Math.abs(transaction.amount ?? 0))}</strong>
        <span className={`receipt-status receipt-status-${status}`}>{status}</span>
        <div className="receipt-details">{details.map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
      </section>
    </div>
  );

  return createPortal(receipt, document.body);
}

function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><span className="empty-icon">{icon}</span><b>{title}</b><p>{text}</p>{action}</div>; }
function LoadingPage({ title = 'Loading' }: { title?: string }) { return <div className="loading-state"><div className="loading-mark" /><h2>{title}</h2><div className="skeleton-block" /><div className="skeleton-block short" /></div>; }
function ErrorPage({ retry }: { retry: () => void }) { return <div className="center-state"><div className="error-symbol">!</div><h2>Something went off course</h2><p>We could not load this view. Your money is safe.</p><Button onClick={retry} variant="secondary" data-testid="button-retry"><RefreshCw size={16} /> Try again</Button></div>; }

function TransferAccountPanel({ result, requestedAmount, paymentStatus, onClose, onReset }: { result: any; requestedAmount: number; paymentStatus: 'waiting' | 'success' | 'failed'; onClose: () => void; onReset: () => void }) {
  const [copiedField, setCopiedField] = useState('');
  const [claiming, setClaiming] = useState(false);
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
          <div><span>Send to this account</span><strong>Bank transfer account</strong></div>
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
  const [amount,setAmount]=useState('');
  const [channel,setChannel]=useState('card');
  const [result,setResult]=useState<any>(null);
  const [paymentStatus,setPaymentStatus]=useState<'waiting'|'success'|'failed'>('waiting');
  const [transferOpen,setTransferOpen]=useState(false);
  const [error,setError]=useState('');
  const routes=[{value:'bank_transfer',icon:Landmark,label:'Bank transfer',note:'One-time transfer account'},{value:'card',icon:CreditCard,label:'Debit card',note:'Secure Flutterwave checkout'}];

  useEffect(()=>{const params=new URLSearchParams(window.location.search);const reference=params.get('tx_ref');const redirectStatus=(params.get('status')||'').toLowerCase();if(!reference)return;let active=true;let started=Date.now();let fallbackUsed=false;let timer:number|undefined;
    const poll=async()=>{try{const token=useToken();const r=await fetch(apiUrl('/api/wallet/fund/status?reference='+encodeURIComponent(reference)),{headers:{...(token?{Authorization:'Bearer '+token}:{})},credentials:'include',cache:'no-store'});const p=await r.json().catch(()=>null);if(!active)return;if(p?.status==='success'){setPaymentStatus('success');void queryClient.invalidateQueries({queryKey:['/api/wallet']});void queryClient.invalidateQueries({queryKey:['/api/dashboard']});void queryClient.invalidateQueries({queryKey:['/api/wallet/stats']});window.history.replaceState({},'','/fund');return;}if(p?.status==='failed'||redirectStatus==='cancelled'||redirectStatus==='canceled'){setPaymentStatus('failed');window.history.replaceState({},'','/fund');return;
      }
      // If the webhook has not arrived after 5s, perform one server-side provider
      // verification. Normal success detection stays DB-only so we don't hammer Flutterwave.
      if(!fallbackUsed && Date.now()-started>=5000){fallbackUsed=true;await fetch(apiUrl('/api/wallet/fund/verify'),{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},credentials:'include',body:JSON.stringify({reference,status:redirectStatus})}).catch(()=>{});}
    }catch{}
    if(active)timer=window.setTimeout(poll,800);
    };void poll();return()=>{active=false;if(timer)clearTimeout(timer);};},[]);

  useEffect(()=>{if(!result?.reference)return;let active=true;let timer:number|undefined;let started=Date.now();let fallbackUsed=false;
    const poll=async()=>{try{const token=useToken();const r=await fetch(apiUrl('/api/wallet/fund/status?reference='+encodeURIComponent(result.reference)),{headers:{...(token?{Authorization:'Bearer '+token}:{})},credentials:'include',cache:'no-store'});const p=await r.json().catch(()=>null);if(!active)return;if(p?.status==='success'){setPaymentStatus('success');void queryClient.invalidateQueries({queryKey:['/api/wallet']});void queryClient.invalidateQueries({queryKey:['/api/dashboard']});void queryClient.invalidateQueries({queryKey:['/api/wallet/stats']});return;}if(p?.status==='failed'){setPaymentStatus('failed');return;
      }
      if(!fallbackUsed && Date.now()-started>=5000){fallbackUsed=true;await fetch(apiUrl('/api/wallet/fund/verify'),{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},credentials:'include',body:JSON.stringify({reference:result.reference})}).catch(()=>{});}
    }catch{}
    timer=window.setTimeout(poll,800);
    };void poll();return()=>{active=false;if(timer)clearTimeout(timer);};},[result?.reference]);

  const submit=(e:React.FormEvent)=>{e.preventDefault();setError('');setResult(null);setPaymentStatus('waiting');setTransferOpen(false);const requestedAmount=parseGroupedDigits(amount);if(!requestedAmount||requestedAmount<100){setError('Minimum funding amount is ₦100.');return;}
    mutation.mutate({data:{amount:requestedAmount,channel}},{onSuccess:(value:any)=>{setResult(value);if(value.checkoutUrl)window.location.assign(value.checkoutUrl);else if(value.account)setTransferOpen(true)},onError:(reason:any)=>setError(reason?.message??'Could not prepare wallet funding.')});
  };
  return <><PageTitle eyebrow="MONEY / FUND" title="Add money to your wallet." detail="Choose the route that works for you. Funds appear as soon as they settle." />
    <div className="form-layout"><form className="panel main-form" onSubmit={submit}>
      <div className="form-section-title"><span className="step">01</span><div><h2>How much?</h2><p>Enter an amount in naira.</p></div></div>
      <label className="amount-input"><span>₦</span><input type="text" inputMode="numeric" placeholder="0.00" value={amount} onChange={e=>setAmount(formatGroupedDigits(e.target.value))} required /></label>
      <div style={{marginTop:8,fontSize:12,color:'var(--muted-foreground, #737373)'}}>Minimum funding amount: <b>₦100</b>.</div>
      <div className="amount-chips">{['5000','10000','25000','50000'].map(v=><button type="button" key={v} onClick={()=>setAmount(formatGroupedDigits(v))} className="amount-chip">₦{Number(v).toLocaleString()}</button>)}</div>
      <div className="form-section-title with-top"><span className="step">02</span><div><h2>Choose a route</h2><p>Select how you want to pay.</p></div></div>
      <div className="choice-grid">{routes.map(({value,icon:Icon,label,note})=><button type="button" key={value} className={`choice-card ${channel===value?'selected':''}`} onClick={()=>setChannel(value)}><span className="choice-check">{channel===value&&<Check size={13}/>}</span><span className="choice-icon"><Icon size={19}/></span><b>{label}</b><small>{note}</small></button>)}</div>
      {error&&<div className="error-box" role="alert">{error}</div>}
      {paymentStatus==='success'&&<div className="success-box transfer-funding-success" role="status"><Check size={20}/><div><b>Funding successful</b><span>{money.format(parseGroupedDigits(amount))} has been added to your CipherPay wallet.</span></div></div>}
      {paymentStatus==='failed'&&<div className="error-box" role="alert" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}><span>This payment was cancelled or could not be completed. Your wallet was not credited.</span><button type="button" className="animated-dialog-close" onClick={()=>{setPaymentStatus('waiting');setResult(null);setError('');window.history.replaceState({},'','/fund');}} aria-label="Close payment message"><X size={17}/></button></div>}
      {!result?.account&&paymentStatus==='waiting'&&<Button type="submit" className="full-btn" disabled={!amount||mutation.isPending}>{mutation.isPending?'Preparing…':channel==='card'?'Continue to card payment':'Generate transfer account'} <ArrowRight size={17}/></Button>}
    </form><div className="side-note"><span className="side-note-icon"><ShieldCheck size={20}/></span><h3>Built for peace of mind.</h3><p>Every transaction is encrypted and your funds stay visible at every step.</p><div className="side-rule"/><b style={{display:'block',marginBottom:6}}>Funding limit</b><span style={{fontSize:12,lineHeight:1.5}}>Minimum deposit: ₦100.</span><div className="side-rule"/><span className="mono">CIPHER / FLUTTERWAVE-SECURE</span></div></div>
    {result?.account&&transferOpen&&<div className="transfer-modal-backdrop" role="presentation" onMouseDown={ev=>{if(ev.target===ev.currentTarget)setTransferOpen(false)}}><div className="transfer-modal-card" role="dialog" aria-modal="true"><TransferAccountPanel result={result} requestedAmount={parseGroupedDigits(amount)} paymentStatus={paymentStatus} onClose={()=>setTransferOpen(false)} onReset={()=>{setResult(null);setAmount('');setTransferOpen(false)}} /></div></div>}
  </>;
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
  const [hasTransferPin, setHasTransferPin] = useState<boolean | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinModalPin, setPinModalPin] = useState('');
  const [pinModalConfirm, setPinModalConfirm] = useState('');
  const [pinModalError, setPinModalError] = useState('');
  const [pinModalBusy, setPinModalBusy] = useState(false);
  const recipientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (banks.length) return;
    let active = true;
    setLoadingBanks(true);
    apiRequest<{ data: any[] }>('/api/bank/list')
      .then((payload) => { if (active) setBanks(payload.data ?? []); })
      .catch((e: any) => { if (active) setError(e?.message ?? 'Could not load banks.'); })
      .finally(() => { if (active) setLoadingBanks(false); });
    return () => { active = false; };
  }, [mode, banks.length]);

  const bankQuery = bankSearch.trim().toLowerCase();
  const normalizeBankSearch = (value: unknown) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const filteredBanks = banks
    .map((bank) => {
      const name = String(bank.name ?? '').toLowerCase();
      const code = String(bank.code ?? '').toLowerCase();
      const slug = String(bank.slug ?? '').toLowerCase();
      const normalizedName = normalizeBankSearch(name);
      const normalizedCode = normalizeBankSearch(code);
      const normalizedSlug = normalizeBankSearch(slug);
      const q = normalizeBankSearch(bankQuery);
      let rank = 99;
      if (!q) rank = 0;
      else if (normalizedName === q) rank = 0;              // exact bank name
      else if (normalizedName.startsWith(q)) rank = 1;     // name starts with query
      else if (normalizedSlug === q) rank = 2;             // exact slug
      else if (normalizedSlug.startsWith(q)) rank = 3;    // slug starts with query
      else if (normalizedCode === q) rank = 4;             // exact bank code
      else if (normalizedCode.startsWith(q)) rank = 5;    // code starts with query
      else if (normalizedName.includes(q)) rank = 10;     // name contains query
      else if (normalizedSlug.includes(q)) rank = 11;     // slug contains query
      else if (normalizedCode.includes(q)) rank = 12;     // code contains query
      return { bank, rank };
    })
    .filter(({ rank }) => rank < 99)
    .sort((a, b) => a.rank - b.rank || String(a.bank.name ?? '').localeCompare(String(b.bank.name ?? '')))
    .map(({ bank }) => bank);

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
    let active = true;
    apiRequest<any>('/api/auth/pin/status')
      .then((payload) => {
        if (active) setHasTransferPin(Boolean(payload?.hasPin));
      })
      .catch(() => {
        if (active) setHasTransferPin(true);
      });
    return () => { active = false; };
  }, []);

  const openTransferPinModal = () => {
    setPinModalPin('');
    setPinModalConfirm('');
    setPinModalError('');
    setPinModalOpen(true);
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

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setResult(null);
    setResultStatus('pending');

    if (mode === 'cipherpay') {
      const amount = parseGroupedDigits(form.amount);
      if (!form.recipientEmail.trim()) {
        setError('Enter the recipient email.');
        return;
      }
      if (!(amount >= 100)) {
        setError('Enter an amount of at least ₦100.');
        return;
      }
    } else {
      if (!bankForm.bankCode || !/^\d{10}$/.test(bankForm.accountNumber)) {
        setError('Choose a bank and enter a valid 10-digit account number.');
        return;
      }
      if (!bankForm.accountName) {
        void resolveBankAccount();
        return;
      }
      const amount = parseGroupedDigits(form.amount);
      if (!(amount >= 100)) {
        setError('Enter an amount of at least ₦100.');
        return;
      }
    }

    openTransferPinModal();
  };

  const performTransfer = async (pin: string) => {
    if (mode === 'cipherpay') {
      mutation.mutate(
        { data: { ...form, amount: parseGroupedDigits(form.amount), pin } as any },
        {
          onSuccess: (value: any) => { setResult(value); setResultStatus('success'); },
          onError: (reason: any) => setError(reason?.message ?? 'The transfer could not be completed.'),
        },
      );
      return;
    }

    const amount = parseGroupedDigits(form.amount);
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
          bankName: bankForm.bankName || undefined,
          pin,
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

  const authorizeAndSend = async () => {
    setPinModalError('');
    const pin = pinModalPin.replace(/\D/g, '');

    if (hasTransferPin === null) {
      setPinModalError('Still checking your transaction PIN. Please wait a moment.');
      return;
    }
    if (hasTransferPin === false) {
      if (!/^\d{6}$/.test(pin)) {
        setPinModalError('Create a 4-digit transfer PIN.');
        return;
      }
      if (!/^\d{6}$/.test(pinModalConfirm)) {
        setPinModalError('Confirm your 4-digit transfer PIN.');
        return;
      }
      if (pin !== pinModalConfirm) {
        setPinModalError('The two PINs do not match.');
        return;
      }
    } else if (!/^\d{6}$/.test(pin)) {
      setPinModalError('Enter your 4-digit transfer PIN.');
      return;
    }

    setPinModalBusy(true);
    try {
      if (hasTransferPin === false) {
        await apiRequest('/api/auth/pin/set', {
          method: 'POST',
          body: { pin, confirmPin: pinModalConfirm },
        });
        setHasTransferPin(true);
      } else {
        await apiRequest('/api/auth/pin/verify', {
          method: 'POST',
          body: { pin },
        });
      }

      setPinModalOpen(false);
      setPinModalPin('');
      setPinModalConfirm('');
      await performTransfer(pin);
    } catch (e: any) {
      const message = e?.message ?? 'Could not authorize this transfer.';
      if (/no pin set on this account/i.test(message)) {
        setHasTransferPin(false);
        setPinModalPin('');
        setPinModalConfirm('');
        setPinModalError('Your transfer PIN was cleared. Create a new 4-digit PIN to continue.');
      } else {
        setPinModalError(message);
      }
    } finally {
      setPinModalBusy(false);
    }
  };

  const busy = mutation.isPending || sendingBank;
  return <>
    <PageTitle
      eyebrow="MONEY / SEND"
      title="Send money, simply."
      detail="Send funds instantly to another CipherPay user."
    />
    <div className="form-layout">
      <form className="panel main-form" onSubmit={submit}>
        <div className="tabs send-tabs">
          <button type="button" className={`tab ${mode === 'cipherpay' ? 'active' : ''}`} onClick={() => { setMode('cipherpay'); setError(''); setResult(null); }}>
            CipherPay user
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
          {busy ? 'Sending…' : 'Continue'} <ArrowRight size={17} />
        </Button>}

        {pinModalOpen && createPortal(
          <div className="transfer-pin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pinModalBusy) setPinModalOpen(false); }}>
            <section className="transfer-pin-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-pin-modal-title" onMouseDown={(event) => event.stopPropagation()}>
              <button type="button" className="transfer-pin-modal-close" onClick={() => setPinModalOpen(false)} disabled={pinModalBusy} aria-label="Close transfer PIN prompt"><X size={19} /></button>
              <div className="transfer-pin-modal-icon"><ShieldCheck size={22} /></div>
              <span className="eyebrow">CIPHERPAY / SECURITY</span>
              {hasTransferPin === null ? (
                <>
                  <h2 id="transfer-pin-modal-title">Checking your PIN</h2>
                  <p>One moment while we check whether a transaction PIN is already set on your account.</p>
                </>
              ) : hasTransferPin === false ? (
                <>
                  <h2 id="transfer-pin-modal-title">Create your transfer PIN</h2>
                  <p>You don't have a transaction PIN yet. Create a 4-digit PIN and confirm it to authorize this transfer.</p>
                  <input className="transfer-pin-modal-input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} placeholder="Create 4-digit PIN" value={pinModalPin} onChange={(event) => setPinModalPin(event.target.value.replace(/\D/g, '').slice(0, 4))} aria-label="Create 4-digit transfer PIN" autoFocus />
                  <input className="transfer-pin-modal-input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} placeholder="Confirm PIN" value={pinModalConfirm} onChange={(event) => setPinModalConfirm(event.target.value.replace(/\D/g, '').slice(0, 4))} aria-label="Confirm transfer PIN" />
                </>
              ) : (
                <>
                  <h2 id="transfer-pin-modal-title">Enter your transfer PIN</h2>
                  <p>Enter your 4-digit PIN to authorize this transfer.</p>
                  <input className="transfer-pin-modal-input" type="password" inputMode="numeric" autoComplete="current-password" maxLength={4} placeholder="••••" value={pinModalPin} onChange={(event) => setPinModalPin(event.target.value.replace(/\D/g, '').slice(0, 4))} aria-label="4-digit transfer PIN" autoFocus onKeyDown={(event) => { if (event.key === 'Enter') void authorizeAndSend(); }} />
                </>
              )}
              {pinModalError && <div className="error-box" role="alert">{pinModalError}</div>}
              <Button type="button" className="full-btn" disabled={pinModalBusy || hasTransferPin === null} onClick={() => void authorizeAndSend()}>
                {pinModalBusy ? 'Authorizing…' : hasTransferPin === false ? 'Create PIN & continue' : 'Confirm & continue'} <ArrowRight size={17} />
              </Button>
            </section>
          </div>,
          document.body,
        )}
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

function SpendingInsightsPage() {
  const stats = useGetWalletStats({ query: { enabled: !!useToken(), queryKey: ["/api/wallet/stats"] } });
  const s: any = stats.data;
  const maxDaily = Math.max(...(s?.daily ?? []).map((item: any) => Number(item.spent ?? 0)), 1);
  const maxMonthly = Math.max(...(s?.monthly ?? []).map((item: any) => Number(item.spent ?? 0)), 1);
  const categories = (s?.categoryBreakdown ?? []).slice(0, 4);
  if (stats.isLoading) return <LoadingPage title="Loading spending insights" />;
  return <>
    <PageTitle eyebrow="MONEY / INSIGHTS" title="Your spending, clearly." detail="See what you spend today, this week, this month and across the year." action={<Link href="/" className="text-link"><ArrowLeft size={15}/> Back to overview</Link>} />
    <section className="spending-hero-grid">
      <div className="spending-total-card"><span className="section-kicker">THIS MONTH</span><strong>{money.format(s?.monthlySpend ?? 0)}</strong><span>Spent this month</span><div className="spending-total-meta"><span><small>Today</small><b>{money.format(s?.todaySpend ?? 0)}</b></span><span><small>This week</small><b>{money.format(s?.weeklySpend ?? 0)}</b></span><span><small>This year</small><b>{money.format(s?.yearlySpend ?? 0)}</b></span></div></div>
      <div className="spending-stat-card"><span className="spending-icon"><CalendarDays size={18}/></span><small>All-time spending</small><strong>{money.format(s?.totalSpent ?? 0)}</strong><span>Across recorded wallet activity</span></div>
      <div className="spending-stat-card"><span className="spending-icon"><ArrowUpRight size={18}/></span><small>Transfers sent</small><strong>{money.format(s?.totalTransfers ?? 0)}</strong><span>Money moved to others</span></div>
    </section>
    <section className="spending-dashboard-grid">
      <section className="panel spending-chart-card"><div className="section-head"><div><h2>Last 7 days</h2><span>Daily spending</span></div><BarChart3 size={19}/></div><div className="spending-bars">{(s?.daily ?? []).map((day: any) => <div className="spending-bar-item" key={day.date}><div className="spending-bar-track"><i style={{height: Math.max(3, (Number(day.spent ?? 0) / maxDaily) * 100) + "%"}} /></div><b>{day.label}</b><small>{money.format(day.spent ?? 0)}</small></div>)}</div></section>
      <section className="panel spending-chart-card"><div className="section-head"><div><h2>Last 12 months</h2><span>Monthly spending</span></div><BarChart3 size={19}/></div><div className="spending-month-list">{(s?.monthly ?? []).map((month: any) => <div className="spending-month-row" key={month.year + "-" + month.month}><span>{month.month} {month.year}</span><div><i style={{width: Math.max(2, (Number(month.spent ?? 0) / maxMonthly) * 100) + "%"}} /></div><b>{money.format(month.spent ?? 0)}</b></div>)}</div></section>
    </section>
    <section className="spending-bottom-grid">
      <section className="panel spending-breakdown-card"><div className="section-head"><div><h2>Where your money goes</h2><span>Spending by service</span></div></div>{categories.length ? categories.map((item: any) => <div className="spending-category-row" key={item.category}><span>{String(item.category).replaceAll("_"," ")}</span><div><i style={{width: Math.max(4, Math.min(100, (Number(item.amount ?? 0) / Math.max(Number(s?.totalSpent ?? 0),1))*100)) + "%"}} /></div><b>{money.format(item.amount ?? 0)}</b></div>) : <EmptyState icon={<BarChart3 size={22}/>} title="No spending data yet" text="Your spending breakdown will appear after you make a payment."/>}</section>
      <section className="panel spending-summary-card"><div className="section-head"><div><h2>Money in motion</h2><span>Recorded totals</span></div></div><div className="spending-summary-row"><span>Funded</span><b>{money.format(s?.totalFunded ?? 0)}</b></div><div className="spending-summary-row"><span>Spent</span><b>{money.format(s?.totalSpent ?? 0)}</b></div><div className="spending-summary-row"><span>Withdrawn</span><b>{money.format(s?.totalWithdrawn ?? 0)}</b></div><div className="spending-summary-row"><span>Transfers</span><b>{money.format(s?.totalTransfers ?? 0)}</b></div></section>
    </section>
  </>;
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

function ThemeBoundary() {
  const [location] = useLocation();

  useEffect(() => {
    const publicLightRoutes = ['/','/login','/register','/forgot-password','/verify-email','/reset-password'];
    const forceLight = publicLightRoutes.includes(location.split('?')[0]);
    const storedTheme = window.localStorage.getItem('cipherpay_theme');
    document.documentElement.classList.toggle('dark', !forceLight && storedTheme === 'dark');
  }, [location]);

  return null;
}

function App() {
  useEffect(() => {
    setAuthTokenGetter(() => window.localStorage.getItem('cipherpay_token'));
    return () => setAuthTokenGetter(null);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AnimatedDialogProvider>
          <ThemeBoundary />
          <Toaster />
          <Switch>
            <Route path="/login"><Login /></Route>
            <Route path="/register"><Register /></Route>
            <Route path="/forgot-password"><ForgotPassword /></Route>
            <Route path="/verify-email"><VerifyEmail /></Route>
            <Route path="/reset-password"><ResetPassword /></Route>
            <Route path="/dashboard"><ProtectedArea><Dashboard /></ProtectedArea></Route>
            <Route path="/"><HomeRoute /></Route>
            <Route path="/about"><AboutPage /></Route>
            <Route path="/fund"><ProtectedArea><Fund /></ProtectedArea></Route>
            <Route path="/send"><ProtectedArea><Send /></ProtectedArea></Route>
            <Route path="/bills/:category/:provider"><ProtectedArea><BillsPage /></ProtectedArea></Route>
            <Route path="/bills/:category"><ProtectedArea><BillsPage /></ProtectedArea></Route>
            <Route path="/bills/:category/:provider"><ProtectedArea><BillProviderPage /></ProtectedArea></Route>
            <Route path="/data"><ProtectedArea><DataBundlesPage /></ProtectedArea></Route>
            <Route path="/sms"><ProtectedArea><SmsVerification /></ProtectedArea></Route>
            <Route path="/sms-extras"><ProtectedArea><SmsPoolExtrasPage /></ProtectedArea></Route>
            <Route path="/long-term-numbers"><ProtectedArea><LongTermNumbersPage /></ProtectedArea></Route>
            <Route path="/temporary-email"><ProtectedArea><TemporaryEmail /></ProtectedArea></Route>
            <Route path="/social-boost"><ProtectedArea><SocialBoostPage /></ProtectedArea></Route>
            <Route path="/social-accounts"><ProtectedArea><SocialAccountsPage /></ProtectedArea></Route>
            <Route path="/seller"><ProtectedArea><SellerPage /></ProtectedArea></Route>
            <Route path="/email-pro"><ProtectedArea><EmailProPage /></ProtectedArea></Route>
            <Route path="/crypto"><ProtectedArea><CryptoPage /></ProtectedArea></Route>
            <Route path="/transactions"><ProtectedArea><TransactionsPage /></ProtectedArea></Route>
          <Route path="/spending"><ProtectedArea><SpendingInsightsPage /></ProtectedArea></Route>
            <Route path="/chat/:id"><ProtectedArea><ChatPage /></ProtectedArea></Route>
            <Route path="/chat"><ProtectedArea><ChatPage /></ProtectedArea></Route>
            <Route path="/notifications"><ProtectedArea><NotificationsPage /></ProtectedArea></Route>
            <Route path="/profile"><ProtectedArea><ProfilePage /></ProtectedArea></Route>
            <Route path="/settings"><ProtectedArea><SettingsPage /></ProtectedArea></Route>
            <Route path="/kyc/:verificationType"><KycDetailRoute /></Route>
            <Route path="/kyc"><ProtectedArea><KycPage /></ProtectedArea></Route>
            <Route path="/support"><ProtectedArea><SupportPage /></ProtectedArea></Route>
            <Route path="/referrals"><ProtectedArea><ReferralPage /></ProtectedArea></Route>
            <Route path="/admin"><ProtectedArea><AdminOnly><AdminConsole /></AdminOnly></ProtectedArea></Route>
            <Route><ProtectedArea><InfoPage title="Page not found." detail="The page you requested does not exist." /></ProtectedArea></Route>
          </Switch>
        </AnimatedDialogProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function HomeRoute() {
  const token = useToken();
  return token ? <ProtectedArea><Dashboard /></ProtectedArea> : <LandingPage />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const me = useGetMe({ query: { enabled: !!useToken(), queryKey: ['/api/auth/me'] } });
  const user = me.data as any;
  useEffect(() => {
    if (!me.isLoading && !user?.isAdmin) window.location.replace('/');
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

