import { ArrowLeft, CheckCircle2, ChevronRight, FileCheck2, LockKeyhole, ShieldCheck, UploadCloud, UserRound, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { apiRequest, formatWhen } from './page-api';
import { Button, ErrorState, LoadingState, Notice, PageHeading } from './PagePieces';
import './cipherpay-pages.css';

type KycStatusValue = 'not_started' | 'submitted' | 'verified' | 'rejected';
type DocumentType = 'bvn' | 'nin' | 'passport' | 'drivers_license' | 'national_id' | 'voters_card';

type KycStatus = {
  status: KycStatusValue;
  level?: number;
  verificationType?: 'basic' | 'advanced' | null;
  documentType?: DocumentType | null;
  documentNumber?: string | null;
  bvn?: string | null;
  nin?: string | null;
  submittedAt?: string | null;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
  documentFrontUrl?: string | null;
  documentBackUrl?: string | null;
  selfieUrl?: string | null;
  fullName?: string | null;
  dateOfBirth?: string | null;
  address?: string | null;
};

type KycForm = {
  verificationType: 'basic' | 'advanced';
  documentType: DocumentType;
  documentNumber: string;
  fullName: string;
  dateOfBirth: string;
  address: string;
  documentFrontImage?: string;
  documentBackImage?: string;
  selfieImage?: string;
};

type VerificationType = 'basic' | 'advanced';

const documentOptions: Array<{ value: DocumentType; label: string; hint: string; verificationType: 'basic' | 'advanced' }> = [
  { value: 'bvn', label: 'BVN', hint: 'Bank verification number', verificationType: 'basic' },
  { value: 'nin', label: 'NIN', hint: 'National identity number', verificationType: 'basic' },
  { value: 'passport', label: 'International passport', hint: 'Photo page', verificationType: 'advanced' },
  { value: 'drivers_license', label: "Driver's licence", hint: 'Government-issued', verificationType: 'advanced' },
  { value: 'national_id', label: 'National ID card', hint: 'Government-issued', verificationType: 'advanced' },
  { value: 'voters_card', label: 'Voter’s card', hint: 'PVC or temporary card', verificationType: 'advanced' },
];

const initialForm: KycForm = {
  verificationType: 'basic',
  documentType: 'bvn',
  documentNumber: '',
  fullName: '',
  dateOfBirth: '',
  address: '',
};

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('We could not read that image.'));
    reader.onerror = () => reject(new Error('We could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function statusCopy(status: KycStatusValue) {
  if (status === 'verified') return { title: 'Identity verified', body: 'Your CipherPay account is verified and ready for higher limits.', icon: CheckCircle2 };
  if (status === 'submitted') return { title: 'Review in progress', body: 'Our team is checking your details. We will update you when the review is complete.', icon: FileCheck2 };
  if (status === 'rejected') return { title: 'A little more detail is needed', body: 'Review the note below, then submit a clearer set of details.', icon: XCircle };
  return { title: 'Verification not started', body: 'Verify your identity once to keep your wallet secure and unlock more of CipherPay.', icon: ShieldCheck };
}

function verificationStatus(status: KycStatus | null, type: VerificationType) {
  if (status?.verificationType === type && status.status === 'verified') return 'Verified';
  if (status?.verificationType === type && status.status === 'submitted') return 'Under review';
  return 'Unverified';
}

export function KycPage({ detailType }: { detailType?: VerificationType }) {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<KycStatus | null>(null);
  const [form, setForm] = useState<KycForm>({ ...initialForm, verificationType: detailType ?? initialForm.verificationType });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [fileError, setFileError] = useState('');
  const [submittedPopup, setSubmittedPopup] = useState(false);
  const [expandedType, setExpandedType] = useState<VerificationType | null>(detailType ?? null);
  const [step, setStep] = useState(1);

  const loadStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await apiRequest<KycStatus>('/api/kyc/status');
      setStatus(next);
      setForm((current) => ({
        ...current,
        verificationType: next.verificationType ?? (next.documentType === 'bvn' || next.documentType === 'nin' ? 'basic' : next.documentType ? 'advanced' : current.verificationType),
        documentType: next.documentType ?? current.documentType,
        documentNumber: next.documentNumber ?? next.bvn ?? next.nin ?? current.documentNumber,
        fullName: next.fullName ?? current.fullName,
        dateOfBirth: next.dateOfBirth ?? current.dateOfBirth,
        address: next.address ?? current.address,
      }));
      if (detailType && (next.status === 'submitted' || next.status === 'verified') && next.verificationType && next.verificationType !== detailType) {
        setLocation(`/kyc/${next.verificationType}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your verification status could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    setExpandedType(detailType ?? null);
    setStep(1);
    if (detailType && status?.status !== 'submitted' && status?.status !== 'verified') {
      setForm((current) => current.verificationType === detailType ? current : {
        ...current,
        verificationType: detailType,
        documentType: documentOptions.find((option) => option.verificationType === detailType)?.value ?? current.documentType,
        documentNumber: '',
        documentFrontImage: undefined,
        documentBackImage: undefined,
        selfieImage: undefined,
      });
    }
  }, [detailType, status?.status]);

  const isLocked = status?.status === 'submitted' || status?.status === 'verified';
  const selectedDocument = useMemo(
    () => documentOptions.find((option) => option.value === form.documentType && option.verificationType === form.verificationType) ?? documentOptions.find((option) => option.verificationType === form.verificationType) ?? documentOptions[0],
    [form.documentType, form.verificationType],
  );
  const statusDetails = statusCopy(status?.status ?? 'not_started');
  const StatusIcon = statusDetails.icon;

  const updateForm = (key: keyof KycForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFormError('');
    setSuccess('');
  };

  const chooseVerificationType = (verificationType: VerificationType) => {
    setForm((current) => ({
      ...current,
      verificationType,
      ...(current.verificationType === verificationType ? {} : {
        documentType: documentOptions.find((option) => option.verificationType === verificationType)?.value ?? current.documentType,
        documentNumber: '',
        documentFrontImage: undefined,
        documentBackImage: undefined,
        selfieImage: undefined,
      }),
    }));
    setFormError('');
    setSuccess('');
  };

  const openVerification = (verificationType: VerificationType) => {
    if (isLocked && status?.verificationType && status.verificationType !== verificationType) return;
    setLocation(`/kyc/${verificationType}`);
  };

  const onFileChange = async (key: 'documentFrontImage' | 'documentBackImage' | 'selfieImage', file?: File) => {
    if (!file) return;
    setFileError('');
    try {
      const dataUrl = await readImage(file);
      setForm((current) => ({ ...current, [key]: dataUrl }));
    } catch (caught) {
      setFileError(caught instanceof Error ? caught.message : 'That image could not be added.');
    }
  };

  const validate = () => {
    const nameParts = form.fullName.trim().split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) return 'Enter your first and last name as they appear on your document.';
    if (!form.dateOfBirth) return 'Add your date of birth to continue.';
    if (form.verificationType === 'advanced' && form.address.trim().length < 8) return 'Add your residential address to continue.';
    if (!form.documentNumber.trim()) return `Enter your ${selectedDocument.label.toLowerCase()}.`;
    if ((form.documentType === 'bvn' || form.documentType === 'nin') && !/^\d{10,11}$/.test(form.documentNumber.trim())) {
      return `${selectedDocument.label} must contain 10–11 digits.`;
    }
    if (form.verificationType === 'advanced' && !form.documentFrontImage) {
      return `Add the front image of your ${selectedDocument.label.toLowerCase()}.`;
    }
    if (form.verificationType === 'advanced' && !form.selfieImage) return 'Add a clear selfie to complete verification.';
    return '';
  };

  const totalSteps = form.verificationType === 'advanced' ? 5 : 3;
  const validateStep = (currentStep: number) => {
    if (currentStep === 1) {
      if (!form.documentNumber.trim()) return `Enter your ${selectedDocument.label.toLowerCase()}.`;
      if ((form.documentType === 'bvn' || form.documentType === 'nin') && !/^\d{10,11}$/.test(form.documentNumber.trim())) {
        return `${selectedDocument.label} must contain 10–11 digits.`;
      }
    }
    if (currentStep === 2) {
      const nameParts = form.fullName.trim().split(/\s+/).filter(Boolean);
      if (nameParts.length < 2) return 'Enter your first and last name as they appear on your document.';
      if (!form.dateOfBirth) return 'Add your date of birth to continue.';
      if (form.verificationType === 'advanced' && form.address.trim().length < 8) return 'Add your residential address to continue.';
    }
    if (form.verificationType === 'advanced' && currentStep === 3 && !form.documentFrontImage) {
      return `Add the front image of your ${selectedDocument.label.toLowerCase()}.`;
    }
    if (form.verificationType === 'advanced' && currentStep === 5 && !form.selfieImage) {
      return 'Add a clear selfie to complete verification.';
    }
    return '';
  };

  const nextStep = () => {
    const issue = validateStep(step);
    if (issue) {
      setFormError(issue);
      return;
    }
    setFormError('');
    setStep((current) => Math.min(current + 1, totalSteps));
  };

  const previousStep = () => {
    setFormError('');
    setStep((current) => Math.max(current - 1, 1));
  };

  const submitKyc = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setSuccess('');
    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const next = await apiRequest<KycStatus>('/api/kyc/submit', {
        method: 'POST',
        body: {
          documentType: form.documentType,
          verificationType: form.verificationType,
          documentNumber: form.documentNumber.trim(),
          fullName: form.fullName.trim(),
          dateOfBirth: form.dateOfBirth,
          address: form.address.trim(),
           ...(form.verificationType === 'advanced' && form.documentFrontImage ? { documentFrontImage: form.documentFrontImage } : {}),
           ...(form.verificationType === 'advanced' && form.documentBackImage ? { documentBackImage: form.documentBackImage } : {}),
           ...(form.verificationType === 'advanced' && form.selfieImage ? { selfieImage: form.selfieImage } : {}),
        },
      });
      setStatus(next);
      setSuccess('Your details are in the queue for review.');
      setSubmittedPopup(true);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : 'We could not submit your details.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <main className="cp-page"><LoadingState label="Loading your verification status" /></main>;
  if (error && !status) return <main className="cp-page"><ErrorState message={error} retry={() => void loadStatus()} /></main>;

  return (
    {submittedPopup && (
      <div
        role="presentation"
        onClick={() => setSubmittedPopup(false)}
        style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 20, background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(6px)' }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="kyc-submitted-title"
          onClick={(event) => event.stopPropagation()}
          className="cp-card cp-card-pad"
          style={{ width: 'min(440px, 100%)', textAlign: 'center' }}
        >
          <div style={{ width: 54, height: 54, margin: '0 auto 14px', display: 'grid', placeItems: 'center', borderRadius: 16, background: 'rgba(34,197,94,.12)' }}>
            <CheckCircle2 size={28} />
          </div>
          <h2 id="kyc-submitted-title" style={{ marginBottom: 8 }}>KYC submitted</h2>
          <p style={{ margin: '0 auto 18px', maxWidth: 360, lineHeight: 1.55 }}>
            Your details have been submitted successfully and are now under review. You cannot edit them while the review is in progress.
          </p>
          <Button type="button" onClick={() => setSubmittedPopup(false)}>Got it</Button>
        </div>
      </div>
    )}

    <main className="cp-page cp-page-reveal">
      <PageHeading
        eyebrow="Account / identity"
        title="Verify your identity"
        detail="A short, secure check that helps keep your money and everyday services protected."
      />
      {error && <Notice tone="error">{error}</Notice>}

      {!detailType && <section className="cp-card cp-card-pad cp-kyc-choice-card">
        <div className="cp-kyc-card-heading">
          <div>
            <span className="cp-kicker">Your verification</span>
            <h2>Choose a path</h2>
            <p>Start with the option that fits what you have ready today.</p>
          </div>
          <div className="cp-privacy-chip"><LockKeyhole size={14} /> Private and protected</div>
        </div>
        <div className="cp-kyc-options" role="list" aria-label="KYC verification options">
          {(['basic', 'advanced'] as VerificationType[]).map((type) => {
            const basic = type === 'basic';
            const state = verificationStatus(status, type);
            return (
              <button
                key={type}
                type="button"
                disabled={Boolean(isLocked && status?.verificationType && status.verificationType !== type)}
                className={`cp-kyc-option-card ${expandedType === type ? 'active' : ''}`}
                onClick={() => openVerification(type)}
                data-testid={`button-kyc-${type}`}
              >
                <span className={`cp-kyc-option-icon ${basic ? 'basic' : 'advanced'}`}>{basic ? <ShieldCheck size={21} /> : <FileCheck2 size={21} />}</span>
                <span className="cp-kyc-option-copy">
                  <strong>{basic ? 'Basic' : 'Advanced'}</strong>
                  <small>{basic ? 'BVN or NIN verification' : 'Photo ID and selfie verification'}</small>
                </span>
                <span className={`cp-kyc-option-status ${state.toLowerCase().replaceAll(' ', '-')}`}>{state}</span>
                <ChevronRight size={17} className="cp-kyc-option-arrow" />
              </button>
            );
          })}
        </div>
        {!expandedType && <div className="cp-kyc-choose-note"><ShieldCheck size={16} /><span>Tap a verification type to see the requirements and continue.</span></div>}
      </section>}

      {expandedType && <div className="cp-grid cp-grid-two cp-kyc-layout">
        <section className="cp-card cp-card-pad">
          <button type="button" className="cp-back-link" onClick={() => setLocation('/kyc')} data-testid="link-back-kyc">
            <ArrowLeft size={15} /> Back to verification options
          </button>
          <div className="cp-kyc-detail-hero">
            <div className="cp-kyc-hero-art" aria-hidden="true">
              <span />
              <span />
              <b>{form.verificationType === 'advanced' ? '02' : '01'}</b>
            </div>
            <div className="cp-kyc-detail-copy">
              <span className="cp-kicker">Identity pathway</span>
              <h2>{form.verificationType === 'advanced' ? 'Advanced verification' : 'Basic verification'}</h2>
              <p>{form.verificationType === 'advanced' ? 'A deeper review for higher confidence and higher limits.' : 'A quick, secure check using the identity number already linked to you.'}</p>
            </div>
            <span className={`cp-detail-status ${status?.status === 'verified' ? 'verified' : status?.status === 'submitted' ? 'review' : ''}`}>
              {status?.status === 'verified' ? 'Verified' : status?.status === 'submitted' ? 'Under review' : 'Unverified'}
            </span>
          </div>
          <div className="cp-kyc-detail-metrics">
            <div><span>Protection</span><strong>Encrypted</strong></div>
            <div><span>Typical review</span><strong>24–48 hrs</strong></div>
            <div><span>Access</span><strong>Level {form.verificationType === 'advanced' ? 2 : 1}</strong></div>
          </div>
          <div className="cp-status-banner">
            <span><StatusIcon size={19} /></span>
            <div>
              <h2 data-testid="status-kyc">{statusDetails.title}</h2>
              <p>{statusDetails.body}</p>
              {status?.submittedAt && <small>Submitted {formatWhen(status.submittedAt)}</small>}
              {status?.verifiedAt && <small>Verified {formatWhen(status.verifiedAt)}</small>}
            </div>
          </div>

          {status?.status === 'rejected' && status.rejectionReason && (
            <Notice tone="error">Review note: {status.rejectionReason}</Notice>
          )}
          {success && <Notice tone="success">{success}</Notice>}

          <div className="cp-kyc-intro">
            <div>
               <div className="cp-kicker">{status?.verificationType === 'advanced' ? 'Advanced' : 'Basic'} verification · Level {status?.level ?? 1}</div>
              <h2>{isLocked ? 'Your submitted details' : 'Tell us about you'}</h2>
              <p>Use details that match your government record. We encrypt your information while it is being reviewed.</p>
            </div>
            <div className="cp-privacy-chip"><LockKeyhole size={14} /> Private and protected</div>
          </div>

          <form className="cp-form cp-kyc-form" onSubmit={submitKyc}>
            <fieldset disabled={isLocked || submitting} className="cp-fieldset">
              <div className="cp-kyc-wizard-bar">
                <div>
                  <span className="cp-kicker">Step {step} of {totalSteps}</span>
                  <strong>{step === 1 ? 'Choose your identity document' : step === 2 ? 'Add your personal details' : form.verificationType === 'basic' ? 'Review your details' : step === 3 ? 'Capture the front' : step === 4 ? 'Add the reverse side' : 'Finish with a selfie'}</strong>
                </div>
                <div className="cp-kyc-progress" aria-label={`Step ${step} of ${totalSteps}`}>
                  {Array.from({ length: totalSteps }, (_, index) => <i key={index} className={index + 1 <= step ? 'active' : ''} />)}
                </div>
              </div>

              {step === 1 && <div className="cp-kyc-step cp-kyc-step-enter">
               <div className="cp-field">
                 <span>Identity document</span>
                <div className="cp-doc-grid" role="radiogroup" aria-label="Identity document">
                   {documentOptions.filter((option) => option.verificationType === form.verificationType).map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      role="radio"
                      aria-checked={form.documentType === option.value}
                      className={`cp-doc-option ${form.documentType === option.value ? 'active' : ''}`}
                      onClick={() => updateForm('documentType', option.value)}
                      data-testid={`button-document-${option.value}`}
                    >
                      <FileCheck2 size={17} />
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </button>
                  ))}
                </div>
              </div>
                <label className="cp-field">
                  <span>{selectedDocument.label} number</span>
                  <input
                    value={form.documentNumber}
                    onChange={(event) => updateForm('documentNumber', event.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={form.documentType === 'bvn' || form.documentType === 'nin' ? '10–11 digits' : 'Document number'}
                    data-testid="input-document-number"
                  />
                </label>
              </div>}

              {step === 2 && <div className="cp-kyc-step cp-kyc-step-enter">
              <div className="cp-field-row">
                <label className="cp-field">
                  <span>Full name</span>
                  <input value={form.fullName} onChange={(event) => updateForm('fullName', event.target.value)} autoComplete="name" placeholder="First and last name" data-testid="input-full-name" />
                </label>
                <label className="cp-field">
                  <span>Date of birth</span>
                  <input type="date" value={form.dateOfBirth} onChange={(event) => updateForm('dateOfBirth', event.target.value)} data-testid="input-date-of-birth" />
                </label>
                <label className="cp-field">
                  <span>Residential address</span>
                  <input value={form.address} onChange={(event) => updateForm('address', event.target.value)} autoComplete="street-address" placeholder="Where you live" data-testid="input-address" />
                </label>
              </div>
              </div>}

               {form.verificationType === 'advanced' && step === 3 ? (
                 <div className="cp-kyc-step cp-kyc-step-enter">
                   <div className="cp-upload-intro"><span className="cp-upload-number">01</span><div><strong>Front of document</strong><p>Use a sharp, well-lit image. Make sure every corner and word is visible.</p></div></div>
                   <label className={`cp-upload ${form.documentFrontImage ? 'has-file' : ''}`}>
                     <div className="cp-upload-head"><span>{form.documentFrontImage ? 'Image ready to continue' : 'Add the front image'}</span><UploadCloud size={16} /></div>
                     <input type="file" accept="image/*" onChange={(event) => void onFileChange('documentFrontImage', event.target.files?.[0])} data-testid="input-document-front" />
                     <small>{form.documentFrontImage ? 'Choose another image to replace it' : 'Tap here to browse your device'}</small>
                   </label>
                 </div>
               ) : form.verificationType === 'advanced' && step === 4 ? (
                 <div className="cp-kyc-step cp-kyc-step-enter">
                   <div className="cp-upload-intro"><span className="cp-upload-number">02</span><div><strong>Reverse side</strong><p>If your document has a back, add it here. Otherwise, continue without one.</p></div></div>
                   <label className={`cp-upload ${form.documentBackImage ? 'has-file' : ''}`}>
                     <div className="cp-upload-head"><span>{form.documentBackImage ? 'Back image ready' : 'Add the back image'}</span><UploadCloud size={16} /></div>
                     <input type="file" accept="image/*" onChange={(event) => void onFileChange('documentBackImage', event.target.files?.[0])} data-testid="input-document-back" />
                     <small>{form.documentBackImage ? 'Choose another image to replace it' : 'Optional for one-sided documents'}</small>
                   </label>
                 </div>
               ) : form.verificationType === 'advanced' && step === 5 ? (
                 <div className="cp-kyc-step cp-kyc-step-enter">
                   <div className="cp-upload-intro"><span className="cp-upload-number">03</span><div><strong>Selfie check</strong><p>Look at the camera with your face clearly visible, while holding the same document.</p></div></div>
                   <label className={`cp-upload ${form.selfieImage ? 'has-file' : ''}`}>
                     <div className="cp-upload-head"><span>{form.selfieImage ? 'Selfie ready to submit' : 'Add your selfie'}</span><UserRound size={16} /></div>
                     <input type="file" accept="image/*" onChange={(event) => void onFileChange('selfieImage', event.target.files?.[0])} data-testid="input-selfie" />
                     <small>{form.selfieImage ? 'Choose another image to replace it' : 'Keep your face and document in frame'}</small>
                   </label>
                 </div>
               ) : form.verificationType === 'basic' && step === 3 ? (
                 <div className="cp-basic-note"><ShieldCheck size={16} /><span>Everything looks ready. Basic verification uses your identity number and personal details only — no photo uploads.</span></div>
               ) : null}
            </fieldset>

            {fileError && <Notice tone="error">{fileError}</Notice>}
            {formError && <Notice tone="error">{formError}</Notice>}
            {!isLocked && (
              <div className="cp-kyc-wizard-actions">
                {step > 1 && <button type="button" className="cp-back-link" onClick={previousStep}><ArrowLeft size={15} /> Back</button>}
                {step < totalSteps
                  ? <Button type="button" onClick={nextStep} data-testid="button-next-kyc">Continue <ChevronRight size={16} /></Button>
                  : <Button type="submit" disabled={submitting} data-testid="button-submit-kyc">{submitting ? 'Sending for review…' : status?.status === 'rejected' ? 'Submit updated details' : 'Submit for review'} <CheckCircle2 size={16} /></Button>}
              </div>
            )}
          </form>
        </section>

        <aside className="cp-kyc-side">
          <div className="cp-card cp-card-pad cp-security-card">
            <div className="cp-security-mark"><ShieldCheck size={21} /></div>
            <h2>Your details stay yours</h2>
            <p>We only use verification information to protect your account and meet financial regulations.</p>
            <div className="cp-kyc-check"><CheckCircle2 size={15} /> Encrypted in transit</div>
            <div className="cp-kyc-check"><CheckCircle2 size={15} /> Reviewed by a trusted team</div>
            <div className="cp-kyc-check"><CheckCircle2 size={15} /> Never used for marketing</div>
          </div>
          <div className="cp-card cp-card-pad">
            <div className="cp-card-head">
              <div><h2>What happens next?</h2><p>Most checks are resolved without a call.</p></div>
            </div>
            <div className="cp-step-list">
              <div><b>01</b><span>We check your details against your document.</span></div>
              <div><b>02</b><span>We may ask for a clearer image if needed.</span></div>
              <div><b>03</b><span>Your limits update once verification is complete.</span></div>
            </div>
          </div>
        </aside>
      </div>}
    </main>
    </>\n  );
}
