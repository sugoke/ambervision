import React, { useState, useEffect, useMemo } from 'react';
import { useTracker, useFind } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { UsersCollection, USER_ROLES } from '../api/users.js';
import { ClientEntitiesCollection, ClientEntityHelpers, ENTITY_TYPES, ENTITY_STATUSES } from '../api/clientEntities.js';
import { UserEntityAccessCollection, ACCESS_LEVELS } from '../api/userEntityAccess.js';
import { BankAccountsCollection, accountHolderSelector, getAccountHolderIds, isJointAccount, buildJointAccountName, getAuthorizedEmails, ACCOUNT_ACCESS_RIGHTS, ACCOUNT_ACCESS_RIGHTS_LABELS, getClientReferenceCurrency } from '../api/bankAccounts.js';
import { BanksCollection } from '../api/banks.js';
import { AccountProfilesCollection, PROFILE_TEMPLATES, PROFILE_CATEGORIES, PROFILE_LIMIT_FIELDS, NO_PROFILE_KEY, NO_PROFILE_NAME, isNoProfile, getProfileLimit, aggregateToFourCategories } from '../api/accountProfiles.js';
import { PortfolioSnapshotsCollection } from '../api/portfolioSnapshots.js';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import ClientDocumentManager, { KycDocumentManager, SingleTypeDocumentManager, IdentityImageSlot } from './components/ClientDocumentManager.jsx';
import { ClientDocumentsCollection, DOCUMENT_TYPES, REVIEW_YEARS_BY_RISK, computeNextReviewDate, computeNextVisitDate, VISIT_INTERVAL_YEARS, computeNextPortfolioSignatureDate, SIGNED_PORTFOLIO_INTERVAL_YEARS } from '../api/clientDocuments.js';
import { resolveDueDate } from '../api/complianceChecks.js';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';
import { useTheme } from './ThemeContext.jsx';
import { openDocumentWindow } from './utils/openDocument.js';
// Imported statically on purpose. Production's CSP (server/securityHeaders.js)
// grants 'unsafe-eval' in development only, and Meteor's dynamic-import package
// evals fetched module source — so `await import('html2pdf.js')` threw
// "Evaluating a string as JavaScript violates ... 'unsafe-eval'" on the
// deployed app while working locally. Never lazy-load in this app's client code.
import html2pdf from 'html2pdf.js';

// Power of attorney (orders allowed) vs view-only (no orders) for a bank account.
const AccessRightsPicker = ({ value, onChange, readOnly = false }) => (
  <div>
    <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Mandate on this account{readOnly ? '' : ' *'}</label>
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {[
        { id: ACCOUNT_ACCESS_RIGHTS.POWER_OF_ATTORNEY, hint: 'We can place orders' },
        { id: ACCOUNT_ACCESS_RIGHTS.VIEW_ONLY, hint: 'Consultation only — no orders' }
      ].map(opt => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={readOnly}
            onClick={readOnly ? undefined : () => onChange(opt.id)}
            style={{
              flex: '1 1 180px', textAlign: 'left', padding: '8px 12px', borderRadius: '6px', cursor: readOnly ? 'default' : 'pointer',
              border: `1px solid ${active ? 'var(--accent-color)' : 'var(--border-color)'}`,
              background: active ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
              color: 'var(--text-primary)'
            }}
          >
            <div style={{ fontSize: '0.85rem', fontWeight: active ? '700' : '500' }}>{ACCOUNT_ACCESS_RIGHTS_LABELS[opt.id]}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>{opt.hint}</div>
          </button>
        );
      })}
    </div>
  </div>
);

// Percentage input used by the investment profile editor.
// Keeps the "%" inside the field so the value always reads as a percentage.
const PercentInput = ({ value, onChange, invalid, ariaLabel, readOnly = false }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    padding: '6px 8px',
    border: `1px solid ${invalid ? 'var(--loss-color)' : 'var(--border-color)'}`,
    borderRadius: '6px',
    background: 'var(--bg-primary)'
  }}>
    <input
      type="number"
      min="0"
      max="100"
      step="1"
      aria-label={ariaLabel}
      value={value}
      readOnly={readOnly}
      onChange={readOnly ? undefined : e => onChange(e.target.value)}
      onFocus={readOnly ? undefined : e => e.target.select()}
      style={{
        width: '100%',
        minWidth: 0,
        padding: 0,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: invalid ? 'var(--loss-color)' : 'var(--text-primary)',
        fontFamily: 'inherit',
        fontSize: '0.82rem',
        fontWeight: '600',
        textAlign: 'right'
      }}
    />
    <span style={{ marginLeft: '2px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>%</span>
  </div>
);

// Validators for authorized contact fields on bank accounts
const AUTHORIZED_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Merge the chip list with whatever is still typed in the add box, trim,
 * de-duplicate case-insensitively and validate. Returns null (after alerting)
 * on the first invalid address so the caller can abort the save.
 */
const collectAuthorizedEmails = (list, pendingInput) => {
  const seen = new Set();
  const out = [];
  for (const raw of [...(list || []), pendingInput]) {
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) continue;
    if (!AUTHORIZED_EMAIL_REGEX.test(v)) {
      alert(`Authorized email is not valid: ${v}`);
      return null;
    }
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
};
const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

// Map bank names to their logo files in public/images/logos_banks/
const getBankLogoPath = (bankName) => {
  if (!bankName) return null;
  // Normalize to remove accents (é -> e, etc.) and convert to lowercase
  const name = bankName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (name.includes('julius') || name.includes('baer')) {
    return '/images/logos_banks/jb.png';
  }
  if (name.includes('andbank')) {
    return '/images/logos_banks/andbank.png';
  }
  if (name.includes('cfm') || name.includes('credit foncier') || name.includes('indosuez')) {
    return '/images/logos_banks/cfm.png';
  }
  if (name.includes('societe generale') || name.includes('sgmc')) {
    return '/images/logos_banks/SGMC.png';
  }
  if (name.includes('edmond') || name.includes('rothschild')) {
    return '/images/logos_banks/EDRMC.png';
  }
  if (name.includes('cmb')) {
    return '/images/logos_banks/cmb.jpg';
  }
  return null; // No logo available - will use fallback emoji
};

// ── Entity profile field helpers ──
const entityFieldLabelStyle = { display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' };
const entityFieldInputStyle = { width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box' };

// Read-only counterpart of an input: same box as the edit-mode field, so the
// profile always reads as a form. `size="sm"` matches the compact inputs of the
// bank account and family editors.
const readOnlyFieldStyle = {
  ...entityFieldInputStyle,
  minHeight: '39px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px',
  cursor: 'default', overflowWrap: 'anywhere'
};
const readOnlyFieldSmStyle = {
  ...readOnlyFieldStyle,
  padding: '7px', minHeight: '32px', fontSize: '0.82rem', background: 'var(--bg-primary)'
};
const ReadOnlyField = ({ children, size = 'md', style }) => (
  <div style={{ ...(size === 'sm' ? readOnlyFieldSmStyle : readOnlyFieldStyle), ...style }}>
    {children === null || children === undefined || children === '' ? ' ' : children}
  </div>
);

// Label + input; in display mode the input is shown read-only
const EntityField = ({ label, editing, value, display, onChange, type = 'text', placeholder = '', span = false }) => (
  <div style={span ? { gridColumn: '1 / -1' } : undefined}>
    <label style={entityFieldLabelStyle}>{label}</label>
    {editing ? (
      <input type={type} value={value || ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={entityFieldInputStyle} />
    ) : (
      <ReadOnlyField>{display}</ReadOnlyField>
    )}
  </div>
);

// Display form of a free-text amount ("18000000", "€750,000", "1 200 000 EUR"):
// the numeric part gets thousands separators, any currency text around it is
// kept. Values that aren't a single number (ranges, notes) are shown as typed.
const formatAmountDisplay = (raw) => {
  if (raw === null || raw === undefined || raw === '') return '';
  const text = String(raw).trim();
  const match = text.match(/^([^\d\-]*)(-?[\d][\d\s.,']*)(.*)$/);
  if (!match) return text;
  const [, prefix, rawNumber, rawSuffix] = match;
  // Keep any space between the number and a trailing currency ("1 200 000 EUR").
  const numberPart = rawNumber.trimEnd();
  const suffix = rawNumber.slice(numberPart.length) + rawSuffix;
  // Decide which separator is the decimal mark: the last one, if it is
  // followed by exactly 1–2 digits and that separator appears only once.
  const cleaned = numberPart.replace(/[\s']/g, '');
  const lastSep = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
  let integerDigits = cleaned;
  let decimals = '';
  if (lastSep >= 0) {
    const sepChar = cleaned[lastSep];
    const after = cleaned.slice(lastSep + 1);
    const onlyOnce = cleaned.split(sepChar).length === 2;
    if (onlyOnce && after.length >= 1 && after.length <= 2) {
      decimals = after;
      integerDigits = cleaned.slice(0, lastSep);
    }
  }
  integerDigits = integerDigits.replace(/[.,]/g, '');
  if (!/^-?\d+$/.test(integerDigits)) return text;
  const grouped = Number(integerDigits).toLocaleString('en-GB');
  return `${prefix}${grouped}${decimals ? '.' + decimals : ''}${suffix}`;
};

// Section separator spanning the whole profile grid
const EntitySectionTitle = ({ children }) => (
  <div style={{
    gridColumn: '1 / -1', marginTop: '8px', paddingTop: '14px', borderTop: '1px solid var(--border-color)',
    fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em'
  }}>
    {children}
  </div>
);

// Yes / No / unanswered selector for KYC-style questions (value: true | false | null)
const YesNoField = ({ label, sublabel, editing, value, onChange }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
    <div>
      <div style={{ fontSize: '0.92rem', fontWeight: '600', color: 'var(--text-primary)' }}>{label}</div>
      {sublabel && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{sublabel}</div>}
    </div>
    {/* Same Yes / No selector in both modes; locked outside edit mode */}
    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
      {[{ v: true, text: 'Yes' }, { v: false, text: 'No' }].map(opt => (
        <button key={opt.text} type="button" disabled={!editing} onClick={editing ? () => onChange(value === opt.v ? null : opt.v) : undefined} style={{
          padding: '6px 16px', borderRadius: '6px', cursor: editing ? 'pointer' : 'default', fontSize: '0.82rem', fontWeight: '600',
          border: value === opt.v ? 'none' : '1px solid var(--border-color)',
          background: value === opt.v ? (opt.v ? 'var(--loss-color)' : 'var(--gain-color)') : 'var(--bg-secondary)',
          color: value === opt.v ? 'white' : 'var(--text-secondary)', transition: 'all 0.15s ease'
        }}>{opt.text}</button>
      ))}
    </div>
  </div>
);

// Account opening committee outcome. The committee either admits the
// relationship or turns it down; there is no middle state, so an unanswered
// value stays null rather than defaulting either way.
const COMMITTEE_OUTCOMES = [
  { value: 'accepted', label: 'Accepted', color: 'var(--gain-color)' },
  { value: 'refused', label: 'Refused', color: 'var(--loss-color)' }
];

// <input type="date"> only accepts yyyy-mm-dd; stored values may be Date objects
// (Mongo) or already-formatted strings.
const toDateInputValue = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Single-choice band selector (e.g. wealth / income categories), with optional range sublabels
const ChoiceField = ({ label, editing, value, onChange, options }) => (
  <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
    <div style={{ fontSize: '0.92rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>{label}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      {/* Same band selector in both modes; locked outside edit mode */}
      {options.map(opt => {
        const selected = value === opt.value;
        return (
          <button key={opt.value} type="button" disabled={!editing} onClick={editing ? () => onChange(selected ? null : opt.value) : undefined} style={{
            padding: '8px 12px', borderRadius: '8px', cursor: editing ? 'pointer' : 'default', textAlign: 'center',
            border: selected ? '1.5px solid var(--accent-color)' : '1px solid var(--border-color)',
            background: selected ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-secondary)',
            color: selected ? 'var(--accent-color)' : 'var(--text-secondary)',
            fontSize: '0.8rem', fontWeight: selected ? '700' : '500', transition: 'all 0.15s ease'
          }}>
            <div>{opt.label}</div>
            {opt.sublabel && <div style={{ fontSize: '0.68rem', opacity: 0.75, marginTop: '2px' }}>{opt.sublabel}</div>}
          </button>
        );
      })}
    </div>
  </div>
);

// KYC band options (shared between display and edit)
const PORTFOLIO_POTENTIAL_OPTIONS = [
  { value: '500k_1m', label: '>€500K to €1,000K' },
  { value: '1m_2m', label: '>€1,000K to €2,000K' },
  { value: 'over_2m', label: '>€2,000K' }
];
const WEALTH_OPTIONS = [
  { value: 'modest', label: 'Modest', sublabel: 'Net assets < €500K' },
  { value: 'affluent', label: 'Affluent', sublabel: '€500K – €1M' },
  { value: 'high', label: 'High', sublabel: '€1M – €5M' },
  { value: 'hnwi', label: 'HNWI', sublabel: '€5M – €50M' },
  { value: 'uhnwi', label: 'UHNWI', sublabel: '> €50M' }
];
const ANNUAL_INCOME_OPTIONS = [
  { value: 'modest', label: 'Modest', sublabel: '< €50K' },
  { value: 'average', label: 'Average', sublabel: '€50K – €100K' },
  { value: 'comfortable', label: 'Comfortable', sublabel: '€100K – €250K' },
  { value: 'high', label: 'High', sublabel: '€250K – €500K' },
  { value: 'very_high', label: 'Very High', sublabel: '> €500K' }
];
const MARITAL_STATUS_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'civil_union', label: 'Civil Union' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'separated', label: 'Separated' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'cohabiting', label: 'Cohabiting / Common-Law Partner' }
];
const MARITAL_STATUS_LABELS = MARITAL_STATUS_OPTIONS.reduce((acc, o) => { acc[o.value] = o.label; return acc; }, {});
const FAMILY_RELATIONSHIP_OPTIONS = [
  { value: 'partner', label: 'Partner' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'child', label: 'Child' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'parent', label: 'Parent' },
  { value: 'other', label: 'Other' }
];
const FAMILY_RELATIONSHIP_LABELS = FAMILY_RELATIONSHIP_OPTIONS.reduce((acc, o) => { acc[o.value] = o.label; return acc; }, {});

export default function UserDetailsScreen({ userId, entityId = null, onBack, embedded = false }) {
  const { isDark: isDarkMode } = useTheme(); // v2
  const sessionId = localStorage.getItem('sessionId');

  const { dialogState, showConfirm, showError, hideDialog } = useDialog();

  // State for editing sections
  const [editingBasicInfo, setEditingBasicInfo] = useState(false);
  const [editingRM, setEditingRM] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordResetSuccess, setPasswordResetSuccess] = useState(false);
  const [editingRole, setEditingRole] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    birthday: '',
    preferredLanguage: 'en',
    referenceCurrency: 'EUR',
    relationshipManagerId: '',
    newPassword: '',
    clientType: 'natural',
    companyName: ''
  });

  // Stakeholders state (UBO, directors) for company clients
  const [stakeholders, setStakeholders] = useState([]);
  const [showAddStakeholder, setShowAddStakeholder] = useState(false);
  const [newStakeholder, setNewStakeholder] = useState({
    entityId: '',
    name: '',
    role: 'ubo',
    ownership: '',
    notes: ''
  });

  // Bank account creation state
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({
    name: '',
    bankId: '',
    accountNumber: '',
    referenceCurrency: 'USD',
    accountType: 'personal',
    accountStructure: 'direct',
    lifeInsuranceCompany: '',
    relationshipManagerId: '',
    backupRmIds: [],
    beneficialOwnerIds: [],
    comment: '',
    authorizedEmails: [],
    authorizedPhone: '',
    accessRights: ''
  });
  const [newAccountEmailInput, setNewAccountEmailInput] = useState('');
  const [editAccountEmailInput, setEditAccountEmailInput] = useState('');

  // Bank account edit state
  const [editingBankAccount, setEditingBankAccount] = useState(null);
  const [expandedAccountId, setExpandedAccountId] = useState(null);
  const [editBankAccountData, setEditBankAccountData] = useState({});

  // Current user state (fetched via auth method since sessions are in separate collection)
  const [currentUser, setCurrentUser] = useState(null);

  // Archive client modal state (closure date + closure-letter PDF)
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiveClosureDate, setArchiveClosureDate] = useState('');
  const [archiveClosureFile, setArchiveClosureFile] = useState(null);
  const [archiveError, setArchiveError] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);

  // Fetch current user on mount
  useEffect(() => {
    if (sessionId) {
      Meteor.call('auth.getCurrentUser', sessionId, (err, user) => {
        if (!err && user) {
          setCurrentUser(user);
        }
      });
    }
  }, [sessionId]);

  // Family member state
  const [showAddFamilyMember, setShowAddFamilyMember] = useState(false);
  const [newFamilyMember, setNewFamilyMember] = useState({
    name: '',
    relationship: 'spouse',
    birthday: ''
  });

  // Per-account investment profile state
  // Key: bankAccountId, Value: { min/max for Cash, Bonds, Equities, Alternative }
  const [editingAccountProfile, setEditingAccountProfile] = useState(null); // accountId being edited
  const [accountProfileDraft, setAccountProfileDraft] = useState({
    profileName: '',
    ...Object.fromEntries(PROFILE_LIMIT_FIELDS.map(field => [field, 0])),
    isProfessionalInvestor: false,
    noProfile: false
  });

  // Tab navigation state
  const [activeTab, setActiveTab] = useState('info');

  // Entity KYC and US Person tab state
  const [editingEntityKyc, setEditingEntityKyc] = useState(false);
  const [entityKycDraft, setEntityKycDraft] = useState({});
  const [editingUsPerson, setEditingUsPerson] = useState(false);
  const [usPersonDraft, setUsPersonDraft] = useState({});
  const [editingFamily, setEditingFamily] = useState(false);
  const [familyDraft, setFamilyDraft] = useState([]);
  // Loaded by method: the entity list publication strips profile.familyMembers and
  // wins the merge box for `profile`, so they never reach the entity document here.
  const [familyMembers, setFamilyMembers] = useState([]);
  const [familyLoadError, setFamilyLoadError] = useState(null);
  const [familySaving, setFamilySaving] = useState(false);
  const [familySaveError, setFamilySaveError] = useState(null);
  const [familyPickerIdx, setFamilyPickerIdx] = useState(null);
  const [familyPickerQuery, setFamilyPickerQuery] = useState('');
  const [familyReloadKey, setFamilyReloadKey] = useState(0);

  // KYC Risk Score state
  // Dated review / visit files. The latest file date stands in for the last
  // review or visit date when none was typed, so the uploaded files drive the
  // next due date. Same reactive read as the file lists themselves
  // (SingleTypeDocumentManager in the KYC tab holds the subscription).
  const datedReviewFiles = useFind(
    () => ClientDocumentsCollection.find({
      userId: entityId || '__none__',
      documentType: { $in: [DOCUMENT_TYPES.PERIODIC_REVIEW, DOCUMENT_TYPES.VISIT_REPORT, DOCUMENT_TYPES.SIGNED_PORTFOLIO] }
    }),
    [entityId]
  );
  const latestFileDate = (documentType) => datedReviewFiles
    .filter(d => d.documentType === documentType && d.issuanceDate)
    .map(d => new Date(d.issuanceDate))
    .filter(d => !Number.isNaN(d.getTime()))
    .sort((a, b) => b - a)[0] || null;
  const latestReviewFileDate = latestFileDate(DOCUMENT_TYPES.PERIODIC_REVIEW);
  const latestVisitFileDate = latestFileDate(DOCUMENT_TYPES.VISIT_REPORT);
  // Latest signature date per portfolio (bank account) from the signed-portfolio files
  const lastPortfolioSignatureByAccount = datedReviewFiles
    .filter(d => d.documentType === DOCUMENT_TYPES.SIGNED_PORTFOLIO && d.bankAccountId && d.issuanceDate)
    .reduce((acc, d) => {
      const signed = new Date(d.issuanceDate);
      if (!Number.isNaN(signed.getTime()) && (!acc[d.bankAccountId] || signed > acc[d.bankAccountId])) {
        acc[d.bankAccountId] = signed;
      }
      return acc;
    }, {});

  const [editingRiskScore, setEditingRiskScore] = useState(false);
  const [savingRiskScore, setSavingRiskScore] = useState(false);
  const [riskScoreModalOpen, setRiskScoreModalOpen] = useState(false);
  // Which bank account's assessment is open — risk is scored per banking
  // relationship, so every assessment is bound to one account.
  const [riskScoreAccountId, setRiskScoreAccountId] = useState(null);
  const [riskScoreError, setRiskScoreError] = useState(null);
  // Which assessment is being rendered to PDF, and why the last attempt failed.
  // Rendering takes a second or two; without a busy state the button looks dead.
  const [pdfBusyKey, setPdfBusyKey] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  const [deletingVersionKey, setDeletingVersionKey] = useState(null);

  // RM's clients state (for viewing RM profiles)
  const [rmClients, setRmClients] = useState([]);
  const [rmClientsLoading, setRmClientsLoading] = useState(false);

  // Introducer's accounts state (for viewing Introducer profiles)
  const [introducerAccounts, setIntroducerAccounts] = useState([]);
  const [introducerAccountsLoading, setIntroducerAccountsLoading] = useState(false);

  // Subscribe to data
  const { user, entity, allEntities, linkedEntities, linkedUsers, bankAccounts, beneficiaryAccounts, relationshipManagers, introducers, banks, accountProfiles, portfolioSnapshots, isLoading } = useTracker(() => {
    const userHandle = Meteor.subscribe('customUsers', sessionId);
    const banksHandle = Meteor.subscribe('banks');
    const bankAccountsHandle = Meteor.subscribe('allBankAccounts', sessionId);
    const entityHandle = Meteor.subscribe('clientEntities', sessionId);
    // The list publication omits the KYC block (data minimisation) — the detail
    // screen needs the full document for the entity being viewed.
    if (entityId) {
      Meteor.subscribe('clientEntities.details', sessionId, entityId);
    }
    // Same minimisation rule for accounts: 'allBankAccounts' omits the KYC risk
    // assessment, so pull the full documents for the owner being viewed.
    if (entityId || userId) {
      Meteor.subscribe('bankAccounts.details', sessionId, entityId || userId);
    }
    if (userId || entityId) {
      Meteor.subscribe('accountProfiles', sessionId, userId, entityId);
      if (userId) {
        Meteor.subscribe('portfolioSnapshots', sessionId, {}, { type: 'client', id: userId });
      }
    }

    const userData = userId ? UsersCollection.findOne(userId) : null;
    const rms = UsersCollection.find({ role: { $in: [USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.SUPERADMIN] } }).fetch();
    const introducersData = UsersCollection.find({ role: USER_ROLES.INTRODUCER }).fetch();
    const banksData = BanksCollection.find().fetch();

    // Bank accounts held by this client — as primary holder OR co-holder of a
    // joint account (a couple's account is one row listing both).
    const ownerId = entityId || userId;
    const accountQuery = ownerId
      ? { ...accountHolderSelector([ownerId]), isActive: true }
      : { _id: null };
    const accountsData = BankAccountsCollection.find(accountQuery).fetch();

    // Life-insurance contracts where this entity is a beneficial owner. These accounts
    // belong to the insurer, not to this entity, so they are NOT in accountsData — but
    // they still make the entity a related party rather than a prospect.
    const beneficiaryAccountsData = entityId
      ? BankAccountsCollection.find({
          isActive: true,
          $or: [{ beneficialOwnerIds: entityId }, { beneficialOwnerId: entityId }]
        }).fetch()
      : [];

    // Get account profiles for this user's accounts
    const accountIds = accountsData.map(a => a._id);
    const profilesData = AccountProfilesCollection.find({
      bankAccountId: { $in: accountIds }
    }).fetch();

    // Get portfolio snapshots
    const snapshotsQuery = entityId
      ? { entityId, portfolioCode: { $ne: 'CONSOLIDATED' } }
      : userId ? { userId, portfolioCode: { $ne: 'CONSOLIDATED' } } : { _id: null };
    const snapshotsData = PortfolioSnapshotsCollection.find(snapshotsQuery).fetch();

    // Get entity data if entityId prop is provided
    const entityData = entityId ? ClientEntitiesCollection.findOne(entityId) : null;

    // All entities (for beneficial owner picker)
    const allEntitiesData = ClientEntitiesCollection.find({ isActive: true }).fetch();

    // Get linked entities for this user account (via access grants)
    const userAccessRecords = userId ? UserEntityAccessCollection.find({ userId, isActive: true }).fetch() : [];
    const linkedEntityIds = userAccessRecords.map(a => a.entityId);
    const linkedEntitiesData = linkedEntityIds.length > 0
      ? ClientEntitiesCollection.find({ _id: { $in: linkedEntityIds } }).fetch().map(e => ({
          ...e,
          accessLevel: userAccessRecords.find(a => a.entityId === e._id)?.accessLevel || 'full'
        }))
      : [];

    // Get linked users for this entity (if viewing entity)
    const entityAccessRecords = entityId ? UserEntityAccessCollection.find({ entityId, isActive: true }).fetch() : [];
    const linkedUserIds = entityAccessRecords.map(a => a.userId);
    const linkedUsersData = linkedUserIds.length > 0
      ? UsersCollection.find({ _id: { $in: linkedUserIds } }).fetch().map(u => ({
          ...u,
          accessLevel: entityAccessRecords.find(a => a.userId === u._id)?.accessLevel || 'full'
        }))
      : [];

    return {
      user: userData,
      entity: entityData,
      allEntities: allEntitiesData,
      linkedEntities: linkedEntitiesData,
      linkedUsers: linkedUsersData,
      bankAccounts: accountsData,
      beneficiaryAccounts: beneficiaryAccountsData,
      relationshipManagers: rms,
      introducers: introducersData,
      banks: banksData,
      accountProfiles: profilesData,
      portfolioSnapshots: snapshotsData,
      isLoading: !userHandle.ready() || !banksHandle.ready() || !bankAccountsHandle.ready()
    };
  }, [userId, entityId, sessionId]);

  // Roles this entity holds in other entities (UBO, director, signatory, shareholder).
  // Used both by the status badge and by the "Roles in Companies" block below.
  const entityStakeholderRoles = useMemo(() => {
    if (!entityId) return [];
    const roleLabels = { ubo: 'UBO', director: 'Director', signatory: 'Signatory', shareholder: 'Shareholder' };
    const roles = [];
    allEntities.forEach(company => {
      if (!company.stakeholders?.length) return;
      company.stakeholders.forEach(sh => {
        if (sh.entityId !== entityId) return;
        roles.push({
          role: roleLabels[sh.role] || sh.role,
          companyName: ClientEntityHelpers.getEntityDisplayName(company),
          ownership: sh.ownership
        });
      });
    });
    return roles;
  }, [allEntities, entityId]);

  // Family members of the entity in view (see familyMembers state above).
  // Re-fetched when the entity's profile changes so edits made elsewhere show up.
  const entityProfileStamp = entity?.profile?.updatedAt ? String(entity.profile.updatedAt) : '';
  useEffect(() => {
    if (!entityId) { setFamilyMembers([]); return; }
    let cancelled = false;
    setFamilyLoadError(null);
    Meteor.callAsync('clientEntities.getFamilyMembers', entityId, sessionId)
      .then(members => { if (!cancelled) setFamilyMembers(members || []); })
      .catch(err => {
        console.error('Error loading family members:', err);
        if (!cancelled) setFamilyLoadError(err.reason || err.message);
      });
    return () => { cancelled = true; };
  }, [entityId, entityProfileStamp, familyReloadKey]);

  // People already known to the system that can be linked as a family member
  const familyCandidates = useMemo(() => {
    const q = familyPickerQuery.trim().toLowerCase();
    if (familyPickerIdx === null || q.length < 2) return [];
    const alreadyLinked = new Set(familyDraft.map(m => m.linkedEntityId).filter(Boolean));
    return allEntities
      .filter(e => e.type === ENTITY_TYPES.PHYSICAL_PERSON && e._id !== entityId && !alreadyLinked.has(e._id))
      .filter(e => ClientEntityHelpers.getEntityDisplayName(e).toLowerCase().includes(q))
      .slice(0, 8);
  }, [allEntities, entityId, familyDraft, familyPickerIdx, familyPickerQuery]);

  // Update form data when user or entity data loads
  useEffect(() => {
    if (entity && !user) {
      // Entity-only mode: populate from entity profile
      setFormData({
        email: '',
        firstName: entity.profile?.firstName || '',
        lastName: entity.profile?.lastName || '',
        birthday: entity.profile?.birthday ? new Date(entity.profile.birthday).toISOString().split('T')[0] : '',
        preferredLanguage: entity.profile?.preferredLanguage || 'en',
        referenceCurrency: entity.referenceCurrency || 'EUR',
        relationshipManagerId: entity.relationshipManagerId || '',
        assignedUserIds: entity.assignedUserIds || (entity.relationshipManagerId ? [entity.relationshipManagerId] : []),
        isInsurance: entity.isInsurance || false,
        newPassword: '',
        clientType: entity.type === ENTITY_TYPES.COMPANY ? 'company' : 'natural',
        companyName: entity.profile?.companyName || '',
        // Person identity
        birthPlace: entity.profile?.birthPlace || '',
        birthCountry: entity.profile?.birthCountry || '',
        nationalities: (entity.profile?.nationalities || []).join(', '),
        maritalStatus: entity.profile?.maritalStatus || '',
        // Company identity
        incorporationDate: entity.profile?.incorporationDate ? new Date(entity.profile.incorporationDate).toISOString().split('T')[0] : '',
        incorporationCountry: entity.profile?.incorporationCountry || '',
        // Addresses
        taxAddress: {
          street: entity.profile?.taxAddress?.street || '',
          postalCode: entity.profile?.taxAddress?.postalCode || '',
          city: entity.profile?.taxAddress?.city || '',
          country: entity.profile?.taxAddress?.country || ''
        },
        secondaryAddress: {
          street: entity.profile?.secondaryAddress?.street || '',
          postalCode: entity.profile?.secondaryAddress?.postalCode || '',
          city: entity.profile?.secondaryAddress?.city || '',
          country: entity.profile?.secondaryAddress?.country || ''
        },
        // Contact
        mobilePhone: entity.profile?.mobilePhone || '',
        professionalPhone: entity.profile?.professionalPhone || '',
        homePhone: entity.profile?.homePhone || '',
        contactEmail: entity.profile?.email || ''
      });
      setStakeholders(entity.stakeholders || []);
    } else if (user) {
      setFormData({
        email: user.email || user.username || '',
        firstName: user.profile?.firstName || '',
        lastName: user.profile?.lastName || '',
        birthday: user.profile?.birthday ? new Date(user.profile.birthday).toISOString().split('T')[0] : '',
        preferredLanguage: user.profile?.preferredLanguage || 'en',
        referenceCurrency: user.profile?.referenceCurrency || 'EUR',
        relationshipManagerId: user.relationshipManagerId || '',
        newPassword: '',
        clientType: user.profile?.clientType || 'natural',
        companyName: user.profile?.companyName || ''
      });
      setStakeholders(user.profile?.stakeholders || []);
    }
  }, [user, entity]);

  // Fetch RM's clients when viewing an RM profile
  useEffect(() => {
    if (user && user.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      setRmClientsLoading(true);
      // Fetch all clients assigned to this RM
      const clients = UsersCollection.find({
        role: USER_ROLES.CLIENT,
        relationshipManagerId: userId,
        isActive: { $ne: false }
      }, {
        sort: { 'profile.lastName': 1, 'profile.firstName': 1 }
      }).fetch();
      setRmClients(clients);
      setRmClientsLoading(false);
    }
  }, [user, userId]);

  // Fetch accounts introduced by this introducer when viewing an Introducer profile
  useEffect(() => {
    if (user && user.role === USER_ROLES.INTRODUCER) {
      setIntroducerAccountsLoading(true);
      // Fetch all bank accounts introduced by this introducer
      const accounts = BankAccountsCollection.find({
        introducerId: userId,
        isActive: true
      }).fetch();

      // Enrich with client info
      const enrichedAccounts = accounts.map(account => {
        const client = UsersCollection.findOne(account.userId);
        const bank = BanksCollection.findOne(account.bankId);
        return {
          ...account,
          clientName: client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown',
          clientId: client?._id,
          bankName: bank?.name || 'Unknown Bank'
        };
      });

      setIntroducerAccounts(enrichedAccounts);
      setIntroducerAccountsLoading(false);
    }
  }, [user, userId]);

  // Handlers
  const handleSaveBasicInfo = async () => {
    try {
      await Meteor.callAsync('users.updateProfile', userId, {
        email: formData.email,
        profile: {
          ...user.profile,
          firstName: formData.firstName,
          lastName: formData.lastName,
          birthday: formData.birthday ? new Date(formData.birthday) : null,
          preferredLanguage: formData.preferredLanguage,
          referenceCurrency: formData.referenceCurrency,
          clientType: formData.clientType,
          companyName: formData.clientType === 'company' ? formData.companyName : '',
          stakeholders: formData.clientType === 'company' ? stakeholders : [],
          updatedAt: new Date()
        }
      }, sessionId);

      setEditingBasicInfo(false);

    } catch (error) {
      console.error('Error updating user:', error);
    }
  };

  const handleSaveRM = async () => {
    try {
      if (entityId && !userId) {
        // Entity mode: update entity RM
        await Meteor.callAsync('clientEntities.update', entityId, {
          assignedUserIds: formData.assignedUserIds || [],
          relationshipManagerId: (formData.assignedUserIds || [])[0] || null
        }, sessionId);
      } else {
        await Meteor.callAsync('users.updateProfile', userId, {
          relationshipManagerId: formData.relationshipManagerId || null
        }, sessionId);
      }

      setEditingRM(false);

    } catch (error) {
      console.error('Error updating RM:', error);
    }
  };

  const handleResetPassword = async () => {
    if (!formData.newPassword || formData.newPassword.length < 6) {
      return;
    }

    try {
      await Meteor.callAsync('users.adminResetPassword', userId, formData.newPassword, sessionId);

      setFormData({ ...formData, newPassword: '' });
      setEditingPassword(false);
      setPasswordResetSuccess(true);

      // Auto-hide success message after 5 seconds
      setTimeout(() => setPasswordResetSuccess(false), 5000);

    } catch (error) {
      console.error('Error resetting password:', error);
    }
  };

  const handleSaveRole = async () => {
    if (!selectedRole || selectedRole === user?.role) {
      setEditingRole(false);
      return;
    }

    try {
      await Meteor.callAsync('users.updateRole', userId, selectedRole, sessionId);
      setEditingRole(false);
      setSelectedRole(null);
    } catch (error) {
      console.error('Error updating role:', error);
    }
  };

  const handleAddBankAccount = async () => {
    if (!newAccount.bankId || !newAccount.accountNumber || !newAccount.accessRights) {
      return;
    }

    const trimmedPhone = (newAccount.authorizedPhone || '').trim();
    if (trimmedPhone && !E164_PHONE_REGEX.test(trimmedPhone)) {
      alert('Authorized phone must be in E.164 format (e.g. +33612345678).');
      return;
    }
    // An address typed but not yet added with Enter/Add still counts.
    const cleanedEmails = collectAuthorizedEmails(newAccount.authorizedEmails, newAccountEmailInput);
    if (cleanedEmails === null) return;

    try {
      if (entityId) {
        // Entity mode: use entity-specific method
        // Auto-set accountType based on entity type
        const effectiveAccountType = entity?.type === ENTITY_TYPES.COMPANY ? 'company' : 'personal';
        await Meteor.callAsync('bankAccounts.addForEntity', entityId, {
          name: newAccount.name || fullName,
          bankId: newAccount.bankId,
          accountNumber: newAccount.accountNumber,
          referenceCurrency: newAccount.referenceCurrency,
          accountType: effectiveAccountType,
          accountStructure: newAccount.accountStructure || 'direct',
          lifeInsuranceCompany: newAccount.lifeInsuranceCompany || null,
          relationshipManagerId: newAccount.relationshipManagerId || null,
          backupRmIds: (newAccount.backupRmIds || []).filter(id => id),
          beneficialOwnerIds: (newAccount.beneficialOwnerIds || []).filter(id => id),
          comment: newAccount.comment || null,
          authorizedEmails: cleanedEmails,
          authorizedPhone: trimmedPhone || null,
          accessRights: newAccount.accessRights
        }, sessionId);
      } else {
        // Legacy user mode
        await Meteor.callAsync('bankAccounts.create', {
          userId,
          ...newAccount,
          authorizedEmails: cleanedEmails,
          authorizedPhone: trimmedPhone || null,
          sessionId
        });
      }

      setNewAccount({
        bankId: '',
        accountNumber: '',
        referenceCurrency: 'USD',
        accountType: 'personal',
        accountStructure: 'direct',
        lifeInsuranceCompany: '',
        relationshipManagerId: '',
        backupRmIds: [],
        beneficialOwnerIds: [],
        comment: '',
        authorizedEmails: [],
        authorizedPhone: '',
        accessRights: ''
      });
      setNewAccountEmailInput('');
      setShowAddAccount(false);

      console.log('Bank account added successfully');
    } catch (error) {
      console.error('Error adding bank account:', error);
      alert(`Failed to add bank account: ${error.reason || error.message}`);
    }
  };

  const handleDeleteBankAccount = async (accountId) => {
    const confirmed = await showConfirm('Are you sure you want to delete this bank account? This action cannot be undone.');
    if (!confirmed) return;

    try {
      await Meteor.callAsync('bankAccounts.remove', { accountId, sessionId });
    } catch (error) {
      console.error('Error deleting bank account:', error);
    }
  };

  const handleEditBankAccount = (account) => {
    setEditingBankAccount(account._id);
    setEditBankAccountData({
      referenceCurrency: account.referenceCurrency || 'EUR',
      accountType: account.accountType || 'personal',
      authorizedOverdraft: account.authorizedOverdraft || '',
      comment: account.comment || '',
      introducerId: account.introducerId || '',
      lifeInsuranceCompany: account.lifeInsuranceCompany || '',
      beneficialOwnerIds: account.beneficialOwnerIds || (account.beneficialOwnerId ? [account.beneficialOwnerId] : []),
      holderEntityIds: getAccountHolderIds(account),
      relationshipManagerId: account.relationshipManagerId || '',
      backupRmIds: account.backupRmIds || [],
      name: account.name || '',
      accountNumber: account.accountNumber || '',
      authorizedEmails: getAuthorizedEmails(account),
      authorizedPhone: account.authorizedPhone || '',
      accessRights: account.accessRights || ''
    });
    setEditAccountEmailInput('');
  };

  const handleSaveEditBankAccount = async (accountId) => {
    const trimmedPhone = (editBankAccountData.authorizedPhone || '').trim();
    if (trimmedPhone && !E164_PHONE_REGEX.test(trimmedPhone)) {
      alert('Authorized phone must be in E.164 format (e.g. +33612345678).');
      return;
    }
    const cleanedEmails = collectAuthorizedEmails(editBankAccountData.authorizedEmails, editAccountEmailInput);
    if (cleanedEmails === null) return;

    try {
      const overdraftValue = editBankAccountData.authorizedOverdraft
        ? parseFloat(editBankAccountData.authorizedOverdraft)
        : null;

      await Meteor.callAsync('bankAccounts.update', {
        accountId,
        updates: {
          name: editBankAccountData.name || null,
          accountNumber: editBankAccountData.accountNumber || null,
          referenceCurrency: editBankAccountData.referenceCurrency,
          accountType: editBankAccountData.accountType,
          authorizedOverdraft: overdraftValue,
          comment: editBankAccountData.comment || '',
          introducerId: editBankAccountData.introducerId || null,
          beneficialOwnerIds: (editBankAccountData.beneficialOwnerIds || []).filter(id => id),
          holderEntityIds: (editBankAccountData.holderEntityIds || []).filter(id => id),
          relationshipManagerId: editBankAccountData.relationshipManagerId || null,
          backupRmIds: (editBankAccountData.backupRmIds || []).filter(id => id),
          lifeInsuranceCompany: editBankAccountData.accountType === 'life_insurance'
            ? (editBankAccountData.lifeInsuranceCompany || null)
            : null,
          authorizedEmails: cleanedEmails,
          authorizedPhone: trimmedPhone,
          ...(editBankAccountData.accessRights ? { accessRights: editBankAccountData.accessRights } : {})
        },
        sessionId
      });


      setEditingBankAccount(null);
      setEditBankAccountData({});
      setEditAccountEmailInput('');
    } catch (error) {
      console.error('Error updating bank account:', error);
      alert(`Failed to update bank account: ${error.reason || error.message}`);
    }
  };

  const handleCancelEditBankAccount = () => {
    setEditingBankAccount(null);
    setEditBankAccountData({});
  };

  const handleAddFamilyMember = async () => {
    if (!newFamilyMember.name) {
      return;
    }

    try {
      const familyMembers = user.profile?.familyMembers || [];
      familyMembers.push({
        _id: new Meteor.Collection.ObjectID().toHexString(),
        ...newFamilyMember,
        birthday: newFamilyMember.birthday ? new Date(newFamilyMember.birthday) : null
      });

      await Meteor.callAsync('users.updateProfile', userId, {
        profile: {
          ...user.profile,
          familyMembers,
          updatedAt: new Date()
        }
      }, sessionId);

      setNewFamilyMember({
        name: '',
        relationship: 'spouse',
        birthday: ''
      });
      setShowAddFamilyMember(false);

    } catch (error) {
      console.error('Error adding family member:', error);
    }
  };

  const handleDeleteFamilyMember = async (familyMemberId) => {
    const confirmed = await showConfirm('Are you sure you want to delete this family member?');
    if (!confirmed) return;

    try {
      const familyMembers = (user.profile?.familyMembers || []).filter(fm => fm._id !== familyMemberId);

      await Meteor.callAsync('users.updateProfile', userId, {
        profile: {
          ...user.profile,
          familyMembers,
          updatedAt: new Date()
        }
      }, sessionId);

    } catch (error) {
      console.error('Error deleting family member:', error);
    }
  };

  // Per-account profile handlers
  const handleStartEditAccountProfile = (accountId) => {
    const existingProfile = accountProfiles?.find(p => p.bankAccountId === accountId);
    setAccountProfileDraft({
      profileName: existingProfile?.profileName || '',
      ...Object.fromEntries(PROFILE_LIMIT_FIELDS.map(field => [field, getProfileLimit(existingProfile, field)])),
      isProfessionalInvestor: existingProfile?.isProfessionalInvestor || false,
      noProfile: isNoProfile(existingProfile)
    });
    setEditingAccountProfile(accountId);
  };

  const handleSaveAccountProfile = async (accountId) => {
    const invalidCategories = getInvalidProfileCategories();
    if (invalidCategories.length > 0) {
      showError(
        `Minimum cannot exceed maximum for: ${invalidCategories.map(c => c.label).join(', ')}.`,
        'Invalid allocation range'
      );
      return;
    }

    try {
      await Meteor.callAsync('accountProfiles.upsert', accountId, accountProfileDraft, sessionId);

      setEditingAccountProfile(null);

    } catch (error) {
      console.error('Error updating account profile:', error);
      showError(error.reason || 'Failed to save the investment profile');
    }
  };

  const handleAccountAllocationChange = (field, value) => {
    const numValue = Math.max(0, Math.min(100, parseInt(value) || 0));
    setAccountProfileDraft(prev => ({
      ...prev,
      [field]: numValue
    }));
  };

  const applyTemplate = (templateKey) => {
    // "No profile": not an investment account, no limits
    if (templateKey === NO_PROFILE_KEY) {
      setAccountProfileDraft(prev => ({
        ...prev,
        noProfile: true,
        profileName: NO_PROFILE_NAME,
        ...Object.fromEntries(PROFILE_LIMIT_FIELDS.map(field => [field, 0]))
      }));
      return;
    }
    const template = PROFILE_TEMPLATES[templateKey];
    if (template) {
      setAccountProfileDraft(prev => ({
        ...prev,
        noProfile: false,
        profileName: template.name,
        ...Object.fromEntries(PROFILE_LIMIT_FIELDS.map(field => [field, getProfileLimit(template, field)]))
      }));
    }
  };

  // Utility functions
  const getAccountProfileTotal = () => {
    return PROFILE_CATEGORIES.reduce((sum, c) => sum + getProfileLimit(accountProfileDraft, `max${c.key}`), 0);
  };

  // Categories whose minimum exceeds their maximum (blocks saving)
  const getInvalidProfileCategories = () => {
    return PROFILE_CATEGORIES.filter(c =>
      getProfileLimit(accountProfileDraft, `min${c.key}`) > getProfileLimit(accountProfileDraft, `max${c.key}`)
    );
  };

  const getProfileForAccount = (accountId) => {
    return accountProfiles?.find(p => p.bankAccountId === accountId);
  };

  const getProfileName = (profile) => {
    if (!profile) return null;
    if (profile.profileName) return profile.profileName;
    // Derive from template match
    for (const [, template] of Object.entries(PROFILE_TEMPLATES)) {
      if (PROFILE_LIMIT_FIELDS.every(field => getProfileLimit(template, field) === getProfileLimit(profile, field))) {
        return template.name;
      }
    }
    return null;
  };

  const getSnapshotForAccount = (account) => {
    // Get the bank name for matching
    const bank = banks?.find(b => b._id === account.bankId);
    const bankName = bank?.name?.toLowerCase() || '';

    // Try to find matching snapshot - data is sorted by date desc so first match is latest
    // Match by portfolioCode (account number) and either bankId or bankName
    return portfolioSnapshots?.find(s => {
      const portfolioMatches = s.portfolioCode === account.accountNumber ||
                               s.accountNumber === account.accountNumber;

      // Try multiple ways to match the bank
      const bankMatches = s.bankId === account.bankId ||
                          s.bankId?.toLowerCase()?.includes(bankName) ||
                          s.bankName?.toLowerCase()?.includes(bankName) ||
                          bankName?.includes(s.bankName?.toLowerCase() || '');

      return portfolioMatches && bankMatches;
    });
  };

  const getAllocationForAccount = (account) => {
    const snapshot = getSnapshotForAccount(account);
    if (!snapshot || !snapshot.assetClassBreakdown || !snapshot.totalAccountValue) {
      return null;
    }
    return aggregateToFourCategories(snapshot.assetClassBreakdown, snapshot.totalAccountValue);
  };

  const getInitials = (firstName, lastName, email) => {
    if (firstName && lastName) {
      return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case USER_ROLES.SUPERADMIN:
        return 'linear-gradient(135deg, var(--loss-color) 0%, #dc2626 100%)';
      case USER_ROLES.ADMIN:
        return 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)';
      case USER_ROLES.COMPLIANCE:
        return 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)';
      case USER_ROLES.RELATIONSHIP_MANAGER:
        return 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)';
      case USER_ROLES.CLIENT:
        return 'linear-gradient(135deg, var(--info-color) 0%, #2563eb 100%)';
      default:
        return 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
    }
  };

  const getAvatarGradient = (name) => {
    const gradients = [
      'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
      'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      'linear-gradient(135deg, #30cfd0 0%, #330867 100%)'
    ];
    const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return gradients[hash % gradients.length];
  };

  const calculateAge = (birthday) => {
    if (!birthday) return null;
    const today = new Date();
    const birthDate = new Date(birthday);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const getPasswordStrength = (password) => {
    if (!password) return { strength: 0, label: '', color: '' };
    let strength = 0;
    if (password.length >= 6) strength++;
    if (password.length >= 10) strength++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[^a-zA-Z0-9]/.test(password)) strength++;

    if (strength <= 2) return { strength, label: 'Weak', color: 'var(--loss-color)' };
    if (strength <= 3) return { strength, label: 'Medium', color: 'var(--warning-color)' };
    return { strength, label: 'Strong', color: 'var(--gain-color)' };
  };

  // KYC Risk Score Criteria Configuration (based on "Matrice risque Client AP.xlsx")
  const RISK_CRITERIA = [
    {
      id: 'relationNature',
      number: 1,
      label: 'Nature de la relation',
      labelEn: 'Nature of Relationship',
      options: [
        { value: 'individual', label: 'Personne physique', labelEn: 'Natural Person', score: 1 },
        { value: 'company', label: 'Personne morale', labelEn: 'Legal Entity', score: 2 },
        { value: 'trust', label: 'Trust, Fondation', labelEn: 'Trust, Foundation', score: 5 }
      ]
    },
    {
      id: 'pepStatus',
      number: 2,
      label: 'PPE Status',
      labelEn: 'PEP Status',
      options: [
        { value: 'pep', label: 'PEP', labelEn: 'PEP', score: 30 },
        { value: 'nonPep', label: 'NON-PEP', labelEn: 'Non-PEP', score: 0 }
      ]
    },
    {
      id: 'residence',
      number: 3,
      label: 'Residence',
      labelEn: 'Residence',
      options: [
        { value: 'euLowRisk', label: 'Monaco/EU/EEE/Suisse', labelEn: 'Monaco/EU/EEA/Switzerland', score: 1 },
        { value: 'nonEu', label: 'Non-EU', labelEn: 'Non-EU', score: 3 },
        { value: 'gafiBlacklist', label: 'GAFI blacklist', labelEn: 'FATF blacklist', score: 20 },
        { value: 'highRisk', label: 'Haut risque', labelEn: 'High risk', score: 15 }
      ]
    },
    {
      id: 'nationality',
      number: 4,
      label: 'Nationalite',
      labelEn: 'Nationality',
      options: [
        { value: 'euLowRisk', label: 'Monaco/EU/EEE/Suisse', labelEn: 'Monaco/EU/EEA/Switzerland', score: 1 },
        { value: 'nonEu', label: 'Non-EU', labelEn: 'Non-EU', score: 2 },
        { value: 'gafiBlacklist', label: 'GAFI blacklist', labelEn: 'FATF blacklist', score: 10 },
        { value: 'highRisk', label: 'Haut risque', labelEn: 'High risk', score: 10 }
      ]
    },
    {
      id: 'activityLocation',
      number: 5,
      label: 'Localisation des activites',
      labelEn: 'Activity Location',
      options: [
        { value: 'euLowRisk', label: 'Monaco/EU/EEE/Suisse', labelEn: 'Monaco/EU/EEA/Switzerland', score: 1 },
        { value: 'nonEu', label: 'Non-EU', labelEn: 'Non-EU', score: 3 },
        { value: 'gafiBlacklist', label: 'GAFI blacklist', labelEn: 'FATF blacklist', score: 10 },
        { value: 'highRisk', label: 'Haut risque', labelEn: 'High risk', score: 10 }
      ]
    },
    {
      id: 'fundsLocation',
      number: 6,
      label: 'Localisation des fonds',
      labelEn: 'Funds Location',
      options: [
        { value: 'euLowRisk', label: 'Monaco/EU/EEE/Suisse', labelEn: 'Monaco/EU/EEA/Switzerland', score: 1 },
        { value: 'nonEu', label: 'Non-EU', labelEn: 'Non-EU', score: 3 },
        { value: 'gafiBlacklist', label: 'GAFI blacklist', labelEn: 'FATF blacklist', score: 10 },
        { value: 'highRisk', label: 'Haut risque', labelEn: 'High risk', score: 10 }
      ]
    },
    {
      id: 'sensitiveActivity',
      number: 7,
      label: 'Activite sensible',
      labelEn: 'Sensitive Activity',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 10 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'communicationDifficulty',
      number: 8,
      label: 'Difficulte communication',
      labelEn: 'Communication Difficulty',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 3 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'criminalProsecution',
      number: 9,
      label: 'Poursuites penales',
      labelEn: 'Criminal Prosecution',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 30 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'sanctionsList',
      number: 10,
      label: 'Liste de sanctions',
      labelEn: 'Sanctions List',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 30 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'negativeInfo',
      number: 11,
      label: 'Information negative en ligne',
      labelEn: 'Negative Info Online',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 10 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'mandateType',
      number: 12,
      label: 'Type de mandat',
      labelEn: 'Mandate Type',
      options: [
        { value: 'advisoryRto', label: 'Gestion Conseil avec RTO', labelEn: 'Advisory with RTO', score: 1 },
        { value: 'advisory', label: 'Gestion Conseil', labelEn: 'Advisory', score: 2 }
      ]
    },
    {
      id: 'largeAccount',
      number: 13,
      label: 'Compte > 10M/25M',
      labelEn: 'Account > 10M/25M',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 20 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    },
    {
      id: 'transactionFrequency',
      number: 14,
      label: 'Transactions frequence',
      labelEn: 'Transaction Frequency',
      options: [
        { value: 'normal', label: 'Normal', labelEn: 'Normal', score: 1 },
        { value: 'frequent', label: 'Frequent/important', labelEn: 'Frequent/Significant', score: 2 }
      ]
    },
    {
      id: 'productRisk',
      number: 15,
      label: 'Risque Produit',
      labelEn: 'Product Risk',
      // A relationship usually holds several product classes at once, so this
      // is multiple choice: the answer is an array of slugs and the points add up.
      multiple: true,
      options: [
        { value: 'standard', label: 'Action/Obligation/Monetaire', labelEn: 'Equities/Bonds/Money Market', score: 1 },
        { value: 'structured', label: 'Produit Structure', labelEn: 'Structured Products', score: 3 },
        { value: 'privateEquity', label: 'Private Equity', labelEn: 'Private Equity', score: 4 }
      ]
    },
    {
      id: 'complexStructure',
      number: 16,
      label: 'Structure complexe',
      labelEn: 'Complex Structure',
      options: [
        { value: 'yes', label: 'Oui', labelEn: 'Yes', score: 15 },
        { value: 'no', label: 'Non', labelEn: 'No', score: 0 }
      ]
    }
  ];

  // The options a saved/typed answer selects for one criterion. Single-choice
  // criteria store one slug; multiple-choice ones store an array of slugs. A
  // multiple-choice criterion saved before it became multiple still holds a
  // plain string, which is read as a one-element selection.
  const selectedRiskOptions = (criterion, answer) => {
    const values = Array.isArray(answer) ? answer : (answer ? [answer] : []);
    return criterion.options.filter(o => values.includes(o.value));
  };

  // Helper function to calculate risk score for a single column
  const calculateRiskScore = (criteriaValues) => {
    let total = 0;
    RISK_CRITERIA.forEach(criterion => {
      selectedRiskOptions(criterion, criteriaValues[criterion.id])
        .forEach(opt => { total += opt.score; });
    });
    return {
      totalScore: total,
      riskLevel: total < 15 ? 'low' : total < 30 ? 'medium' : 'high'
    };
  };

  // Helper function to get risk level display info
  const getRiskLevelDisplay = (riskLevel) => {
    switch (riskLevel) {
      case 'low':
        return { label: 'Risque Faible', labelEn: 'Low Risk', color: 'var(--gain-color)', emoji: '🟢', reviewPeriod: '3 years' };
      case 'medium':
        return { label: 'Risque Moyen', labelEn: 'Medium Risk', color: 'var(--warning-color)', emoji: '🟡', reviewPeriod: '2 years' };
      case 'high':
        return { label: 'Risque Eleve', labelEn: 'High Risk', color: 'var(--loss-color)', emoji: '🔴', reviewPeriod: '1 year' };
      default:
        return { label: 'Non evalue', labelEn: 'Not Assessed', color: 'var(--text-muted)', emoji: '⚪', reviewPeriod: '-' };
    }
  };

  // The Business Relationship column is not answered: it is the riskier of the
  // Client and Beneficial Owner assessments (ties go to the client). Its score
  // and level are stored with the assessment so every reader shows the same
  // value without knowing this rule.
  const deriveBusinessRelationship = (clientResult, beneficialOwnerResult) => {
    const fromClient = clientResult.totalScore >= beneficialOwnerResult.totalScore;
    const source = fromClient ? clientResult : beneficialOwnerResult;
    return {
      totalScore: source.totalScore,
      riskLevel: source.riskLevel,
      derivedFrom: fromClient ? 'clientProspect' : 'beneficialOwner'
    };
  };
  const BUSINESS_RELATIONSHIP_RULE = 'Highest of Client and Beneficial Owner';

  // Only the two answered columns live in the form.
  const EMPTY_RISK_SCORE_FORM = {
    clientProspect: {},
    beneficialOwner: {},
    comments: ''
  };

  // Seed the assessment form from a saved assessment (one bank account's).
  const riskScoreFormFrom = (savedData) => {
    if (!savedData) return EMPTY_RISK_SCORE_FORM;
    return {
      clientProspect: savedData.clientProspect?.criteria || {},
      beneficialOwner: savedData.beneficialOwner?.criteria || {},
      comments: savedData.comments || ''
    };
  };

  const [riskScoreForm, setRiskScoreForm] = useState(EMPTY_RISK_SCORE_FORM);

  // Every save creates a NEW version and archives the one it replaces, so the
  // modal is either recording a new assessment or displaying a superseded one
  // read-only. `viewingVersion` holds the archived assessment being read.
  const [viewingVersion, setViewingVersion] = useState(null);


  // The bank account currently being assessed. Risk is per banking relationship,
  // so the modal is always bound to one account.
  const riskScoreAccount = useMemo(
    () => (riskScoreAccountId ? bankAccounts.find(a => a._id === riskScoreAccountId) : null),
    [riskScoreAccountId, bankAccounts]
  );

  // Reload the form whenever a different account is opened, or that account's
  // saved assessment changes underneath us (another user re-scored it).
  useEffect(() => {
    // A read-only version drives the form itself — don't overwrite it with the
    // account's current assessment.
    if (viewingVersion) return;
    setRiskScoreForm(riskScoreFormFrom(riskScoreAccount?.kycRiskScore));
  }, [riskScoreAccountId, riskScoreAccount?.kycRiskScore?.assessmentDate, viewingVersion]);

  /**
   * Start a new assessment for one account.
   *
   * A periodic review usually revisits the previous answers rather than starting
   * from nothing, so the form is seeded from the current assessment; "Start
   * blank" in the modal clears it for a genuine re-assessment.
   */
  const openRiskScoreModal = (accountId) => {
    setRiskScoreAccountId(accountId);
    setViewingVersion(null);
    setRiskScoreModalOpen(true);
    setEditingRiskScore(true);
    setRiskScoreError(null);
  };

  /** Open a superseded version read-only, straight from the history strip. */
  const openRiskScoreVersion = (accountId, version, label) => {
    setRiskScoreAccountId(accountId);
    setViewingVersion({ ...version, versionLabel: label });
    setRiskScoreForm(riskScoreFormFrom(version));
    setRiskScoreModalOpen(true);
    setEditingRiskScore(false);
    setRiskScoreError(null);
  };

  /**
   * Delete one superseded assessment. Restricted to superadmin and compliance:
   * an ordinary admin may re-score an account but not erase its history.
   * `historyIndex` is the position in the stored (oldest-first) array, while
   * the strip renders newest-first — the row passes the stored index and the
   * assessment date, which the server re-checks before removing anything.
   */
  const canDeleteRiskScoreVersion =
    currentUser?.role === USER_ROLES.SUPERADMIN || currentUser?.role === USER_ROLES.COMPLIANCE;

  const deleteRiskScoreVersion = async (account, historyIndex, version, versionLabel, busyKey) => {
    const when = version?.assessmentDate ? new Date(version.assessmentDate).toLocaleDateString('en-GB') : 'unknown date';
    const confirmed = await showConfirm(
      `Delete ${versionLabel} of the KYC risk assessment for account ${account.accountNumber}?

` +
      `Assessed ${when}. This removes a compliance record permanently and cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingVersionKey(busyKey);
    try {
      await Meteor.callAsync('bankAccounts.deleteRiskScoreVersion', {
        accountId: account._id,
        versionIndex: historyIndex,
        assessmentDate: version?.assessmentDate ? new Date(version.assessmentDate) : null,
        sessionId
      });
    } catch (error) {
      console.error('Failed to delete risk assessment version:', error);
      showError(error.reason || error.message || 'Could not delete this version');
    } finally {
      setDeletingVersionKey(null);
    }
  };

  const closeRiskScoreModal = () => {
    setRiskScoreModalOpen(false);
    setEditingRiskScore(false);
    setRiskScoreAccountId(null);
    setViewingVersion(null);
    setRiskScoreError(null);
  };

  // Handle risk score form changes
  const handleRiskScoreChange = (column, criterionId, value) => {
    setRiskScoreForm(prev => ({
      ...prev,
      [column]: {
        ...prev[column],
        [criterionId]: value
      }
    }));
  };

  // Save risk score data
  const handleSaveRiskScore = async () => {
    setSavingRiskScore(true);
    try {
      const clientProspectResult = calculateRiskScore(riskScoreForm.clientProspect);
      const beneficialOwnerResult = calculateRiskScore(riskScoreForm.beneficialOwner);
      const businessRelationshipResult = deriveBusinessRelationship(clientProspectResult, beneficialOwnerResult);

      // Determine highest risk level for next review calculation
      const riskLevels = [clientProspectResult.riskLevel, beneficialOwnerResult.riskLevel, businessRelationshipResult.riskLevel];
      const highestRisk = riskLevels.includes('high') ? 'high' : riskLevels.includes('medium') ? 'medium' : 'low';
      // One review policy for the whole app: 1 year high, 2 medium, 3 low
      // (REVIEW_YEARS_BY_RISK).
      const nextReviewDate = computeNextReviewDate(new Date(), highestRisk);

      const riskScoreData = {
        assessmentDate: new Date(),
        assessedBy: currentUser?._id,
        clientProspect: {
          criteria: riskScoreForm.clientProspect,
          totalScore: clientProspectResult.totalScore,
          riskLevel: clientProspectResult.riskLevel
        },
        beneficialOwner: {
          criteria: riskScoreForm.beneficialOwner,
          totalScore: beneficialOwnerResult.totalScore,
          riskLevel: beneficialOwnerResult.riskLevel
        },
        businessRelationship: {
          criteria: {},
          totalScore: businessRelationshipResult.totalScore,
          riskLevel: businessRelationshipResult.riskLevel,
          derivedFrom: businessRelationshipResult.derivedFrom
        },
        comments: riskScoreForm.comments,
        nextReviewDate: nextReviewDate
      };

      // The assessment belongs to one banking relationship. The server archives
      // the previous version onto kycRiskScoreHistory.
      if (!riskScoreAccountId) {
        throw new Error('No bank account selected for this assessment');
      }
      await Meteor.callAsync('bankAccounts.updateRiskScore', {
        accountId: riskScoreAccountId,
        riskScoreData,
        sessionId
      });

      setEditingRiskScore(false);
      setRiskScoreError(null);
    } catch (error) {
      console.error('Error saving risk score:', error);
      setRiskScoreError(error.reason || error.message || 'Failed to save the assessment');
      throw error;
    } finally {
      setSavingRiskScore(false);
    }
  };

  // Export one account's saved KYC risk assessment as a PDF (audit trail of versions).
  // `account` is the banking relationship the assessment belongs to; `busyKey`
  // identifies which button to show as busy.
  //
  // The finished PDF is opened in a tab rather than pushed through a silent
  // browser download: a download that Chrome blocks (or drops straight into the
  // Downloads folder) looks exactly like a dead button, which is how this was
  // reported. openDocumentWindow opens the tab synchronously inside the click
  // gesture, so the popup blocker doesn't eat it after the await.
  const exportRiskScorePdf = async (savedScore, account, busyKey = 'current') => {
    if (!savedScore) return;
    setPdfBusyKey(busyKey);
    setPdfError(null);
    try {
      const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const clientName = entity ? ClientEntityHelpers.getEntityDisplayName(entity) : `${user?.profile?.firstName || ''} ${user?.profile?.lastName || ''}`.trim();
      const assessor = savedScore.assessedBy ? UsersCollection.findOne(savedScore.assessedBy) : null;
      const assessorName = assessor ? (`${assessor.profile?.firstName || ''} ${assessor.profile?.lastName || ''}`.trim() || assessor.email || assessor.username || '') : '';
      const accountBank = account ? banks.find(b => b._id === account.bankId) : null;
      const accountLine = account
        ? `${esc(account.accountNumber)}${accountBank ? ' — ' + esc(accountBank.name) : ''}${account.name ? '<br/><span style="color:#6b7280;">' + esc(account.name) + '</span>' : ''}`
        : '';

      const COLUMNS = [
        { key: 'clientProspect', label: 'Client Prospect' },
        { key: 'beneficialOwner', label: 'Beneficial Owner' },
        { key: 'businessRelationship', label: 'Business Relationship' }
      ];
      // Multiple-choice criteria list every picked option and the summed points.
      const cellFor = (criterion, columnKey) => {
        const opts = selectedRiskOptions(criterion, savedScore[columnKey]?.criteria?.[criterion.id]);
        if (!opts.length) return '&mdash;';
        const points = opts.reduce((sum, o) => sum + o.score, 0);
        return `${opts.map(o => esc(o.labelEn)).join(', ')} <b>(${points})</b>`;
      };
      const riskLabel = (level) => level === 'high' ? 'High Risk' : level === 'medium' ? 'Medium Risk' : level === 'low' ? 'Low Risk' : 'Not Assessed';
      const riskColor = (level) => level === 'high' ? '#b91c1c' : level === 'medium' ? '#b45309' : level === 'low' ? '#047857' : '#6b7280';

      // Assessments saved since the column became derived have no per-criterion
      // answers for the business relationship: one merged cell states the rule.
      // Older assessments still print the answers that were recorded.
      const brDerived = !!savedScore.businessRelationship?.derivedFrom
        || !Object.keys(savedScore.businessRelationship?.criteria || {}).length;
      const rows = RISK_CRITERIA.map((c, i) => `
        <tr>
          <td style="text-align:center;color:#6b7280;">${c.number}</td>
          <td><b>${esc(c.labelEn)}</b></td>
          ${COLUMNS.map(col => {
            if (col.key === 'businessRelationship' && brDerived) {
              return i === 0
                ? `<td rowspan="${RISK_CRITERIA.length}" style="text-align:center;vertical-align:middle;color:#6b7280;font-style:italic;">${BUSINESS_RELATIONSHIP_RULE}</td>`
                : '';
            }
            return `<td style="text-align:center;">${cellFor(c, col.key)}</td>`;
          }).join('')}
        </tr>`).join('');

      const totals = `
        <tr style="background:#f3f4f6;font-weight:bold;">
          <td></td>
          <td>TOTAL SCORE</td>
          ${COLUMNS.map(col => {
            const data = savedScore[col.key] || {};
            return `<td style="text-align:center;">
              <div style="font-size:14px;">${data.totalScore ?? 0} pts</div>
              <div style="color:${riskColor(data.riskLevel)};">${riskLabel(data.riskLevel)}</div>
            </td>`;
          }).join('')}
        </tr>`;

      const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '';
      const stamp = new Date();
      const versionTag = savedScore.assessmentDate ? new Date(savedScore.assessmentDate) : stamp;
      const pad = (n) => String(n).padStart(2, '0');
      const fileDate = `${versionTag.getFullYear()}-${pad(versionTag.getMonth() + 1)}-${pad(versionTag.getDate())}_${pad(versionTag.getHours())}${pad(versionTag.getMinutes())}`;
      const safeName = [clientName || 'Client', account?.accountNumber]
        .filter(Boolean)
        .join(' ')
        .replace(/[^\w\- ]+/g, '')
        .trim()
        .replace(/\s+/g, '_');

      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; color:#111827; font-size:10px; padding:4px; width:100%; max-width:100%; box-sizing:border-box; overflow-wrap:break-word;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
            <div>
              <div style="font-size:16px; font-weight:bold;">KYC Risk Assessment — Banking Relationship Risk Matrix</div>
              <div style="color:#6b7280; margin-top:2px;">Based on "Matrice risque Client AP"</div>
            </div>
            <div style="text-align:right; color:#6b7280;">
              <div>Assessment date: <b style="color:#111827;">${fmtDate(savedScore.assessmentDate) || '—'}</b></div>
              <div>Next review due: <b style="color:#111827;">${fmtDate(savedScore.nextReviewDate) || '—'}</b></div>
              ${assessorName ? `<div>Assessed by: <b style="color:#111827;">${esc(assessorName)}</b></div>` : ''}
            </div>
          </div>

          <table style="width:100%; table-layout:fixed; border-collapse:collapse; margin-bottom:12px; word-wrap:break-word;" border="0">
            <tr>
              <td style="border:1px solid #d1d5db; padding:6px 8px; width:50%;">
                <span style="color:#6b7280;">Client:</span> <b>${esc(clientName)}</b>
              </td>
              <td style="border:1px solid #d1d5db; padding:6px 8px;">
                <span style="color:#6b7280;">Account:</span><br/>${accountLine || '&mdash;'}
              </td>
            </tr>
          </table>

          <!-- table-layout:fixed with an explicit colgroup. Left to lay out
               automatically, a cell like "Equities/Bonds/Money Market,
               Structured Products, Private Equity" widened the table past the
               794px capture surface, and html2pdf clipped everything beyond the
               right edge of the page — the last column, the header dates and
               the last total all lost their right-hand side. Fixed widths make
               the text wrap inside the page instead. -->
          <table style="width:100%; table-layout:fixed; border-collapse:collapse; word-wrap:break-word;" border="0">
            <colgroup>
              <col style="width:4%;" />
              <col style="width:21%;" />
              ${COLUMNS.map(() => `<col style="width:${(75 / COLUMNS.length).toFixed(2)}%;" />`).join('')}
            </colgroup>
            <thead>
              <tr style="background:#1f2937; color:white;">
                <th style="padding:5px;">#</th>
                <th style="padding:5px; text-align:left;">Risk Criteria</th>
                ${COLUMNS.map(c => `<th style="padding:5px;">${c.label}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows}
              ${totals}
            </tbody>
          </table>

          <div style="margin-top:10px; color:#374151;">
            <b>Risk classification:</b> &lt; 15 pts = low risk &nbsp;|&nbsp; 15&ndash;29 pts = medium risk &nbsp;|&nbsp; &ge; 30 pts = high risk.
            Review periodicity: every year for high risk, every 2 years for medium risk, every 3 years for low risk.
          </div>

          <div style="margin-top:10px;">
            <b>Comments:</b>
            <div style="border:1px solid #d1d5db; min-height:40px; padding:6px 8px; margin-top:4px; white-space:pre-wrap;">${esc(savedScore.comments) || '&mdash;'}</div>
          </div>

          <table style="width:100%; margin-top:24px; border-collapse:collapse;">
            <tr>
              <td style="width:50%; padding-right:20px;">
                <div style="border-top:1px solid #111827; padding-top:4px;">Signature Wealth Ambassador &nbsp;&mdash;&nbsp; Date:</div>
              </td>
              <td style="width:50%; padding-left:20px;">
                <div style="border-top:1px solid #111827; padding-top:4px;">Signature Compliance Officer &nbsp;&mdash;&nbsp; Date:</div>
              </td>
            </tr>
          </table>

          <div style="margin-top:16px; color:#9ca3af; font-size:8px;">
            Version of ${fmtDate(savedScore.assessmentDate) || fmtDate(stamp)} &mdash; PDF generated on ${stamp.toLocaleDateString('en-GB')} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())} &mdash; keep this document as audit trail of the assessment before any modification.
          </div>
        </div>`;

      // Off-screen styles live on the wrapper only: html2pdf clones the source
      // element with its inline styles, so positioning the source itself
      // off-screen produces a blank capture.
      const wrapper = document.createElement('div');
      wrapper.style.position = 'fixed';
      wrapper.style.left = '-10000px';
      wrapper.style.top = '0';
      const container = document.createElement('div');
      container.style.width = '794px';
      container.style.background = 'white';
      container.innerHTML = html;
      wrapper.appendChild(container);
      document.body.appendChild(wrapper);
      const filename = `KYC_Risk_Assessment_${safeName}_${fileDate}.pdf`;
      let blob;
      try {
        blob = await html2pdf().set({
          margin: [10, 10, 10, 10],
          filename,
          image: { type: 'jpeg', quality: 0.95 },
          // html2canvas re-renders the element in a cloned document; without
          // width/windowWidth it lays that clone out at the real window width,
          // so the matrix reflowed to something wider than the page and the
          // capture was cropped at the right edge. Pinning both to the A4
          // portrait width makes the clone match what is measured here.
          html2canvas: { scale: 2, backgroundColor: '#ffffff', width: 794, windowWidth: 794 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        }).from(container).outputPdf('blob');
      } finally {
        document.body.removeChild(wrapper);
      }

      const url = URL.createObjectURL(blob);
      const opened = await openDocumentWindow(() => url);
      if (!opened) {
        // No tab available (blocker / standalone PWA) — fall back to a download.
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      // Give the tab time to load before releasing the blob.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error('Error exporting risk assessment PDF:', err);
      setPdfError(err?.message || 'Could not generate the PDF');
    } finally {
      setPdfBusyKey(null);
    }
  };

  // Entity-first mode: when entityId is provided, we may not have a userId/user
  const isEntityMode = !!entityId;
  const hasUser = !!user;

  if (isLoading || (!user && !entity)) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
        gap: '20px'
      }}>
        <div style={{
          width: '60px',
          height: '60px',
          border: '4px solid var(--border-color)',
          borderTop: '4px solid var(--accent-color)',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Loading details...</p>
      </div>
    );
  }

  // Derive display info from entity (preferred) or user (fallback)
  const fullName = isEntityMode && entity
    ? ClientEntityHelpers.getEntityDisplayName(entity)
    : `${user?.profile?.firstName || ''} ${user?.profile?.lastName || ''}`.trim() || user?.email || user?.username || '';
  const accountDefaultName = (() => {
    if (isEntityMode && entity?.type === ENTITY_TYPES.PHYSICAL_PERSON) {
      const last = (entity.profile?.lastName || '').toUpperCase();
      const first = entity.profile?.firstName || '';
      return last && first ? `${last} ${first}` : fullName;
    }
    if (!isEntityMode && user?.profile?.lastName) {
      const last = (user.profile.lastName || '').toUpperCase();
      const first = user.profile.firstName || '';
      return last && first ? `${last} ${first}` : fullName;
    }
    return fullName;
  })();
  const initials = isEntityMode && entity
    ? fullName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() || '?'
    : getInitials(user?.profile?.firstName, user?.profile?.lastName, user?.email);
  const assignedRM = relationshipManagers.find(rm => rm._id === (isEntityMode && entity ? entity.relationshipManagerId : user?.relationshipManagerId));
  const assignedUsers = isEntityMode && entity
    ? (entity.assignedUserIds || (entity.relationshipManagerId ? [entity.relationshipManagerId] : []))
        .map(id => relationshipManagers.find(rm => rm._id === id)).filter(Boolean)
    : assignedRM ? [assignedRM] : [];

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  return (
    <div style={{
      padding: isMobile ? '1rem' : '2rem',
      maxWidth: '1400px',
      margin: '0 auto',
      animation: 'fadeIn 0.5s ease-out'
    }}>
      {/* Back Button - hidden when embedded in master-detail view */}
      {!embedded && (
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            marginBottom: '1.5rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: '500',
            transition: 'all 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
            e.currentTarget.style.transform = 'translateX(-4px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-secondary)';
            e.currentTarget.style.transform = 'translateX(0)';
          }}
        >
          <span style={{ fontSize: '18px' }}>←</span>
          Back to Users
        </button>
      )}

      {/* User Header with Avatar and Stats */}
      <LiquidGlassCard
        borderRadius="12px"
        style={{
          marginBottom: isMobile ? '1rem' : '1.5rem',
          padding: isMobile ? '1.5rem' : '2rem'
        }}
      >
        <div style={{ display: 'flex', gap: isMobile ? '1rem' : '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Avatar */}
          <div style={{
            width: isMobile ? '80px' : '100px',
            height: isMobile ? '80px' : '100px',
            borderRadius: '50%',
            background: getAvatarGradient(fullName),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: isMobile ? '28px' : '36px',
            fontWeight: '700',
            color: '#fff',
            boxShadow: '0 8px 16px rgba(0,0,0,0.2)',
            flexShrink: 0
          }}>
            {initials}
          </div>

          {/* User Info */}
          <div style={{ flex: 1, minWidth: '250px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <h1 style={{
                margin: 0,
                fontSize: isMobile ? '1.5rem' : '2rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                lineHeight: 1.2
              }}>
                {fullName}
              </h1>

              {/* Entity Type Badge (entity mode) or Role Badge (user mode) */}
              {isEntityMode && entity && !hasUser ? (
                <span style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  background: entity?.isInsurance ? 'rgba(20, 184, 166, 0.15)' : entity.type === ENTITY_TYPES.COMPANY ? 'rgba(99, 102, 241, 0.15)' : 'rgba(5, 150, 105, 0.15)',
                  color: entity?.isInsurance ? '#14b8a6' : entity.type === ENTITY_TYPES.COMPANY ? '#6366f1' : '#059669',
                  fontSize: '12px',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {ClientEntityHelpers.getEntityTypeLabel(entity.type)}
                </span>
              ) : null}
              {isEntityMode && entity && bankAccounts.length > 0 && (
                <span style={{
                  padding: '4px 10px',
                  borderRadius: '16px',
                  background: 'rgba(37, 99, 235, 0.12)',
                  color: '#2563eb',
                  fontSize: '11px',
                  fontWeight: '600',
                  letterSpacing: '0.3px'
                }}>
                  Client
                </span>
              )}
              {/* Beneficiary of a life-insurance contract: a related party, not a
                  direct client (the contract is held by the insurer) */}
              {isEntityMode && entity && beneficiaryAccounts.length > 0 && (
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: '16px',
                    background: 'rgba(139, 92, 246, 0.12)',
                    color: '#8b5cf6',
                    fontSize: '11px',
                    fontWeight: '600',
                    letterSpacing: '0.3px'
                  }}
                  title={beneficiaryAccounts.map(a => a.name || a.accountNumber).join(', ')}
                >
                  Beneficiary
                </span>
              )}
              {/* Roles held in companies (UBO, director, signatory, shareholder),
                  one badge per role; hover lists the companies */}
              {isEntityMode && entity && [...new Set(entityStakeholderRoles.map(r => r.role))].map(role => (
                <span
                  key={role}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '16px',
                    background: 'rgba(100, 116, 139, 0.12)',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    fontWeight: '600',
                    letterSpacing: '0.3px'
                  }}
                  title={`${role}: ${entityStakeholderRoles.filter(r => r.role === role).map(r => r.companyName).join(', ')}`}
                >
                  {role}
                </span>
              ))}
              {hasUser && editingRole && currentUser?.role === USER_ROLES.SUPERADMIN ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <select
                    value={selectedRole || user.role}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: '2px solid var(--accent-color)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      outline: 'none'
                    }}
                  >
                    <option value={USER_ROLES.CLIENT}>Client</option>
                    <option value={USER_ROLES.RELATIONSHIP_MANAGER}>Relationship Manager</option>
                    <option value={USER_ROLES.COMPLIANCE}>Compliance</option>
                    <option value={USER_ROLES.ADMIN}>Admin</option>
                    <option value={USER_ROLES.SUPERADMIN}>Super Admin</option>
                  </select>
                  <button
                    onClick={handleSaveRole}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      background: 'var(--gain-color)',
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditingRole(false); setSelectedRole(null); }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : hasUser ? (
                <span
                  onClick={() => {
                    if (currentUser?.role === USER_ROLES.SUPERADMIN && user._id !== currentUser._id) {
                      setSelectedRole(user.role);
                      setEditingRole(true);
                    }
                  }}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '20px',
                    background: getRoleBadgeColor(user.role),
                    color: '#fff',
                    fontSize: '12px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                    cursor: currentUser?.role === USER_ROLES.SUPERADMIN && user._id !== currentUser._id ? 'pointer' : 'default',
                    transition: 'transform 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (currentUser?.role === USER_ROLES.SUPERADMIN && user._id !== currentUser._id) {
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                  title={currentUser?.role === USER_ROLES.SUPERADMIN && user._id !== currentUser._id ? 'Click to change role' : ''}
                >
                  {user.role}
                </span>
              ) : null}

              {/* Active Status — only for user-only views (no entity) */}
              {!entity && (
                <span style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '20px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: 'var(--gain-color)',
                  fontSize: '0.75rem',
                  fontWeight: '600'
                }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: 'var(--gain-color)',
                    animation: 'pulse 2s infinite'
                  }} />
                  Active
                </span>
              )}

              {/* Entity Status Badge — computed with the same rule as the contacts list */}
              {entity && (() => {
                const statusDisplay = ClientEntityHelpers.getEntityStatusDisplay(
                  ClientEntityHelpers.getComputedEntityStatus(entity, {
                    hasAccounts: bankAccounts.length > 0,
                    hasStakeholderRoles: entityStakeholderRoles.length > 0,
                    isBeneficialOwner: beneficiaryAccounts.length > 0
                  })
                );
                return (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      background: `color-mix(in srgb, ${statusDisplay.color} 13%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${statusDisplay.color} 31%, transparent)`,
                      color: statusDisplay.color,
                      fontSize: '0.75rem',
                      fontWeight: '600'
                    }}
                    // Prospect/Active is derived from bank accounts and stakeholder roles,
                    // so it is not clickable. Archiving is done with the buttons below.
                    title="Prospect until the entity has a bank account, a role in another entity, or a life-insurance contract as beneficiary"
                  >
                    {statusDisplay.label}
                  </span>
                );
              })()}

              {/* Can Validate Orders Badge - staff roles only, togglable by SuperAdmin */}
              {hasUser && [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.COMPLIANCE, USER_ROLES.STAFF].includes(user.role) && (() => {
                const canToggle = currentUser?.role === USER_ROLES.SUPERADMIN;
                const isEnabled = user.canValidateOrders === true;
                return (
                  <button
                    onClick={async () => {
                      if (!canToggle) return;
                      try {
                        await Meteor.callAsync('users.updateCanValidateOrders', user._id, !isEnabled, sessionId);
                      } catch (err) {
                        console.error('Error updating canValidateOrders:', err);
                        alert(err.reason || 'Failed to update permission');
                      }
                    }}
                    disabled={!canToggle}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      background: isEnabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                      border: `1px solid ${isEnabled ? 'rgba(16, 185, 129, 0.3)' : 'rgba(107, 114, 128, 0.3)'}`,
                      color: isEnabled ? 'var(--gain-color)' : '#6b7280',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: canToggle ? 'pointer' : 'default',
                      transition: 'all 0.2s ease',
                      userSelect: 'none',
                      outline: 'none'
                    }}
                    title={canToggle
                      ? `Click to ${isEnabled ? 'disable' : 'enable'} order validation permission`
                      : 'Order validation permission'}
                  >
                    Can Validate Orders: {isEnabled ? 'Yes' : 'No'}
                  </button>
                );
              })()}

              {/* Can Validate Any Order - validate orders of clients the user does not manage */}
              {hasUser && [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.COMPLIANCE, USER_ROLES.STAFF].includes(user.role) && (() => {
                const canToggle = currentUser?.role === USER_ROLES.SUPERADMIN;
                const isEnabled = user.canValidateAnyOrder === true;
                return (
                  <button
                    onClick={async () => {
                      if (!canToggle) return;
                      try {
                        await Meteor.callAsync('users.updateCanValidateAnyOrder', user._id, !isEnabled, sessionId);
                      } catch (err) {
                        console.error('Error updating canValidateAnyOrder:', err);
                        alert(err.reason || 'Failed to update permission');
                      }
                    }}
                    disabled={!canToggle}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      background: isEnabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                      border: `1px solid ${isEnabled ? 'rgba(16, 185, 129, 0.3)' : 'rgba(107, 114, 128, 0.3)'}`,
                      color: isEnabled ? 'var(--gain-color)' : '#6b7280',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      cursor: canToggle ? 'pointer' : 'default',
                      transition: 'all 0.2s ease',
                      userSelect: 'none',
                      outline: 'none'
                    }}
                    title={canToggle
                      ? `Click to ${isEnabled ? 'restrict validation to this user\'s own clients' : 'allow this user to validate orders of any client'} (enabling it also grants order validation)`
                      : 'Validate orders of clients the user does not manage'}
                  >
                    Can Validate Any Order: {isEnabled ? 'Yes' : 'No'}
                  </button>
                );
              })()}

              {/* Archive / Reactivate buttons (admin, superadmin, compliance) */}
              {isEntityMode && entity && [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(currentUser?.role) && (
                <>
                  {entity.status !== ENTITY_STATUSES.ARCHIVED && (
                    <button
                      onClick={() => {
                        setArchiveError('');
                        setArchiveClosureFile(null);
                        setArchiveClosureDate(new Date().toISOString().split('T')[0]);
                        setShowArchiveModal(true);
                      }}
                      style={{ padding: '6px 14px', borderRadius: '20px', background: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.3)', color: 'var(--warning-color)', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s ease' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251, 191, 36, 0.25)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(251, 191, 36, 0.12)'; }}
                    >
                      Archive
                    </button>
                  )}
                  {entity.status === ENTITY_STATUSES.ARCHIVED && (
                    <button
                      onClick={async () => {
                        const label = ClientEntityHelpers.getEntityDisplayName(entity);
                        const confirmed = await showConfirm(`Reactivate "${label}"?`);
                        if (!confirmed) return;
                        try {
                          await Meteor.callAsync('clientEntities.updateStatus', entityId, ENTITY_STATUSES.ACTIVE, sessionId);
                        } catch (err) {
                          console.error('Failed to reactivate entity:', err);
                        }
                      }}
                      style={{ padding: '6px 14px', borderRadius: '20px', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: 'var(--gain-color)', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s ease' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.12)'; }}
                    >
                      Reactivate
                    </button>
                  )}
                </>
              )}

              {/* Permanent delete (superadmin only) */}
              {isEntityMode && entity && currentUser?.role === USER_ROLES.SUPERADMIN && (
                <button
                  onClick={async () => {
                    const label = ClientEntityHelpers.getEntityDisplayName(entity);
                    const confirmed = await showConfirm(`Are you sure you want to permanently delete "${label}"? This action cannot be undone.`);
                    if (!confirmed) return;
                    try {
                      if (isEntityMode && entityId) {
                        await Meteor.callAsync('clientEntities.deactivate', entityId, sessionId);
                      }
                      if (hasUser && userId) {
                        await Meteor.callAsync('users.remove', userId, sessionId);
                      }
                      if (onBack) onBack();
                    } catch (err) {
                      console.error('Error deleting:', err);
                    }
                  }}
                  style={{ padding: '6px 14px', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--loss-color)', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'; }}
                >
                  Delete
                </button>
              )}

            </div>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {(user?.profile?.createdAt || entity?.createdAt) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <span>📅</span>
                  <span>Created {new Date(user?.profile?.createdAt || entity?.createdAt).toLocaleDateString()}</span>
                </div>
              )}
              {isEntityMode && entity && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  <span>💰</span>
                  <span>{getClientReferenceCurrency(entity, bankAccounts).currency}</span>
                </div>
              )}
            </div>


            {/* KYC risk is assessed per banking relationship, not per client — the
                assessment lives on each bank account (Accounts tab), so there is no
                single client-level risk level to show here. */}
          </div>

          {/* Quick Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: isMobile ? '0.75rem' : '1rem',
            minWidth: isMobile ? '240px' : '280px'
          }}>
            <div style={{
              padding: isMobile ? '1rem' : '1rem',
              background: 'rgba(79, 166, 255, 0.1)',
              border: '1px solid rgba(79, 166, 255, 0.2)',
              borderRadius: '12px'
            }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px', marginBottom: '6px' }}>
                Accounts
              </div>
              {(() => {
                const categoryCounts = {};
                bankAccounts.forEach(acc => {
                  let category;
                  const comment = (acc.comment || '').toLowerCase();
                  if (comment.includes('credit')) {
                    category = 'Credit';
                  } else if (comment === 'spending') {
                    category = 'Spending';
                  } else if (acc.accountType === 'life_insurance') {
                    category = 'Life Insurance';
                  } else {
                    category = 'Investment';
                  }
                  categoryCounts[category] = (categoryCounts[category] || 0) + 1;
                });
                return Object.entries(categoryCounts).map(([cat, count]) => (
                  <div key={cat} style={{ fontSize: '13px', color: 'var(--accent-color)', fontWeight: '600', lineHeight: '1.6' }}>
                    {count} {cat}
                  </div>
                ));
              })()}
              {bankAccounts.length === 0 && (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No accounts</div>
              )}
            </div>

            {hasUser && user.profile?.familyMembers && user.profile?.clientType !== 'company' && (
              <div style={{
                padding: isMobile ? '1rem' : '1rem',
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                borderRadius: '12px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: isMobile ? '1.5rem' : '1.75rem', fontWeight: '700', color: '#8b5cf6', marginBottom: '4px' }}>
                  {user.profile.familyMembers.length}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.5px' }}>
                  Family Members
                </div>
              </div>
            )}
          </div>
        </div>
      </LiquidGlassCard>

      {/* Tab Navigation */}
      {(() => {
        const tabs = [
          { id: 'info', label: 'Information', icon: '👤' },
          { id: 'rmClients', label: 'Clients', icon: '👥', rmOnly: true, userOnly: true },
          { id: 'introducerAccounts', label: 'Accounts Introduced', icon: '🤝', introducerOnly: true, userOnly: true },
          { id: 'accounts', label: 'Accounts', icon: '🏦', entityOrClient: true },
          { id: 'stakeholders', label: 'Stakeholders', icon: '🏛️', entityCompanyOnly: true },
          { id: 'documents', label: 'Documents', icon: '📋', entityOrClient: true, notLifeInsurance: true },
          { id: 'kyc', label: 'KYC', icon: '✅', entityOrClient: true },
          { id: 'usPerson', label: 'US Person', icon: '🇺🇸', entityOnly: true },
          // No 'riskScore' tab: KYC risk is assessed per bank account, from the
          // Risk Matrix panel inside each account row on the Accounts tab.
          { id: 'familyMembers', label: 'Family Members', icon: '👨‍👩‍👧', entityOnly: true, personOnly: true },
          { id: 'family', label: 'Linked People', icon: '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66', clientOnly: true, personOnly: true },
          { id: 'access', label: 'User Access', icon: '\ud83d\udd11', entityOnly: true, notLifeInsurance: true },
          { id: 'password', label: 'Password', icon: '\ud83d\udd12', adminOnly: true, userOnly: true }
        ];

        const isAdmin = currentUser?.role === USER_ROLES.ADMIN || currentUser?.role === USER_ROLES.SUPERADMIN;
        const isViewingClient = hasUser && user.role === USER_ROLES.CLIENT;
        const isViewingRM = hasUser && user.role === USER_ROLES.RELATIONSHIP_MANAGER;
        const isViewingIntroducer = hasUser && user.role === USER_ROLES.INTRODUCER;
        const isCompanyClient = isViewingClient && user?.profile?.clientType === 'company';
        const isEntityCompany = isEntityMode && entity?.type === ENTITY_TYPES.COMPANY;

        const visibleTabs = tabs.filter(tab => {
          // User-only tabs hidden in entity mode without a user
          if (tab.userOnly && isEntityMode && !hasUser) return false;
          // Entity-or-client: show for entity mode OR client user
          if (tab.entityOrClient && !isEntityMode && !isViewingClient) return false;
          // Entity-company-only: show for entity companies OR user company clients
          if (tab.entityCompanyOnly && !isEntityCompany && !isCompanyClient) return false;
          // RM-only tabs shown only when viewing an RM
          if (tab.rmOnly && !isViewingRM) return false;
          // Introducer-only tabs shown only when viewing an Introducer
          if (tab.introducerOnly && !isViewingIntroducer) return false;
          // Person-only tabs hidden for company clients and company entities
          if (tab.personOnly && (isCompanyClient || isEntityCompany)) return false;
          // Client-only tabs shown when viewing a client (admins included)
          if (tab.clientOnly && !isViewingClient) return false;
          // Entity-only tabs shown only when entityId prop is provided
          if (tab.entityOnly && !entityId) return false;
          // Admin-only tabs shown only for admins
          if (tab.adminOnly && !isAdmin) return false;
          return true;
        });

        return (
          <div style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '20px',
            flexWrap: 'wrap'
          }}>
            {visibleTabs.map(tab => {
              // A client declared "not a US person" has nothing more in this
              // tab, so it is greyed out. It stays clickable: the declaration
              // itself lives here and must remain editable.
              const muted = tab.id === 'usPerson' && entity?.usPerson?.isUsPerson === false && activeTab !== tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  title={muted ? 'Not a US person' : undefined}
                  style={{
                    padding: '10px 20px',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: activeTab === tab.id ? 'var(--accent-color)' : 'var(--bg-secondary)',
                    color: activeTab === tab.id ? 'white' : muted ? 'var(--text-muted)' : 'var(--text-primary)',
                    opacity: muted ? 0.5 : 1,
                    filter: muted ? 'grayscale(1)' : 'none',
                    fontWeight: activeTab === tab.id ? '600' : '400',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '0.9rem'
                  }}
                >
                  <span>{tab.icon}</span>
                  {tab.label}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Main Content Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: isMobile ? '1rem' : '1.5rem'
      }}>
        {/* Left Column - Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? '1rem' : '1.5rem' }}>

          {/* Entity Profile Info (entity-only mode without user) */}
          {activeTab === 'info' && isEntityMode && !hasUser && entity && (
            <LiquidGlassCard borderRadius="12px" style={{ padding: isMobile ? '1.5rem' : '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '2px solid var(--border-color)', paddingBottom: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.5rem' }}>
                    {entity?.isInsurance ? '\ud83d\udee1\ufe0f' : entity.type === ENTITY_TYPES.COMPANY ? '\ud83c\udfe2' : '\ud83d\udc64'}
                  </span>
                  Entity Profile
                </h2>
                {!editingBasicInfo ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button onClick={() => setEditingBasicInfo(true)} style={{ padding: '8px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Edit</button>
                    {currentUser?.role === USER_ROLES.SUPERADMIN && (
                      <button
                        onClick={async () => {
                          const label = isEntityMode && entity
                            ? ClientEntityHelpers.getEntityDisplayName(entity)
                            : fullName;
                          const confirmed = await showConfirm(`Are you sure you want to delete "${label}"? This action cannot be undone.`);
                          if (!confirmed) return;
                          try {
                            if (isEntityMode && entityId) {
                              await Meteor.callAsync('clientEntities.deactivate', entityId, sessionId);
                            }
                            if (hasUser && userId) {
                              await Meteor.callAsync('users.remove', userId, sessionId);
                            }
                            if (onBack) onBack();
                          } catch (err) {
                            console.error('Error deleting:', err);
                            alert(err.reason || 'Failed to delete');
                          }
                        }}
                        style={{
                          padding: '8px 16px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '8px',
                          color: 'var(--loss-color)',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: '600',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                      >
                        🗑️ Delete
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={async () => {
                      try {
                        const updates = { profile: {} };
                        if (entity.type === ENTITY_TYPES.PHYSICAL_PERSON) {
                          updates.profile.firstName = formData.firstName;
                          updates.profile.lastName = formData.lastName;
                          updates.profile.birthday = formData.birthday ? new Date(formData.birthday) : null;
                          updates.profile.birthPlace = formData.birthPlace || '';
                          updates.profile.birthCountry = formData.birthCountry || '';
                          updates.profile.nationalities = (formData.nationalities || '').split(',').map(s => s.trim()).filter(Boolean);
                          updates.profile.maritalStatus = formData.maritalStatus || '';
                        } else {
                          updates.profile.companyName = formData.companyName;
                          updates.profile.incorporationDate = formData.incorporationDate ? new Date(formData.incorporationDate) : null;
                          updates.profile.incorporationCountry = formData.incorporationCountry || '';
                        }
                        updates.profile.taxAddress = formData.taxAddress || {};
                        updates.profile.secondaryAddress = formData.secondaryAddress || {};
                        updates.profile.mobilePhone = formData.mobilePhone || '';
                        updates.profile.professionalPhone = formData.professionalPhone || '';
                        updates.profile.homePhone = formData.homePhone || '';
                        updates.profile.email = formData.contactEmail || '';
                        updates.profile.preferredLanguage = formData.preferredLanguage;
                        updates.referenceCurrency = formData.referenceCurrency;
                        updates.isInsurance = formData.isInsurance || false;
                        await Meteor.callAsync('clientEntities.update', entityId, updates, sessionId);
                        setEditingBasicInfo(false);
                      } catch (err) {
                        console.error('Error updating entity:', err);
                      }
                    }} style={{ padding: '8px 16px', background: 'var(--gain-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Save</button>
                    <button onClick={() => setEditingBasicInfo(false)} style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
                  </div>
                )}
              </div>

              {/* Photo and specimen signature — physical persons only. Stored as
                  client documents (disk + token-gated download), not on the
                  entity record, and editable outside the Edit mode since a
                  drop replaces the image in one step. */}
              {entity.type === ENTITY_TYPES.PHYSICAL_PERSON && (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 240px', gap: '16px', marginBottom: '20px', alignItems: 'start' }}>
                  <IdentityImageSlot
                    userId={entityId}
                    documentType={DOCUMENT_TYPES.CLIENT_PHOTO}
                    label="Photo"
                    aspectRatio="1 / 1"
                  />
                  <IdentityImageSlot
                    userId={entityId}
                    documentType={DOCUMENT_TYPES.CLIENT_SIGNATURE}
                    label="Signature"
                    aspectRatio="2 / 1"
                  />
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
                {entity.type === ENTITY_TYPES.PHYSICAL_PERSON ? (
                  <>
                    <EntityField label="First Name" editing={editingBasicInfo} value={formData.firstName} display={entity.profile?.firstName} onChange={v => setFormData({ ...formData, firstName: v })} />
                    <EntityField label="Last Name" editing={editingBasicInfo} value={formData.lastName} display={entity.profile?.lastName} onChange={v => setFormData({ ...formData, lastName: v })} />
                    <EntityField label="Birth Date" type="date" editing={editingBasicInfo} value={formData.birthday}
                      display={entity.profile?.birthday ? new Date(entity.profile.birthday).toLocaleDateString('en-GB') : ''}
                      onChange={v => setFormData({ ...formData, birthday: v })} />
                    <EntityField label="Place of Birth" editing={editingBasicInfo} value={formData.birthPlace} display={entity.profile?.birthPlace} onChange={v => setFormData({ ...formData, birthPlace: v })} />
                    <EntityField label="Country of Birth" editing={editingBasicInfo} value={formData.birthCountry} display={entity.profile?.birthCountry} onChange={v => setFormData({ ...formData, birthCountry: v })} />
                    <EntityField label="Nationalities" editing={editingBasicInfo} value={formData.nationalities}
                      placeholder="Primary first, comma-separated (e.g. French, Monegasque)"
                      display={(entity.profile?.nationalities || []).join(', ')}
                      onChange={v => setFormData({ ...formData, nationalities: v })} />
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Marital Status</label>
                      {editingBasicInfo ? (
                        <select value={formData.maritalStatus || ''} onChange={e => setFormData({ ...formData, maritalStatus: e.target.value })} style={{ width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box', cursor: 'pointer' }}>
                          <option value="">—</option>
                          {MARITAL_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <ReadOnlyField>{MARITAL_STATUS_LABELS[entity.profile?.maritalStatus]}</ReadOnlyField>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Company Name</label>
                      {editingBasicInfo ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <input value={formData.companyName} onChange={e => setFormData({...formData, companyName: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            <input type="checkbox" checked={formData.isInsurance || false} onChange={e => setFormData({...formData, isInsurance: e.target.checked})} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                            Life Insurance Company
                          </label>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <ReadOnlyField>{entity.profile?.companyName}</ReadOnlyField>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            <input type="checkbox" checked={!!entity.isInsurance} disabled readOnly style={{ width: '16px', height: '16px' }} />
                            Life Insurance Company
                          </label>
                        </div>
                      )}
                    </div>
                    <EntityField label="Date of Creation" type="date" editing={editingBasicInfo} value={formData.incorporationDate}
                      display={entity.profile?.incorporationDate ? new Date(entity.profile.incorporationDate).toLocaleDateString('en-GB') : ''}
                      onChange={v => setFormData({ ...formData, incorporationDate: v })} />
                    <EntityField label="Country of Incorporation" editing={editingBasicInfo} value={formData.incorporationCountry} display={entity.profile?.incorporationCountry} onChange={v => setFormData({ ...formData, incorporationCountry: v })} />
                  </>
                )}
                {<><div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Reference Currency</label>
                  {editingBasicInfo ? (
                    <select value={formData.referenceCurrency} onChange={e => setFormData({...formData, referenceCurrency: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box', cursor: 'pointer' }}>
                      {['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <ReadOnlyField>{getClientReferenceCurrency(entity, bankAccounts).currency}</ReadOnlyField>
                  )}
                  {(() => {
                    // The investment accounts decide; this setting only breaks a tie
                    const ref = getClientReferenceCurrency(entity, bankAccounts);
                    const hint = ref.source === 'accounts'
                      ? 'From the investment accounts'
                      : ref.mixed ? 'Investment accounts in several currencies: this setting decides' : 'No investment account yet: this setting applies';
                    return <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>{hint}</div>;
                  })()}
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Language</label>
                  {editingBasicInfo ? (
                    <select value={formData.preferredLanguage} onChange={e => setFormData({...formData, preferredLanguage: e.target.value})} style={{ width: '100%', padding: '10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box', cursor: 'pointer' }}>
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="it">Italian</option>
                      <option value="es">Spanish</option>
                    </select>
                  ) : (
                    <ReadOnlyField>{{'en':'English','fr':'French','de':'German','it':'Italian','es':'Spanish'}[entity.profile?.preferredLanguage] || entity.profile?.preferredLanguage}</ReadOnlyField>
                  )}
                </div>
                </>}

                {/* Tax address */}
                <EntitySectionTitle>📍 Tax Address</EntitySectionTitle>
                <EntityField label="Street" span editing={editingBasicInfo} value={formData.taxAddress?.street} display={entity.profile?.taxAddress?.street}
                  onChange={v => setFormData({ ...formData, taxAddress: { ...formData.taxAddress, street: v } })} />
                <EntityField label="Postal Code" editing={editingBasicInfo} value={formData.taxAddress?.postalCode} display={entity.profile?.taxAddress?.postalCode}
                  onChange={v => setFormData({ ...formData, taxAddress: { ...formData.taxAddress, postalCode: v } })} />
                <EntityField label="City" editing={editingBasicInfo} value={formData.taxAddress?.city} display={entity.profile?.taxAddress?.city}
                  onChange={v => setFormData({ ...formData, taxAddress: { ...formData.taxAddress, city: v } })} />
                <EntityField label="Country of Residence" editing={editingBasicInfo} value={formData.taxAddress?.country} display={entity.profile?.taxAddress?.country}
                  onChange={v => setFormData({ ...formData, taxAddress: { ...formData.taxAddress, country: v } })} />

                {/* Secondary address */}
                <EntitySectionTitle>🏠 Other Address</EntitySectionTitle>
                <EntityField label="Street" span editing={editingBasicInfo} value={formData.secondaryAddress?.street} display={entity.profile?.secondaryAddress?.street}
                  onChange={v => setFormData({ ...formData, secondaryAddress: { ...formData.secondaryAddress, street: v } })} />
                <EntityField label="Postal Code" editing={editingBasicInfo} value={formData.secondaryAddress?.postalCode} display={entity.profile?.secondaryAddress?.postalCode}
                  onChange={v => setFormData({ ...formData, secondaryAddress: { ...formData.secondaryAddress, postalCode: v } })} />
                <EntityField label="City" editing={editingBasicInfo} value={formData.secondaryAddress?.city} display={entity.profile?.secondaryAddress?.city}
                  onChange={v => setFormData({ ...formData, secondaryAddress: { ...formData.secondaryAddress, city: v } })} />
                <EntityField label="Country" editing={editingBasicInfo} value={formData.secondaryAddress?.country} display={entity.profile?.secondaryAddress?.country}
                  onChange={v => setFormData({ ...formData, secondaryAddress: { ...formData.secondaryAddress, country: v } })} />

                {/* Contact */}
                <EntitySectionTitle>📞 Contact</EntitySectionTitle>
                <EntityField label="Mobile Phone" editing={editingBasicInfo} value={formData.mobilePhone} display={entity.profile?.mobilePhone}
                  onChange={v => setFormData({ ...formData, mobilePhone: v })} />
                <EntityField label="Professional Phone" editing={editingBasicInfo} value={formData.professionalPhone} display={entity.profile?.professionalPhone}
                  onChange={v => setFormData({ ...formData, professionalPhone: v })} />
                <EntityField label="Home Phone" editing={editingBasicInfo} value={formData.homePhone} display={entity.profile?.homePhone}
                  onChange={v => setFormData({ ...formData, homePhone: v })} />
                <EntityField label="Email Address" type="email" editing={editingBasicInfo} value={formData.contactEmail} display={entity.profile?.email}
                  onChange={v => setFormData({ ...formData, contactEmail: v })} />
              </div>

              {/* Roles in other entities */}
              {(() => {
                const roles = entityStakeholderRoles;
                if (roles.length === 0) return null;
                return (
                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>Roles in Companies</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {roles.map((r, i) => (
                        <span key={i} style={{
                          padding: '4px 10px', borderRadius: '6px',
                          background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6',
                          fontSize: '0.82rem', fontWeight: '600'
                        }}>
                          {r.role}{r.ownership ? ` ${r.ownership}%` : ''} @ {r.companyName}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Life-insurance contracts this entity is the beneficiary of. The
                  contract is held by the insurer, so it never shows in Accounts. */}
              {beneficiaryAccounts.length > 0 && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '8px' }}>Beneficiary Of</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {beneficiaryAccounts.map(acc => {
                      const holder = allEntities.find(e => e._id === acc.entityId);
                      return (
                        <span key={acc._id} style={{
                          padding: '4px 10px', borderRadius: '6px',
                          background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6',
                          fontSize: '0.82rem', fontWeight: '600'
                        }}>
                          {acc.name || acc.accountNumber}
                          {holder ? ` @ ${ClientEntityHelpers.getEntityDisplayName(holder)}` : ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Basic Information (info tab) — user mode */}
          {activeTab === 'info' && hasUser && (
            <LiquidGlassCard borderRadius="12px" style={{ padding: isMobile ? '1.5rem' : '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isMobile ? '1rem' : '1.5rem', borderBottom: '2px solid var(--border-color)', paddingBottom: '1rem' }}>
              <h2 style={{
                margin: 0,
                fontSize: isMobile ? '1.2rem' : '1.25rem',
                fontWeight: '700',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}>
                <span style={{ fontSize: isMobile ? '1.3rem' : '1.5rem' }}>👤</span>
                Basic Information
              </h2>
              {!editingBasicInfo && (
                <button
                  onClick={() => setEditingBasicInfo(true)}
                  style={{
                    padding: '8px 16px',
                    background: 'var(--accent-color)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 2px 8px rgba(0, 123, 255, 0.3)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 123, 255, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 123, 255, 0.3)';
                  }}
                >
                  ✏️ Edit
                </button>
              )}
            </div>

            {editingBasicInfo ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                <div>
                  <label style={{
                    display: 'block',
                    marginBottom: '8px',
                    color: 'var(--text-secondary)',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    Email *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '16px'
                    }}>
                      ✉️
                    </span>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '12px 12px 12px 40px',
                        background: 'var(--bg-secondary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                        transition: 'all 0.3s ease',
                        outline: 'none'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    />
                  </div>
                </div>

                {/* Client Type (only for client role) */}
                {user.role === USER_ROLES.CLIENT && (
                  <div>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      Client Type
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, clientType: 'natural' })}
                        style={{
                          flex: 1,
                          padding: '10px',
                          borderRadius: '6px',
                          border: `2px solid ${formData.clientType === 'natural' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                          background: formData.clientType === 'natural' ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-secondary)',
                          color: formData.clientType === 'natural' ? 'var(--accent-color)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontWeight: '500',
                          fontSize: '0.9rem',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        Natural Person
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, clientType: 'company' })}
                        style={{
                          flex: 1,
                          padding: '10px',
                          borderRadius: '6px',
                          border: `2px solid ${formData.clientType === 'company' ? 'var(--accent-color)' : 'var(--border-color)'}`,
                          background: formData.clientType === 'company' ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-secondary)',
                          color: formData.clientType === 'company' ? 'var(--accent-color)' : 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontWeight: '500',
                          fontSize: '0.9rem',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        Company
                      </button>
                    </div>
                  </div>
                )}

                {/* Company Name (only for company clients) */}
                {user.role === USER_ROLES.CLIENT && formData.clientType === 'company' && (
                  <div>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={formData.companyName}
                      onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                      placeholder="Enter company name"
                      style={{
                        width: '100%',
                        padding: '12px',
                        background: 'var(--bg-secondary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                        transition: 'all 0.3s ease',
                        outline: 'none'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    />
                  </div>
                )}

                {/* First/Last Name (only for natural persons or non-client roles) */}
                {(user.role !== USER_ROLES.CLIENT || formData.clientType !== 'company') && (
                  <>
                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: 'var(--text-secondary)',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        First Name
                      </label>
                      <input
                        type="text"
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem',
                          transition: 'all 0.3s ease',
                          outline: 'none'
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                      />
                    </div>

                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: 'var(--text-secondary)',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Last Name
                      </label>
                      <input
                        type="text"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem',
                          transition: 'all 0.3s ease',
                          outline: 'none'
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                      />
                    </div>
                  </>
                )}

                {/* Date of Birth - hide for company clients */}
                {(user.role !== USER_ROLES.CLIENT || formData.clientType !== 'company') && (
                  <div>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      Date of Birth
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: '16px'
                      }}>
                        🎂
                      </span>
                      <input
                        type="date"
                        value={formData.birthday}
                        onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px 12px 12px 40px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem',
                          transition: 'all 0.3s ease',
                          outline: 'none'
                        }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label style={{
                    display: 'block',
                    marginBottom: '8px',
                    color: 'var(--text-secondary)',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    Preferred Language
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '16px'
                    }}>
                      🌐
                    </span>
                    <select
                      value={formData.preferredLanguage}
                      onChange={(e) => setFormData({ ...formData, preferredLanguage: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '12px 12px 12px 40px',
                        background: 'var(--bg-secondary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                        transition: 'all 0.3s ease',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    >
                      <option value="en">English</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="es">Spanish</option>
                      <option value="it">Italian</option>
                    </select>
                  </div>
                </div>

                {/* Reference Currency */}
                <div>
                  <label style={{
                    display: 'block',
                    marginBottom: '6px',
                    fontWeight: '500',
                    color: 'var(--text-secondary)',
                    fontSize: '0.85rem'
                  }}>
                    Reference Currency
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      fontSize: '16px'
                    }}>
                      💱
                    </span>
                    <select
                      value={formData.referenceCurrency}
                      onChange={(e) => setFormData({ ...formData, referenceCurrency: e.target.value })}
                      style={{
                        width: '100%',
                        padding: '12px 12px 12px 40px',
                        background: 'var(--bg-secondary)',
                        border: '2px solid var(--border-color)',
                        borderRadius: '6px',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem',
                        transition: 'all 0.3s ease',
                        outline: 'none',
                        cursor: 'pointer'
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                      onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                    >
                      <option value="USD">USD - US Dollar</option>
                      <option value="EUR">EUR - Euro</option>
                      <option value="GBP">GBP - British Pound</option>
                      <option value="CHF">CHF - Swiss Franc</option>
                      <option value="ILS">ILS - Israeli Shekel</option>
                    </select>
                  </div>
                </div>

                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
                  <button
                    onClick={() => {
                      setEditingBasicInfo(false);
                      setFormData({
                        email: user.email || user.username || '',
                        firstName: user.profile?.firstName || '',
                        lastName: user.profile?.lastName || '',
                        birthday: user.profile?.birthday ? new Date(user.profile.birthday).toISOString().split('T')[0] : '',
                        preferredLanguage: user.profile?.preferredLanguage || 'en',
                        referenceCurrency: user.profile?.referenceCurrency || 'EUR',
                        relationshipManagerId: user.relationshipManagerId || '',
                        newPassword: '',
                        clientType: user.profile?.clientType || 'natural',
                        companyName: user.profile?.companyName || ''
                      });
                      setStakeholders(user.profile?.stakeholders || []);
                    }}
                    style={{
                      padding: '12px 24px',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: '500',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveBasicInfo}
                    style={{
                      padding: '12px 24px',
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    💾 Save Changes
                  </button>
                </div>
              </div>
            ) : (() => {
              // Read-only view laid out like the edit form above
              const userFieldLabel = { display: 'block', marginBottom: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' };
              const userFieldBox = { padding: '12px', border: '2px solid var(--border-color)', fontSize: '0.95rem', minHeight: '46px' };
              const isCompanyClient = user.role === USER_ROLES.CLIENT && user.profile?.clientType === 'company';
              const languageLabels = { en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian' };
              const currencyLabels = { USD: 'USD - US Dollar', EUR: 'EUR - Euro', GBP: 'GBP - British Pound', CHF: 'CHF - Swiss Franc', ILS: 'ILS - Israeli Shekel' };
              const currency = user.profile?.referenceCurrency || 'EUR';
              const language = user.profile?.preferredLanguage || 'en';
              return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                <div>
                  <label style={userFieldLabel}>Email</label>
                  <ReadOnlyField style={userFieldBox}>{user.email || user.username}</ReadOnlyField>
                </div>

                {user.role === USER_ROLES.CLIENT && (
                  <div>
                    <label style={userFieldLabel}>Client Type</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {[{ v: 'natural', text: 'Natural Person' }, { v: 'company', text: 'Company' }].map(opt => {
                        const selected = (user.profile?.clientType || 'natural') === opt.v;
                        return (
                          <button key={opt.v} type="button" disabled style={{
                            flex: 1, padding: '10px', borderRadius: '6px', cursor: 'default', fontWeight: '500', fontSize: '0.9rem',
                            border: `2px solid ${selected ? 'var(--accent-color)' : 'var(--border-color)'}`,
                            background: selected ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-secondary)',
                            color: selected ? 'var(--accent-color)' : 'var(--text-secondary)'
                          }}>{opt.text}</button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isCompanyClient ? (
                  <div>
                    <label style={userFieldLabel}>Company Name</label>
                    <ReadOnlyField style={userFieldBox}>{user.profile?.companyName}</ReadOnlyField>
                  </div>
                ) : (
                  <>
                    <div>
                      <label style={userFieldLabel}>First Name</label>
                      <ReadOnlyField style={userFieldBox}>{user.profile?.firstName}</ReadOnlyField>
                    </div>
                    <div>
                      <label style={userFieldLabel}>Last Name</label>
                      <ReadOnlyField style={userFieldBox}>{user.profile?.lastName}</ReadOnlyField>
                    </div>
                    <div>
                      <label style={userFieldLabel}>Date of Birth</label>
                      <ReadOnlyField style={userFieldBox}>
                        {user.profile?.birthday && (
                          <>
                            🎂 {new Date(user.profile.birthday).toLocaleDateString()}
                            {calculateAge(user.profile.birthday) && (
                              <span style={{ marginLeft: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                                ({calculateAge(user.profile.birthday)} years)
                              </span>
                            )}
                          </>
                        )}
                      </ReadOnlyField>
                    </div>
                  </>
                )}

                <div>
                  <label style={userFieldLabel}>Preferred Language</label>
                  <ReadOnlyField style={userFieldBox}>🌐 {languageLabels[language] || language.toUpperCase()}</ReadOnlyField>
                </div>

                <div>
                  <label style={userFieldLabel}>Reference Currency</label>
                  <ReadOnlyField style={userFieldBox}>💱 {currencyLabels[currency] || currency}</ReadOnlyField>
                </div>
              </div>
              );
            })()}
          </LiquidGlassCard>
          )}

          {/* RM's Clients - rmClients tab (when viewing an RM profile) */}
          {activeTab === 'rmClients' && hasUser && user.role === USER_ROLES.RELATIONSHIP_MANAGER && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span>👥</span> Assigned Clients
                  <span style={{
                    fontSize: '0.85rem',
                    fontWeight: '500',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    background: 'var(--accent-color)',
                    color: 'white'
                  }}>
                    {rmClients.length}
                  </span>
                </h2>
              </div>

              {rmClientsLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                  Loading clients...
                </div>
              ) : rmClients.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '3rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  border: '1px dashed var(--border-color)'
                }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>👤</div>
                  <p style={{ margin: 0, fontSize: '1rem' }}>No clients assigned to this RM yet</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {rmClients.map(client => {
                    const firstName = client.profile?.firstName || client.firstName || '';
                    const lastName = client.profile?.lastName || client.lastName || '';
                    const displayName = firstName || lastName ? `${firstName} ${lastName}`.trim() : 'Unnamed';
                    const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || '?';

                    return (
                      <div
                        key={client._id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '1rem',
                          padding: '1rem',
                          background: 'var(--bg-secondary)',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {/* Avatar */}
                        <div style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--info-color) 0%, #8b5cf6 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontWeight: '600',
                          fontSize: '1rem',
                          flexShrink: 0
                        }}>
                          {initials}
                        </div>

                        {/* Client Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontWeight: '600',
                            color: 'var(--text-primary)',
                            fontSize: '1rem',
                            marginBottom: '4px'
                          }}>
                            {displayName}
                          </div>
                          <div style={{
                            fontSize: '0.85rem',
                            color: 'var(--text-secondary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {client.email}
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          background: 'rgba(5, 150, 105, 0.1)',
                          color: '#059669',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          flexShrink: 0
                        }}>
                          Client
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Introducer's Accounts - introducerAccounts tab (when viewing an Introducer profile) */}
          {activeTab === 'introducerAccounts' && hasUser && user.role === USER_ROLES.INTRODUCER && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span>🤝</span> Accounts Introduced
                  <span style={{
                    fontSize: '0.85rem',
                    fontWeight: '500',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    background: 'var(--accent-color)',
                    color: 'white'
                  }}>
                    {introducerAccounts.length}
                  </span>
                </h2>
              </div>

              {introducerAccountsLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                  Loading accounts...
                </div>
              ) : introducerAccounts.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '3rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  border: '1px dashed var(--border-color)'
                }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>🏦</div>
                  <p style={{ margin: 0, fontSize: '1rem' }}>No accounts introduced yet</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {introducerAccounts.map(account => {
                    const initials = account.clientName?.split(' ').map(n => n[0]).join('').toUpperCase() || '?';

                    return (
                      <div
                        key={account._id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '1rem',
                          padding: '1rem',
                          background: 'var(--bg-secondary)',
                          borderRadius: '10px',
                          border: '1px solid var(--border-color)',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {/* Bank logo or icon */}
                        <div style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '12px',
                          background: getBankLogoPath(account.bankName) ? 'var(--bg-primary)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          overflow: 'hidden',
                          border: getBankLogoPath(account.bankName) ? '1px solid var(--border-color)' : 'none'
                        }}>
                          {getBankLogoPath(account.bankName) ? (
                            <img
                              src={getBankLogoPath(account.bankName)}
                              alt={account.bankName}
                              style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                            />
                          ) : (
                            <span style={{ fontSize: '24px' }}>🏦</span>
                          )}
                        </div>

                        {/* Account Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontWeight: '600',
                            color: 'var(--text-primary)',
                            fontSize: '1rem',
                            marginBottom: '4px'
                          }}>
                            {account.bankName}
                          </div>
                          <div style={{
                            fontSize: '0.85rem',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            gap: '8px',
                            flexWrap: 'wrap',
                            alignItems: 'center'
                          }}>
                            <span>{account.accountNumber}</span>
                            <span style={{ color: 'var(--text-muted)' }}>•</span>
                            <span style={{ fontWeight: '500', color: 'var(--info-color)' }}>{account.clientName}</span>
                          </div>
                        </div>

                        {/* Currency Badge */}
                        <div style={{
                          padding: '4px 10px',
                          borderRadius: '6px',
                          background: isDarkMode ? 'rgba(79, 166, 255, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                          color: 'var(--accent-color)',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          flexShrink: 0
                        }}>
                          {account.referenceCurrency || 'EUR'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Linked Client Entities (shown in info tab for non-entity views) */}
          {activeTab === 'info' && !entityId && linkedEntities.length > 0 && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <h3 style={{
                margin: '0 0 16px 0',
                fontSize: '1.1rem',
                fontWeight: '600',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>🏢</span> Linked Client Entities
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {linkedEntities.map(ent => {
                  const statusDisplay = ClientEntityHelpers.getEntityStatusDisplay(ent.status);
                  return (
                    <div key={ent._id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '1.1rem' }}>
                          {ent.type === ENTITY_TYPES.PHYSICAL_PERSON ? '\ud83d\udc64' : ent.type === ENTITY_TYPES.COMPANY ? '\ud83c\udfe2' : '\ud83d\udee1\ufe0f'}
                        </span>
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            {ClientEntityHelpers.getEntityDisplayName(ent)}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {ClientEntityHelpers.getEntityTypeLabel(ent.type)} · {ent.accessLevel} access
                          </div>
                        </div>
                      </div>
                      <span style={{
                        fontSize: '0.65rem',
                        fontWeight: '600',
                        padding: '2px 8px',
                        borderRadius: '10px',
                        background: `color-mix(in srgb, ${statusDisplay.color} 8%, transparent)`,
                        color: statusDisplay.color
                      }}>
                        {statusDisplay.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </LiquidGlassCard>
          )}

          {/* Linked User Accounts (shown in info tab for entity views) */}
          {activeTab === 'info' && entityId && linkedUsers.length > 0 && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <h3 style={{
                margin: '0 0 16px 0',
                fontSize: '1.1rem',
                fontWeight: '600',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>🔑</span> Linked User Accounts
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {linkedUsers.map(u => (
                  <div key={u._id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {u.profile?.firstName || ''} {u.profile?.lastName || ''} {!u.profile?.firstName && !u.profile?.lastName && (u.email || 'Unnamed')}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {u.email} · {u.role} · {u.accessLevel} access
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </LiquidGlassCard>
          )}

          {/* Bank Accounts - accounts tab — unified table with expandable rows */}
          {activeTab === 'accounts' && (isEntityMode || (hasUser && user.role === USER_ROLES.CLIENT)) && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.3rem' }}>🏦</span> Bank Accounts
                  <span style={{ fontSize: '0.8rem', fontWeight: '600', padding: '2px 8px', borderRadius: '10px', background: 'var(--accent-color)', color: 'white' }}>{bankAccounts.length}</span>
                </h2>
                <button onClick={() => { if (!showAddAccount) { setNewAccount(prev => ({...prev, name: accountDefaultName})); } setShowAddAccount(!showAddAccount); }} style={{
                  background: showAddAccount ? 'var(--danger-color)' : 'var(--gain-color)', color: 'white', border: 'none',
                  padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600'
                }}>{showAddAccount ? 'Cancel' : '+ Add Account'}</button>
              </div>

              {/* Add Account Form (compact) */}
              {showAddAccount && (
                <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '10px', marginBottom: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Name</label>
                      <input type="text" placeholder={fullName} value={newAccount.name} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, name: val})); }}
                        style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Bank *</label>
                      <select value={newAccount.bankId} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, bankId: val})); }}
                        style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <option value="">Select bank...</option>
                        {banks.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Account # *</label>
                      <input type="text" value={newAccount.accountNumber} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, accountNumber: val})); }}
                        style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Currency</label>
                      <select value={newAccount.referenceCurrency} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, referenceCurrency: val})); }}
                        style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                        {['EUR','USD','GBP','CHF','JPY','CAD','AUD','ILS'].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    {(entity?.isInsurance || newAccount.accountStructure === 'life_insurance') && (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Beneficial Owners (UBOs)</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                          {(newAccount.beneficialOwnerIds || []).map(uboId => {
                            const uboEntity = allEntities.find(e => e._id === uboId);
                            return uboEntity ? (
                              <span key={uboId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.75rem', fontWeight: '600', background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9' }}>
                                {ClientEntityHelpers.getEntityDisplayName(uboEntity)}
                                <span onClick={() => setNewAccount(prev => ({...prev, beneficialOwnerIds: (prev.beneficialOwnerIds || []).filter(id => id !== uboId)}))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                              </span>
                            ) : null;
                          })}
                        </div>
                        <select value="_placeholder" onChange={e => { const val = e.target.value; if (val && val !== '_placeholder') { setNewAccount(prev => ({...prev, beneficialOwnerIds: [...(prev.beneficialOwnerIds || []), val]})); } }}
                          style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <option value="_placeholder">Add UBO...</option>
                          {allEntities.filter(e => e._id !== entityId && (e.type === ENTITY_TYPES.PHYSICAL_PERSON || e.type === ENTITY_TYPES.COMPANY) && !(newAccount.beneficialOwnerIds || []).includes(e._id)).map(e => (
                            <option key={e._id} value={e._id}>{ClientEntityHelpers.getEntityDisplayName(e)} ({ClientEntityHelpers.getEntityTypeLabel(e.type)})</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {(
                      <div>
                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Description</label>
                        <select value={newAccount.comment} onChange={e => { const val = e.target.value; setNewAccount(prev => ({...prev, comment: val})); }}
                          style={{ width: '100%', padding: '9px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <option value="">Select...</option>
                          <option value="Investments">Investments</option>
                          <option value="Credit line">Credit line</option>
                          <option value="Credit card">Credit card</option>
                          <option value="Spending">Spending</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--border-color)' }}>
                    <AccessRightsPicker value={newAccount.accessRights} onChange={v => setNewAccount(prev => ({ ...prev, accessRights: v }))} />
                  </div>

                  {/* Authorized contacts for order communication */}
                  {(() => {
                    const addPhoneValid = !newAccount.authorizedPhone || E164_PHONE_REGEX.test(newAccount.authorizedPhone.trim());
                    const emailInputValid = !newAccountEmailInput.trim() || AUTHORIZED_EMAIL_REGEX.test(newAccountEmailInput.trim());
                    const handleAddEmail = () => {
                      const val = newAccountEmailInput.trim();
                      if (!val || !AUTHORIZED_EMAIL_REGEX.test(val)) return;
                      if ((newAccount.authorizedEmails || []).some(e => e.toLowerCase() === val.toLowerCase())) { setNewAccountEmailInput(''); return; }
                      setNewAccount(prev => ({ ...prev, authorizedEmails: [...(prev.authorizedEmails || []), val] }));
                      setNewAccountEmailInput('');
                    };
                    return (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--border-color)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Authorized contacts</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Authorized emails</label>
                            {(newAccount.authorizedEmails || []).length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                {(newAccount.authorizedEmails || []).map(em => (
                                  <span key={em} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.75rem', fontWeight: '600', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--gain-color)' }}>
                                    {em}
                                    <span title="Remove" onClick={() => setNewAccount(prev => ({ ...prev, authorizedEmails: (prev.authorizedEmails || []).filter(e => e !== em) }))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                                  </span>
                                ))}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <input type="email" placeholder={(newAccount.authorizedEmails || []).length ? 'another@example.com' : 'client@example.com'} value={newAccountEmailInput}
                                onChange={e => setNewAccountEmailInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddEmail(); } }}
                                style={{ flex: 1, padding: '9px', border: `1px solid ${emailInputValid ? 'var(--border-color)' : 'var(--loss-color)'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                              <button type="button" onClick={handleAddEmail}
                                disabled={!newAccountEmailInput.trim() || !emailInputValid}
                                style={{ padding: '8px 14px', background: (!newAccountEmailInput.trim() || !emailInputValid) ? 'var(--bg-secondary)' : 'var(--accent-color)', color: (!newAccountEmailInput.trim() || !emailInputValid) ? 'var(--text-muted)' : 'white', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: (!newAccountEmailInput.trim() || !emailInputValid) ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: '600' }}>Add</button>
                            </div>
                            {!emailInputValid
                              ? <div style={{ color: 'var(--loss-color)', fontSize: '0.7rem', marginTop: '3px' }}>Invalid email format</div>
                              : <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '3px' }}>Any of these addresses may send order instructions for this account.</div>}
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>Authorized phone (E.164)</label>
                            <input type="tel" placeholder="+33612345678" value={newAccount.authorizedPhone}
                              onChange={e => { const val = e.target.value; setNewAccount(prev => ({ ...prev, authorizedPhone: val })); }}
                              style={{ width: '100%', padding: '9px', border: `1px solid ${addPhoneValid ? 'var(--border-color)' : 'var(--loss-color)'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }} />
                            {!addPhoneValid && <div style={{ color: 'var(--loss-color)', fontSize: '0.7rem', marginTop: '3px' }}>Must be E.164, e.g. +33612345678</div>}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
                    <button onClick={() => { setShowAddAccount(false); setNewAccount({ name: '', bankId: '', accountNumber: '', referenceCurrency: 'USD', accountType: 'personal', accountStructure: 'direct', lifeInsuranceCompany: '', relationshipManagerId: '', backupRmIds: [], beneficialOwnerIds: [], comment: '', authorizedEmails: [], authorizedPhone: '', accessRights: '' }); setNewAccountEmailInput(''); }}
                      style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
                    {(() => {
                      const addEmailOk = !newAccountEmailInput.trim() || AUTHORIZED_EMAIL_REGEX.test(newAccountEmailInput.trim());
                      const addPhoneOk = !newAccount.authorizedPhone || E164_PHONE_REGEX.test(newAccount.authorizedPhone.trim());
                      const canAdd = newAccount.bankId && newAccount.accountNumber && newAccount.accessRights && addEmailOk && addPhoneOk;
                      return (
                        <button onClick={handleAddBankAccount}
                          disabled={!canAdd}
                          style={{ padding: '8px 16px', background: !canAdd ? 'rgba(16, 185, 129, 0.4)' : 'var(--gain-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: !canAdd ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Add Account</button>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Accounts Table */}
              {bankAccounts.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem', opacity: 0.3 }}>🏦</div>
                  <p style={{ margin: 0 }}>No bank accounts yet</p>
                </div>
              ) : (
                <div style={{ borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Bank</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Name</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Account</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>CCY</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Type</th>
                        {entity?.isInsurance && <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>UBO</th>}
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Profile</th>
                        <th style={{ padding: '10px 14px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)' }}>Risk</th>
                        <th style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1.5px solid var(--border-color)', width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bankAccounts.map((account, idx) => {
                        const bank = banks.find(b => b._id === account.bankId);
                        const isExpanded = expandedAccountId === account._id;
                        const profile = accountProfiles?.find(p => p.bankAccountId === account._id);
                        const uboIds = account.beneficialOwnerIds || (account.beneficialOwnerId ? [account.beneficialOwnerId] : []);
                        const ubos = uboIds.map(id => allEntities.find(e => e._id === id)).filter(Boolean);
                        const isEditing = editingBankAccount === account._id;
                        // Joint account: the other client entities holding this same account
                        const holders = getAccountHolderIds(account)
                          .map(id => allEntities.find(e => e._id === id))
                          .filter(Boolean);
                        const coHolders = holders.filter(h => h._id !== (entityId || userId));

                        return (
                          <React.Fragment key={account._id}>
                            {/* Compact row */}
                            <tr
                              onClick={() => setExpandedAccountId(isExpanded ? null : account._id)}
                              style={{ cursor: 'pointer', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)', borderTop: idx > 0 ? '1px solid var(--border-color)' : 'none', transition: 'background 0.12s' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                              onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)'}
                            >
                              <td style={{ padding: '10px 14px', fontWeight: '600', color: 'var(--text-primary)' }}>{bank?.name || '-'}</td>
                              <td style={{ padding: '10px 14px', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                {account.name || buildJointAccountName(holders) || fullName}
                                {coHolders.length > 0 && (
                                  <div style={{ marginTop: '2px', fontSize: '0.72rem', color: '#8b5cf6', fontWeight: '600' }}>
                                    Joint with {coHolders.map(h => ClientEntityHelpers.getEntityDisplayName(h)).join(', ')}
                                  </div>
                                )}
                                <div style={{ marginTop: '3px' }}>
                                  {account.accessRights === ACCOUNT_ACCESS_RIGHTS.VIEW_ONLY ? (
                                    <span title="No power of attorney: orders cannot be placed on this account" style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: '600', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--loss-color)' }}>View only — no orders</span>
                                  ) : account.accessRights === ACCOUNT_ACCESS_RIGHTS.POWER_OF_ATTORNEY ? (
                                    <span style={{ padding: '1px 6px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: '600', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--gain-color)' }}>Power of attorney</span>
                                  ) : (
                                    <span title="Edit the account to record whether we hold a power of attorney" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Mandate not set</span>
                                  )}
                                </div>
                              </td>
                              <td style={{ padding: '10px 14px', fontFamily: "'Roboto Mono', monospace", fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{account.accountNumber}</td>
                              <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', background: 'rgba(79, 166, 255, 0.1)', color: 'var(--accent-color)' }}>{account.referenceCurrency}</span>
                              </td>
                              <td style={{ padding: '10px 14px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{account.comment || account.accountType}</td>
                              {entity?.isInsurance && <td style={{ padding: '10px 14px', fontSize: '0.82rem', color: ubos.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{ubos.length > 0 ? ubos.map(u => ClientEntityHelpers.getEntityDisplayName(u)).join(', ') : '-'}</td>}
                              <td style={{ padding: '10px 14px' }}>
                                {profile && isNoProfile(profile) ? (
                                  <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{NO_PROFILE_NAME}</span>
                                ) : profile ? (
                                  <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--gain-color)' }}>{profile.profileName || 'Set'}</span>
                                ) : (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>-</span>
                                )}
                              </td>
                              {/* The account's KYC risk (business-relationship level). */}
                              <td style={{ padding: '10px 14px' }}>
                                {(() => {
                                  const level = account.kycRiskScore?.businessRelationship?.riskLevel;
                                  if (!level) return <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Not assessed</span>;
                                  const risk = getRiskLevelDisplay(level);
                                  return (
                                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600', whiteSpace: 'nowrap', background: `color-mix(in srgb, ${risk.color} 10%, transparent)`, color: risk.color }}>
                                      {risk.emoji} {risk.labelEn}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: '0.8rem' }}>{isExpanded ? '▲' : '▼'}</td>
                            </tr>

                            {/* Expanded detail row */}
                            {isExpanded && (
                              <tr style={{ background: 'var(--bg-tertiary)' }}>
                                <td colSpan={entity?.isInsurance ? 9 : 8} style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px' }}>
                                    {/* Left: Account Details & Edit */}
                                    <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '10px', border: '1px solid var(--border-color)', gridColumn: isEditing && !isMobile ? '1 / -1' : 'auto' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)' }}>Account Details</h4>
                                        {!isEditing && (
                                          <button onClick={(e) => { e.stopPropagation(); handleEditBankAccount(account); setEditingBankAccount(account._id); }}
                                            style={{ padding: '4px 10px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}>Edit</button>
                                        )}
                                      </div>
                                      {isEditing ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Name</label>
                                            <input type="text" value={editBankAccountData.name || ''} onChange={e => setEditBankAccountData(prev => ({...prev, name: e.target.value}))}
                                              placeholder={fullName}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Account Number</label>
                                            <input type="text" value={editBankAccountData.accountNumber || ''} onChange={e => setEditBankAccountData(prev => ({...prev, accountNumber: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Currency</label>
                                            <select value={editBankAccountData.referenceCurrency || 'EUR'} onChange={e => setEditBankAccountData(prev => ({...prev, referenceCurrency: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              {['EUR','USD','GBP','CHF','JPY','CAD','AUD','ILS'].map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                          </div>
                                          {(<>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Description</label>
                                            <select value={editBankAccountData.comment || ''} onChange={e => setEditBankAccountData(prev => ({...prev, comment: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="">-</option><option value="Investments">Investments</option><option value="Credit line">Credit line</option><option value="Spending">Spending</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Credit Line</label>
                                            <input type="number" value={editBankAccountData.authorizedOverdraft || ''} onChange={e => setEditBankAccountData(prev => ({...prev, authorizedOverdraft: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Introducer</label>
                                            <select value={editBankAccountData.introducerId || ''} onChange={e => setEditBankAccountData(prev => ({...prev, introducerId: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="">No Introducer</option>
                                              {introducers.map(i => <option key={i._id} value={i._id}>{`${i.profile?.firstName || ''} ${i.profile?.lastName || ''}`.trim()}</option>)}
                                            </select>
                                          </div>
                                          </>)}
                                          {/* Joint account: a second (or third) client entity holding the
                                              SAME account — a couple, typically. One account, one row, several
                                              holders; do NOT create a combined "A & B" client for this. */}
                                          {isEntityMode && !entity?.isInsurance && (
                                            <div style={{ gridColumn: '1 / -1' }}>
                                              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Joint holders</label>
                                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px', alignItems: 'center' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: '600', background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                                                  title="The primary holder is always a holder and cannot be removed here">
                                                  {ClientEntityHelpers.getEntityDisplayName(entity)} <span style={{ opacity: 0.6 }}>(primary)</span>
                                                </span>
                                                {(editBankAccountData.holderEntityIds || []).filter(id => id !== entityId).map(holderId => {
                                                  const holderEntity = allEntities.find(e => e._id === holderId);
                                                  return holderEntity ? (
                                                    <span key={holderId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: '600', background: 'rgba(139, 92, 246, 0.12)', color: '#8b5cf6' }}>
                                                      {ClientEntityHelpers.getEntityDisplayName(holderEntity)}
                                                      <span onClick={() => setEditBankAccountData(prev => ({...prev, holderEntityIds: (prev.holderEntityIds || []).filter(id => id !== holderId)}))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                                                    </span>
                                                  ) : null;
                                                })}
                                              </div>
                                              <select value="_placeholder" onChange={e => { const val = e.target.value; if (val && val !== '_placeholder') { setEditBankAccountData(prev => ({...prev, holderEntityIds: [...new Set([entityId, ...(prev.holderEntityIds || []), val])]})); } }}
                                                style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                                <option value="_placeholder">Add joint holder...</option>
                                                {allEntities.filter(e => e._id !== entityId && !(editBankAccountData.holderEntityIds || []).includes(e._id)).map(e => (
                                                  <option key={e._id} value={e._id}>{ClientEntityHelpers.getEntityDisplayName(e)}</option>
                                                ))}
                                              </select>
                                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                                                Each holder sees this account and its holdings on their own profile.
                                              </div>
                                            </div>
                                          )}
                                          {(isEntityMode && entity?.isInsurance) && (
                                            <div style={{ gridColumn: '1 / -1' }}>
                                              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Beneficial Owners (UBOs)</label>
                                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                                {(editBankAccountData.beneficialOwnerIds || []).map(uboId => {
                                                  const uboEntity = allEntities.find(e => e._id === uboId);
                                                  return uboEntity ? (
                                                    <span key={uboId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: '600', background: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9' }}>
                                                      {ClientEntityHelpers.getEntityDisplayName(uboEntity)}
                                                      <span onClick={() => setEditBankAccountData(prev => ({...prev, beneficialOwnerIds: (prev.beneficialOwnerIds || []).filter(id => id !== uboId)}))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                                                    </span>
                                                  ) : null;
                                                })}
                                              </div>
                                              <select value="_placeholder" onChange={e => { const val = e.target.value; if (val && val !== '_placeholder') { setEditBankAccountData(prev => ({...prev, beneficialOwnerIds: [...(prev.beneficialOwnerIds || []), val]})); } }}
                                                style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                                <option value="_placeholder">Add UBO...</option>
                                                {allEntities.filter(e => e._id !== entityId && (e.type === ENTITY_TYPES.PHYSICAL_PERSON || e.type === ENTITY_TYPES.COMPANY) && !(editBankAccountData.beneficialOwnerIds || []).includes(e._id)).map(e => (
                                                  <option key={e._id} value={e._id}>{ClientEntityHelpers.getEntityDisplayName(e)}</option>
                                                ))}
                                              </select>
                                            </div>
                                          )}
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Relationship Manager</label>
                                            <select value={editBankAccountData.relationshipManagerId || ''} onChange={e => setEditBankAccountData(prev => ({...prev, relationshipManagerId: e.target.value}))}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="">No RM</option>
                                              {relationshipManagers.map(rm => <option key={rm._id} value={rm._id}>{rm.profile?.firstName} {rm.profile?.lastName}</option>)}
                                            </select>
                                          </div>
                                          <div>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Backup RMs</label>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                              {(editBankAccountData.backupRmIds || []).map(rmId => {
                                                const rm = relationshipManagers.find(r => r._id === rmId);
                                                return rm ? (
                                                  <span key={rmId} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: '600', background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
                                                    {rm.profile?.firstName} {rm.profile?.lastName}
                                                    <span onClick={() => setEditBankAccountData(prev => ({...prev, backupRmIds: (prev.backupRmIds || []).filter(id => id !== rmId)}))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                                                  </span>
                                                ) : null;
                                              })}
                                            </div>
                                            <select value={'_placeholder'} onChange={e => { const val = e.target.value; if (val && val !== '_placeholder') { setEditBankAccountData(prev => ({...prev, backupRmIds: [...(prev.backupRmIds || []), val]})); } }}
                                              style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="_placeholder">Add backup...</option>
                                              {relationshipManagers.filter(rm => rm._id !== editBankAccountData.relationshipManagerId && !(editBankAccountData.backupRmIds || []).includes(rm._id)).map(rm => <option key={rm._id} value={rm._id}>{rm.profile?.firstName} {rm.profile?.lastName}</option>)}
                                            </select>
                                          </div>
                                          <div style={{ gridColumn: '1 / -1', marginTop: '8px', paddingTop: '10px', borderTop: '1px dashed var(--border-color)' }}>
                                            <AccessRightsPicker value={editBankAccountData.accessRights} onChange={v => setEditBankAccountData(prev => ({ ...prev, accessRights: v }))} />
                                            {!editBankAccountData.accessRights && (
                                              <div style={{ fontSize: '0.7rem', color: 'var(--warning-color)', marginTop: '4px' }}>Not specified yet — orders are allowed until it is set.</div>
                                            )}
                                          </div>
                                          {(() => {
                                            const editPhoneValid =!editBankAccountData.authorizedPhone || E164_PHONE_REGEX.test((editBankAccountData.authorizedPhone || '').trim());
                                            const emailInputValid = !editAccountEmailInput.trim() || AUTHORIZED_EMAIL_REGEX.test(editAccountEmailInput.trim());
                                            const handleAddEmail = () => {
                                              const val = editAccountEmailInput.trim();
                                              if (!val || !AUTHORIZED_EMAIL_REGEX.test(val)) return;
                                              if ((editBankAccountData.authorizedEmails || []).some(e => e.toLowerCase() === val.toLowerCase())) { setEditAccountEmailInput(''); return; }
                                              setEditBankAccountData(prev => ({ ...prev, authorizedEmails: [...(prev.authorizedEmails || []), val] }));
                                              setEditAccountEmailInput('');
                                            };
                                            return (
                                              <div style={{ gridColumn: '1 / -1', marginTop: '8px', paddingTop: '10px', borderTop: '1px dashed var(--border-color)' }}>
                                                <div style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Authorized contacts</div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                                                  <div style={{ gridColumn: '1 / -1' }}>
                                                    <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Authorized emails</label>
                                                    {(editBankAccountData.authorizedEmails || []).length > 0 && (
                                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                                                        {(editBankAccountData.authorizedEmails || []).map(em => (
                                                          <span key={em} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: '600', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--gain-color)' }}>
                                                            {em}
                                                            <span title="Remove" onClick={() => setEditBankAccountData(prev => ({ ...prev, authorizedEmails: (prev.authorizedEmails || []).filter(e => e !== em) }))} style={{ cursor: 'pointer', marginLeft: '2px', fontWeight: '700' }}>&times;</span>
                                                          </span>
                                                        ))}
                                                      </div>
                                                    )}
                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                      <input type="email" placeholder={(editBankAccountData.authorizedEmails || []).length ? 'another@example.com' : 'client@example.com'} value={editAccountEmailInput}
                                                        onChange={e => setEditAccountEmailInput(e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddEmail(); } }}
                                                        style={{ flex: 1, padding: '7px', border: `1px solid ${emailInputValid ? 'var(--border-color)' : 'var(--loss-color)'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                                      <button type="button" onClick={handleAddEmail}
                                                        disabled={!editAccountEmailInput.trim() || !emailInputValid}
                                                        style={{ padding: '6px 12px', background: (!editAccountEmailInput.trim() || !emailInputValid) ? 'var(--bg-secondary)' : 'var(--accent-color)', color: (!editAccountEmailInput.trim() || !emailInputValid) ? 'var(--text-muted)' : 'white', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: (!editAccountEmailInput.trim() || !emailInputValid) ? 'not-allowed' : 'pointer', fontSize: '0.78rem', fontWeight: '600' }}>Add</button>
                                                    </div>
                                                    {!emailInputValid
                                                      ? <div style={{ color: 'var(--loss-color)', fontSize: '0.68rem', marginTop: '3px' }}>Invalid email format</div>
                                                      : <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '3px' }}>Any of these addresses may send order instructions for this account.</div>}
                                                  </div>
                                                  <div>
                                                    <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Authorized phone (E.164)</label>
                                                    <input type="tel" placeholder="+33612345678" value={editBankAccountData.authorizedPhone || ''}
                                                      onChange={e => setEditBankAccountData(prev => ({ ...prev, authorizedPhone: e.target.value }))}
                                                      style={{ width: '100%', padding: '7px', border: `1px solid ${editPhoneValid ? 'var(--border-color)' : 'var(--loss-color)'}`, borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                                                    {!editPhoneValid && <div style={{ color: 'var(--loss-color)', fontSize: '0.68rem', marginTop: '3px' }}>Must be E.164, e.g. +33612345678</div>}
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })()}
                                          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', marginTop: '6px' }}>
                                            <button onClick={() => handleSaveEditBankAccount(account._id)} style={{ padding: '7px 14px', background: 'var(--gain-color)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600' }}>Save</button>
                                            <button onClick={() => { setEditingBankAccount(null); setEditBankAccountData({}); setEditAccountEmailInput(''); }} style={{ padding: '7px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
                                            <button onClick={() => handleDeleteBankAccount(account._id)} style={{ padding: '7px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: 'var(--loss-color)', cursor: 'pointer', fontSize: '0.82rem', marginLeft: 'auto' }}>Delete</button>
                                          </div>
                                        </div>
                                      ) : (() => {
                                        // Read-only view laid out like the edit form above
                                        const rm = account.relationshipManagerId ? relationshipManagers.find(r => r._id === account.relationshipManagerId) : null;
                                        const intro = account.introducerId ? introducers.find(i => i._id === account.introducerId) : null;
                                        const accLabel = { display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' };
                                        const chip = (color, bg) => ({ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: '600', background: bg, color });
                                        const backupRms = (account.backupRmIds || []).map(id => relationshipManagers.find(r => r._id === id)).filter(Boolean);
                                        const authorizedEmails = account.authorizedEmails || [];
                                        return (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                          <div>
                                            <label style={accLabel}>Name</label>
                                            <ReadOnlyField size="sm">{account.name || buildJointAccountName(holders) || fullName}</ReadOnlyField>
                                          </div>
                                          <div>
                                            <label style={accLabel}>Account Number</label>
                                            <ReadOnlyField size="sm" style={{ fontFamily: "'Roboto Mono', monospace" }}>{account.accountNumber}</ReadOnlyField>
                                          </div>
                                          <div>
                                            <label style={accLabel}>Currency</label>
                                            <ReadOnlyField size="sm">{account.referenceCurrency}</ReadOnlyField>
                                          </div>
                                          <div>
                                            <label style={accLabel}>Description</label>
                                            <ReadOnlyField size="sm">{account.comment || account.accountType}</ReadOnlyField>
                                          </div>
                                          <div>
                                            <label style={accLabel}>Credit Line</label>
                                            <ReadOnlyField size="sm">{account.authorizedOverdraft > 0 ? `${account.referenceCurrency} ${account.authorizedOverdraft.toLocaleString()}` : ''}</ReadOnlyField>
                                          </div>
                                          <div>
                                            <label style={accLabel}>Introducer</label>
                                            <ReadOnlyField size="sm">{intro ? `${intro.profile?.firstName || ''} ${intro.profile?.lastName || ''}`.trim() : 'No Introducer'}</ReadOnlyField>
                                          </div>
                                          {isEntityMode && !entity?.isInsurance && (
                                            <div style={{ gridColumn: '1 / -1' }}>
                                              <label style={accLabel}>Joint holders</label>
                                              <ReadOnlyField size="sm">
                                                {holders.length > 0 ? holders.map(h => (
                                                  <span key={h._id} style={h._id === entityId ? chip('var(--text-secondary)', 'var(--bg-tertiary)') : chip('#8b5cf6', 'rgba(139, 92, 246, 0.12)')}>
                                                    {ClientEntityHelpers.getEntityDisplayName(h)}{h._id === entityId && <span style={{ opacity: 0.6, marginLeft: '4px' }}>(primary)</span>}
                                                  </span>
                                                )) : entity && (
                                                  <span style={chip('var(--text-secondary)', 'var(--bg-tertiary)')}>
                                                    {ClientEntityHelpers.getEntityDisplayName(entity)}<span style={{ opacity: 0.6, marginLeft: '4px' }}>(primary)</span>
                                                  </span>
                                                )}
                                              </ReadOnlyField>
                                            </div>
                                          )}
                                          {isEntityMode && entity?.isInsurance && (
                                            <div style={{ gridColumn: '1 / -1' }}>
                                              <label style={accLabel}>Beneficial Owners (UBOs)</label>
                                              <ReadOnlyField size="sm">
                                                {ubos.map(u => <span key={u._id} style={chip('#0ea5e9', 'rgba(14, 165, 233, 0.1)')}>{ClientEntityHelpers.getEntityDisplayName(u)}</span>)}
                                              </ReadOnlyField>
                                            </div>
                                          )}
                                          {account.accountType === 'life_insurance' && account.lifeInsuranceCompany && (
                                            <div style={{ gridColumn: '1 / -1' }}>
                                              <label style={accLabel}>Insurance Company</label>
                                              <ReadOnlyField size="sm">{account.lifeInsuranceCompany}</ReadOnlyField>
                                            </div>
                                          )}
                                          <div>
                                            <label style={accLabel}>Relationship Manager</label>
                                            <ReadOnlyField size="sm">{rm ? `${rm.profile?.firstName} ${rm.profile?.lastName}` : 'No RM'}</ReadOnlyField>
                                          </div>
                                          <div>
                                            <label style={accLabel}>Backup RMs</label>
                                            <ReadOnlyField size="sm">
                                              {backupRms.map(brm => <span key={brm._id} style={chip('#8b5cf6', 'rgba(139, 92, 246, 0.1)')}>{brm.profile?.firstName} {brm.profile?.lastName}</span>)}
                                            </ReadOnlyField>
                                          </div>
                                          <div style={{ gridColumn: '1 / -1', marginTop: '8px', paddingTop: '10px', borderTop: '1px dashed var(--border-color)' }}>
                                            <AccessRightsPicker value={account.accessRights} readOnly />
                                            {!account.accessRights && (
                                              <div style={{ fontSize: '0.7rem', color: 'var(--warning-color)', marginTop: '4px' }}>Not specified yet — orders are allowed until it is set.</div>
                                            )}
                                          </div>
                                          <div style={{ gridColumn: '1 / -1', marginTop: '8px', paddingTop: '10px', borderTop: '1px dashed var(--border-color)' }}>
                                            <div style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Authorized contacts</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                                              <div style={{ gridColumn: '1 / -1' }}>
                                                <label style={accLabel}>Authorized emails</label>
                                                <ReadOnlyField size="sm">
                                                  {authorizedEmails.map(em => <span key={em} style={chip('var(--gain-color)', 'rgba(16, 185, 129, 0.1)')}>{em}</span>)}
                                                </ReadOnlyField>
                                              </div>
                                              <div>
                                                <label style={accLabel}>Authorized phone (E.164)</label>
                                                <ReadOnlyField size="sm">{account.authorizedPhone}</ReadOnlyField>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                        );
                                      })()}
                                    </div>

                                    {/* Right: Investment Profile */}
                                    <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)' }}>Investment Profile</h4>
                                        <button onClick={(e) => { e.stopPropagation(); if (editingAccountProfile === account._id) { handleSaveAccountProfile(account._id); } else { handleStartEditAccountProfile(account._id); } }}
                                          style={{ padding: '4px 10px', background: editingAccountProfile === account._id ? 'var(--gain-color)' : 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}>
                                          {editingAccountProfile === account._id ? 'Save' : (profile ? 'Edit' : 'Set Profile')}
                                        </button>
                                      </div>
                                      {editingAccountProfile === account._id ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                          <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Template</label>
                                            <select onChange={e => { if (e.target.value) applyTemplate(e.target.value); }} style={{ width: '100%', padding: '7px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
                                              <option value="">Apply template...</option>
                                              <option value={NO_PROFILE_KEY}>{NO_PROFILE_NAME}</option>
                                              {Object.entries(PROFILE_TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}
                                            </select>
                                          </div>
                                          {accountProfileDraft.noProfile ? (
                                            <div style={{ gridColumn: '1 / -1', padding: '10px 12px', borderRadius: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                              <strong style={{ color: 'var(--text-primary)' }}>{NO_PROFILE_NAME}</strong>: not an investment account. No allocation limits are checked. Choose a template to set limits.
                                            </div>
                                          ) : PROFILE_CATEGORIES.map(category => {
                                            const minField = `min${category.key}`;
                                            const maxField = `max${category.key}`;
                                            const minValue = getProfileLimit(accountProfileDraft, minField);
                                            const maxValue = getProfileLimit(accountProfileDraft, maxField);
                                            const rangeInvalid = minValue > maxValue;
                                            return (
                                              <div key={category.key}>
                                                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>{category.label}</label>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                  <PercentInput
                                                    value={minValue}
                                                    onChange={v => handleAccountAllocationChange(minField, v)}
                                                    invalid={rangeInvalid}
                                                    ariaLabel={`${category.label} minimum percentage`}
                                                  />
                                                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>–</span>
                                                  <PercentInput
                                                    value={maxValue}
                                                    onChange={v => handleAccountAllocationChange(maxField, v)}
                                                    invalid={rangeInvalid}
                                                    ariaLabel={`${category.label} maximum percentage`}
                                                  />
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: rangeInvalid ? 'var(--loss-color)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '2px' }}>
                                                  <span>Min</span>
                                                  <span>Max</span>
                                                </div>
                                              </div>
                                            );
                                          })}
                                          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <input type="checkbox" checked={accountProfileDraft.isProfessionalInvestor || false} onChange={e => setAccountProfileDraft(prev => ({...prev, isProfessionalInvestor: e.target.checked}))} />
                                            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Professional Investor</span>
                                          </div>
                                          <div style={{ gridColumn: '1 / -1' }}>
                                            <button onClick={() => setEditingAccountProfile(null)} style={{ padding: '6px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
                                          </div>
                                        </div>
                                      ) : profile ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                          <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>Profile</label>
                                            <ReadOnlyField size="sm">{isNoProfile(profile) ? NO_PROFILE_NAME : profile.profileName}</ReadOnlyField>
                                          </div>
                                          {isNoProfile(profile) ? (
                                            <div style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                              Not an investment account: no allocation limits are checked.
                                            </div>
                                          ) : PROFILE_CATEGORIES.map(category => (
                                            <div key={category.key}>
                                              <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '3px' }}>{category.label}</label>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                <PercentInput readOnly value={getProfileLimit(profile, `min${category.key}`)} ariaLabel={`${category.label} minimum percentage`} />
                                                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>–</span>
                                                <PercentInput readOnly value={getProfileLimit(profile, `max${category.key}`)} ariaLabel={`${category.label} maximum percentage`} />
                                              </div>
                                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginTop: '2px' }}>
                                                <span>Min</span>
                                                <span>Max</span>
                                              </div>
                                            </div>
                                          ))}
                                          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <input type="checkbox" checked={!!profile.isProfessionalInvestor} disabled readOnly />
                                            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Professional Investor</span>
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No profile set</div>
                                      )}
                                    </div>

                                    {/* Right: Risk Matrix — assessed per banking
                                        relationship, so this reads THIS account's
                                        assessment, not a shared client-level one. */}
                                    {(isEntityMode || (hasUser && user.role === USER_ROLES.CLIENT)) && (() => {
                                      const riskScore = account.kycRiskScore;
                                      const history = account.kycRiskScoreHistory || [];
                                      const getHighestRisk = (rs) => {
                                        if (!rs) return null;
                                        const levels = [rs.clientProspect?.riskLevel, rs.beneficialOwner?.riskLevel, rs.businessRelationship?.riskLevel].filter(Boolean);
                                        return levels.includes('high') ? 'high' : levels.includes('medium') ? 'medium' : levels.length > 0 ? 'low' : null;
                                      };
                                      const highestRisk = getHighestRisk(riskScore);
                                      const display = highestRisk ? getRiskLevelDisplay(highestRisk) : null;
                                      const isOverdue = riskScore?.nextReviewDate && new Date(riskScore.nextReviewDate) < new Date();
                                      const canAssess = [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(currentUser?.role);

                                      return (
                                        <div style={{ padding: '16px', background: 'var(--bg-secondary)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                            <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                              KYC Risk Matrix
                                              {riskScore && (
                                                <span style={{ fontSize: '0.65rem', fontWeight: '600', padding: '1px 6px', borderRadius: '4px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                                                  title="Every assessment is kept; the current one is the latest version">
                                                  v{history.length + 1}
                                                </span>
                                              )}
                                            </h4>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                              {riskScore && (() => {
                                                const busyKey = `${account._id}:current`;
                                                const busy = pdfBusyKey === busyKey;
                                                return (
                                                  <button onClick={(e) => { e.stopPropagation(); exportRiskScorePdf(riskScore, account, busyKey); }}
                                                    disabled={!!pdfBusyKey}
                                                    title="Export this assessment as PDF for the audit trail"
                                                    style={{ padding: '4px 10px', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '5px', cursor: pdfBusyKey ? 'wait' : 'pointer', fontSize: '0.75rem', fontWeight: '600', opacity: pdfBusyKey && !busy ? 0.5 : 1 }}>
                                                    {busy ? '⏳ Generating…' : '📄 PDF'}
                                                  </button>
                                                );
                                              })()}
                                              {/* Saving always writes a new version and archives the
                                                  previous one, so "Edit" was misleading. */}
                                              {canAssess && (
                                                <button onClick={(e) => { e.stopPropagation(); openRiskScoreModal(account._id); }}
                                                  title={riskScore
                                                    ? 'Record a new assessment — the current one is kept as a previous version'
                                                    : 'Record the first assessment for this banking relationship'}
                                                  style={{ padding: '4px 10px', background: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600' }}>
                                                  {riskScore ? 'New assessment' : 'Assess'}
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                          {pdfError && (
                                            <div style={{ marginBottom: '10px', padding: '6px 10px', borderRadius: '6px', fontSize: '0.72rem', background: 'color-mix(in srgb, var(--loss-color) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--loss-color) 30%, transparent)', color: 'var(--loss-color)' }}>
                                              {pdfError}
                                            </div>
                                          )}
                                          {riskScore ? (
                                            <div>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                                <span style={{
                                                  padding: '3px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: '600',
                                                  background: `color-mix(in srgb, ${display.color} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${display.color} 25%, transparent)`, color: display.color
                                                }}>
                                                  {display.emoji} {display.labelEn}
                                                </span>
                                              </div>
                                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '10px' }}>
                                                {[
                                                  { label: 'Client', data: riskScore.clientProspect },
                                                  { label: 'Benef.', data: riskScore.beneficialOwner },
                                                  { label: 'Bus. Rel.', data: riskScore.businessRelationship }
                                                ].map(col => {
                                                  const colDisplay = col.data?.riskLevel ? getRiskLevelDisplay(col.data.riskLevel) : null;
                                                  return (
                                                    <div key={col.label} style={{ padding: '6px', background: 'var(--bg-primary)', borderRadius: '6px', textAlign: 'center' }}>
                                                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '2px' }}>{col.label}</div>
                                                      <div style={{ fontSize: '0.9rem', fontWeight: '700', color: colDisplay?.color || 'var(--text-muted)' }}>
                                                        {col.data?.totalScore ?? '-'}
                                                      </div>
                                                      {colDisplay && <div style={{ fontSize: '0.6rem', color: colDisplay.color }}>{colDisplay.labelEn}</div>}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                {riskScore.assessmentDate && (
                                                  <span>Assessed: {new Date(riskScore.assessmentDate).toLocaleDateString()}</span>
                                                )}
                                                {riskScore.nextReviewDate && (
                                                  <span style={{ color: isOverdue ? 'var(--loss-color)' : 'var(--text-muted)', fontWeight: isOverdue ? '600' : '400' }}>
                                                    Review: {new Date(riskScore.nextReviewDate).toLocaleDateString()} {isOverdue ? '(overdue)' : ''}
                                                  </span>
                                                )}
                                              </div>
                                              {riskScore.comments && (
                                                <div style={{ marginTop: '8px', padding: '6px 8px', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.72rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                                                  {riskScore.comments}
                                                </div>
                                              )}
                                              {history.length > 0 && (
                                                <div style={{ marginTop: '10px', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
                                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '4px' }}>
                                                    Previous versions
                                                  </div>
                                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {[...history].reverse().map((h, i) => {
                                                      const versionNo = history.length - i;
                                                      const busyKey = `${account._id}:v${versionNo}`;
                                                      const busy = pdfBusyKey === busyKey;
                                                      // The strip is newest-first; the stored array is oldest-first.
                                                      const historyIndex = versionNo - 1;
                                                      const deleting = deletingVersionKey === busyKey;
                                                      const hLevels = [h.clientProspect?.riskLevel, h.beneficialOwner?.riskLevel, h.businessRelationship?.riskLevel].filter(Boolean);
                                                      const hHighest = hLevels.includes('high') ? 'high' : hLevels.includes('medium') ? 'medium' : hLevels.length ? 'low' : null;
                                                      const hDisplay = hHighest ? getRiskLevelDisplay(hHighest) : null;
                                                      return (
                                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                          <button
                                                            onClick={(e) => { e.stopPropagation(); openRiskScoreVersion(account._id, h, `v${versionNo}`); }}
                                                            title="Open this superseded version"
                                                            style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: '3px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <span style={{ fontWeight: '700', color: 'var(--text-muted)' }}>v{versionNo}</span>
                                                            <span>{h.assessmentDate ? new Date(h.assessmentDate).toLocaleDateString('en-GB') : '—'}</span>
                                                            {hDisplay && <span style={{ color: hDisplay.color }}>{hDisplay.emoji} {hDisplay.labelEn}</span>}
                                                          </button>
                                                          <button
                                                            onClick={(e) => { e.stopPropagation(); exportRiskScorePdf(h, account, busyKey); }}
                                                            disabled={!!pdfBusyKey}
                                                            title="Export this version as PDF"
                                                            style={{ padding: '3px 8px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', color: 'var(--text-secondary)', cursor: pdfBusyKey ? 'wait' : 'pointer', fontSize: '0.68rem', flexShrink: 0, opacity: pdfBusyKey && !busy ? 0.5 : 1 }}>
                                                            {busy ? '⏳' : '📄'}
                                                          </button>
                                                          {canDeleteRiskScoreVersion && (
                                                            <button
                                                              onClick={(e) => { e.stopPropagation(); deleteRiskScoreVersion(account, historyIndex, h, `v${versionNo}`, busyKey); }}
                                                              disabled={!!deletingVersionKey}
                                                              title={`Delete v${versionNo} permanently`}
                                                              style={{ padding: '3px 8px', background: 'var(--bg-primary)', border: '1px solid color-mix(in srgb, var(--loss-color) 35%, transparent)', borderRadius: '4px', color: 'var(--loss-color)', cursor: deletingVersionKey ? 'wait' : 'pointer', fontSize: '0.68rem', flexShrink: 0, opacity: deletingVersionKey && !deleting ? 0.5 : 1 }}>
                                                              {deleting ? '⏳' : '🗑️'}
                                                            </button>
                                                          )}
                                                        </div>
                                                      );
                                                    })}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          ) : (
                                            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Not assessed</div>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Stakeholders - stakeholders tab (company entities) */}
          {activeTab === 'stakeholders' && ((isEntityMode && entity?.type === ENTITY_TYPES.COMPANY) || (hasUser && user?.role === USER_ROLES.CLIENT && user?.profile?.clientType === 'company')) && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.3rem' }}>🏛️</span> Stakeholders
                </h2>
                <button onClick={() => setShowAddStakeholder(!showAddStakeholder)} style={{
                  background: showAddStakeholder ? 'var(--danger-color)' : 'var(--gain-color)', color: 'white', border: 'none',
                  padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600'
                }}>{showAddStakeholder ? 'Cancel' : '+ Add Stakeholder'}</button>
              </div>

              {/* Add Stakeholder Form */}
              {showAddStakeholder && (
                <div style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Person / Company *</label>
                      <select
                        value={newStakeholder.entityId || ''}
                        onChange={(e) => {
                          const selected = allEntities.find(ent => ent._id === e.target.value);
                          setNewStakeholder({
                            ...newStakeholder,
                            entityId: e.target.value,
                            name: selected ? ClientEntityHelpers.getEntityDisplayName(selected) : ''
                          });
                        }}
                        style={{ width: '100%', padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem', cursor: 'pointer' }}
                      >
                        <option value="">Select person or company...</option>
                        {allEntities
                          .filter(e => e._id !== entityId && (e.type === ENTITY_TYPES.PHYSICAL_PERSON || e.type === ENTITY_TYPES.COMPANY))
                          .map(e => (
                            <option key={e._id} value={e._id}>
                              {ClientEntityHelpers.getEntityDisplayName(e)} ({ClientEntityHelpers.getEntityTypeLabel(e.type)})
                            </option>
                          ))
                        }
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Role *</label>
                      <select value={newStakeholder.role} onChange={(e) => setNewStakeholder({ ...newStakeholder, role: e.target.value })}
                        style={{ width: '100%', padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem', cursor: 'pointer' }}>
                        <option value="ubo">Ultimate Beneficial Owner (UBO)</option>
                        <option value="director">Director</option>
                        <option value="signatory">Authorized Signatory</option>
                        <option value="shareholder">Shareholder</option>
                      </select>
                    </div>
                    {(newStakeholder.role === 'ubo' || newStakeholder.role === 'shareholder') && (
                      <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Ownership %</label>
                        <input type="number" value={newStakeholder.ownership} onChange={(e) => setNewStakeholder({ ...newStakeholder, ownership: e.target.value })}
                          placeholder="e.g. 25" min="0" max="100"
                          style={{ width: '100%', padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem' }} />
                      </div>
                    )}
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' }}>Notes</label>
                      <input type="text" value={newStakeholder.notes} onChange={(e) => setNewStakeholder({ ...newStakeholder, notes: e.target.value })}
                        placeholder="Optional notes"
                        style={{ width: '100%', padding: '10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => { setShowAddStakeholder(false); setNewStakeholder({ entityId: '', name: '', role: 'ubo', ownership: '', notes: '' }); }}
                      style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
                    <button
                      onClick={async () => {
                        if (!newStakeholder.entityId) return;
                        const { _editIdx, ...shData } = newStakeholder;
                        let updated;
                        if (_editIdx !== undefined && _editIdx !== null) {
                          updated = stakeholders.map((s, i) => i === _editIdx ? { ...s, ...shData } : s);
                        } else {
                          updated = [...stakeholders, { ...shData, _id: Date.now().toString(), createdAt: new Date() }];
                        }
                        setStakeholders(updated);
                        try {
                          if (isEntityMode && entityId) {
                            await Meteor.callAsync('clientEntities.update', entityId, { stakeholders: updated }, sessionId);
                          } else {
                            await Meteor.callAsync('users.updateProfile', userId, { profile: { ...user.profile, stakeholders: updated, updatedAt: new Date() } }, sessionId);
                          }
                        } catch (err) { console.error('Error saving stakeholder:', err); }
                        setNewStakeholder({ entityId: '', name: '', role: 'ubo', ownership: '', notes: '' });
                        setShowAddStakeholder(false);
                      }}
                      disabled={!newStakeholder.entityId}
                      style={{ padding: '8px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontWeight: '500', fontSize: '0.85rem', opacity: !newStakeholder.entityId ? 0.5 : 1 }}
                    >{newStakeholder._editIdx !== undefined && newStakeholder._editIdx !== null ? 'Save' : 'Add'}</button>
                  </div>
                </div>
              )}

              {/* Stakeholder List */}
              {stakeholders.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>Add UBOs, directors, and other key persons</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {stakeholders.map((sh, idx) => {
                    const roleLabels = { ubo: 'UBO', director: 'Director', signatory: 'Signatory', shareholder: 'Shareholder' };
                    const roleColors = { ubo: '#dc2626', director: '#2563eb', signatory: '#059669', shareholder: '#7c3aed' };
                    return (
                      <div key={sh._id || idx} style={{ padding: '14px 16px', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        {(() => {
                          const shLabel = { display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase' };
                          const ent = sh.entityId ? allEntities.find(e => e._id === sh.entityId) : null;
                          const fullRoleLabels = { ubo: 'Ultimate Beneficial Owner (UBO)', director: 'Director', signatory: 'Authorized Signatory', shareholder: 'Shareholder' };
                          return (
                            <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                              <div>
                                <label style={shLabel}>Person / Company</label>
                                <ReadOnlyField>
                                  {sh.name}
                                  {ent && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>({ClientEntityHelpers.getEntityTypeLabel(ent.type)})</span>}
                                </ReadOnlyField>
                              </div>
                              <div>
                                <label style={shLabel}>Role</label>
                                <ReadOnlyField style={{ color: roleColors[sh.role] || 'var(--text-primary)', fontWeight: '600' }}>{fullRoleLabels[sh.role] || roleLabels[sh.role] || sh.role}</ReadOnlyField>
                              </div>
                              {(sh.role === 'ubo' || sh.role === 'shareholder') && (
                                <div>
                                  <label style={shLabel}>Ownership %</label>
                                  <ReadOnlyField>{sh.ownership ? `${sh.ownership}%` : ''}</ReadOnlyField>
                                </div>
                              )}
                              <div style={{ gridColumn: '1 / -1' }}>
                                <label style={shLabel}>Notes</label>
                                <ReadOnlyField>{sh.notes}</ReadOnlyField>
                              </div>
                            </div>
                          );
                        })()}
                        <button
                          onClick={async () => {
                            const updated = stakeholders.filter((_, i) => i !== idx);
                            setStakeholders(updated);
                            try {
                              if (isEntityMode && entityId) {
                                await Meteor.callAsync('clientEntities.update', entityId, { stakeholders: updated }, sessionId);
                              } else {
                                await Meteor.callAsync('users.updateProfile', userId, { profile: { ...user.profile, stakeholders: updated, updatedAt: new Date() } }, sessionId);
                              }
                            } catch (err) { console.error('Error removing stakeholder:', err); }
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-muted)', padding: '4px' }}
                          title="Remove stakeholder"
                        >×</button>
                        <button
                          onClick={() => {
                            setNewStakeholder({ entityId: sh.entityId || '', name: sh.name, role: sh.role, ownership: sh.ownership || '', notes: sh.notes || '', _editIdx: idx });
                            setShowAddStakeholder(true);
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--accent-color)', padding: '4px' }}
                          title="Edit stakeholder"
                        >Edit</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Documents - documents tab (when viewing a client profile) */}
          {activeTab === 'documents' && (isEntityMode || (hasUser && user.role === USER_ROLES.CLIENT)) && (
            <ClientDocumentManager
              userId={userId || entityId}
              familyMembers={user?.profile?.familyMembers || (entityId ? familyMembers : [])}
              // Corporate documents (trade register, UBO register, articles,
              // signatory powers) only apply to companies. 'life_insurance' is a
              // legacy entity type that is also a legal person.
              isCompany={
                (isEntityMode && (entity?.type === ENTITY_TYPES.COMPANY || entity?.type === 'life_insurance'))
                || (hasUser && user?.profile?.clientType === 'company')
              }
            />
          )}

          {/* KYC — entity mode */}
          {activeTab === 'kyc' && isEntityMode && entity && (() => {
            const kyc = editingEntityKyc ? entityKycDraft : (entity.kyc || {});
            const setKyc = (patch) => setEntityKycDraft({ ...entityKycDraft, ...patch });
            return (
              <LiquidGlassCard borderRadius="12px" style={{ padding: isMobile ? '1.5rem' : '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '2px solid var(--border-color)', paddingBottom: '1rem' }}>
                  <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.5rem' }}>✅</span> KYC
                  </h2>
                  {!editingEntityKyc ? (
                    <button onClick={() => { setEntityKycDraft({ ...(entity.kyc || {}) }); setEditingEntityKyc(true); }} style={{ padding: '8px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Edit</button>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={async () => {
                        try {
                          await Meteor.callAsync('clientEntities.update', entityId, { kyc: entityKycDraft }, sessionId);
                          setEditingEntityKyc(false);
                        } catch (err) {
                          console.error('Error updating KYC:', err);
                        }
                      }} style={{ padding: '8px 16px', background: 'var(--gain-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Save</button>
                      <button onClick={() => setEditingEntityKyc(false)} style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
                    </div>
                  )}
                </div>

                <YesNoField
                  label="Politically Exposed Person (PEP)"
                  editing={editingEntityKyc}
                  value={kyc.isPep ?? null}
                  onChange={v => setKyc({ isPep: v })}
                />

                <div style={{ marginTop: '20px', marginBottom: '4px', fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  💰 Financial Profile
                </div>

                <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                  <EntityField
                    label="Portfolio Amount / Initial Contribution"
                    editing={editingEntityKyc}
                    value={kyc.portfolioAmount}
                    display={formatAmountDisplay(kyc.portfolioAmount)}
                    placeholder="e.g. €750,000"
                    onChange={v => setKyc({ portfolioAmount: v })}
                  />
                </div>

                <ChoiceField
                  label="Portfolio Potential"
                  editing={editingEntityKyc}
                  value={kyc.portfolioPotential}
                  onChange={v => setKyc({ portfolioPotential: v })}
                  options={PORTFOLIO_POTENTIAL_OPTIONS}
                />

                <ChoiceField
                  label="Wealth"
                  editing={editingEntityKyc}
                  value={kyc.wealthCategory}
                  onChange={v => setKyc({ wealthCategory: v })}
                  options={WEALTH_OPTIONS}
                />

                <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: '12px' }}>
                  <EntityField label="Of which: Real Estate" editing={editingEntityKyc} value={kyc.wealthRealEstate} display={formatAmountDisplay(kyc.wealthRealEstate)} onChange={v => setKyc({ wealthRealEstate: v })} />
                  <EntityField label="Of which: Bank Assets" editing={editingEntityKyc} value={kyc.wealthBankAssets} display={formatAmountDisplay(kyc.wealthBankAssets)} onChange={v => setKyc({ wealthBankAssets: v })} />
                  <EntityField label="Other" editing={editingEntityKyc} value={kyc.wealthOther} display={formatAmountDisplay(kyc.wealthOther)} onChange={v => setKyc({ wealthOther: v })} />
                </div>

                <ChoiceField
                  label="Annual Income"
                  editing={editingEntityKyc}
                  value={kyc.annualIncomeCategory}
                  onChange={v => setKyc({ annualIncomeCategory: v })}
                  options={ANNUAL_INCOME_OPTIONS}
                />

                <div style={{ padding: '12px 0' }}>
                  <EntityField
                    label="Other Known Bank Accounts"
                    editing={editingEntityKyc}
                    value={kyc.otherBankAccounts}
                    display={kyc.otherBankAccounts}
                    onChange={v => setKyc({ otherBankAccounts: v })}
                  />
                </div>

                {/* Account opening committee — the decision that admits the
                    relationship. Kept with KYC because it is the outcome of it. */}
                <div style={{ marginTop: '20px', marginBottom: '4px', fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🏛️ Account Opening Committee
                </div>

                <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border-color)', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', alignItems: 'start' }}>
                  <EntityField
                    label="Committee Date"
                    editing={editingEntityKyc}
                    type="date"
                    value={toDateInputValue(kyc.committeeDate)}
                    display={kyc.committeeDate ? new Date(kyc.committeeDate).toLocaleDateString() : ''}
                    onChange={v => setKyc({ committeeDate: v || null })}
                  />
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
                      Outcome
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {COMMITTEE_OUTCOMES.map(opt => (
                        <button key={opt.value} type="button" disabled={!editingEntityKyc}
                          onClick={editingEntityKyc ? () => setKyc({ committeeOutcome: kyc.committeeOutcome === opt.value ? null : opt.value }) : undefined}
                          style={{
                            padding: '7px 16px', borderRadius: '6px', cursor: editingEntityKyc ? 'pointer' : 'default', fontSize: '0.82rem', fontWeight: '600',
                            border: kyc.committeeOutcome === opt.value ? 'none' : '1px solid var(--border-color)',
                            background: kyc.committeeOutcome === opt.value ? opt.color : 'var(--bg-secondary)',
                            color: kyc.committeeOutcome === opt.value ? 'white' : 'var(--text-secondary)',
                            transition: 'all 0.15s ease'
                          }}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ padding: '12px 0' }}>
                  <EntityField
                    label="Committee Notes"
                    editing={editingEntityKyc}
                    value={kyc.committeeNotes}
                    display={kyc.committeeNotes}
                    placeholder="Conditions, reservations, attendees…"
                    onChange={v => setKyc({ committeeNotes: v })}
                  />
                </div>

                <KycDocumentManager userId={entityId} />

                {/* Periodic review — the recurring re-examination of the
                    relationship. Its due date follows the client's risk level,
                    so the interval is derived rather than typed. */}
                {(() => {
                  // Risk is assessed per banking relationship; the client's
                  // review cadence follows their WORST-rated account.
                  const levels = bankAccounts
                    .map(a => a.kycRiskScore)
                    .filter(Boolean)
                    .flatMap(rs => [rs.clientProspect?.riskLevel, rs.beneficialOwner?.riskLevel, rs.businessRelationship?.riskLevel])
                    .filter(Boolean);
                  const overallRisk = levels.includes('high') ? 'high'
                    : levels.includes('medium') ? 'medium'
                    : levels.length ? 'low' : null;
                  const riskDisplay = overallRisk ? getRiskLevelDisplay(overallRisk) : null;
                  const years = overallRisk ? REVIEW_YEARS_BY_RISK[overallRisk] : null;

                  // The newest of the typed date and the latest dated review
                  // file is the last review (same rule as the compliance dashboard).
                  const typedReview = kyc.lastReviewDate ? new Date(kyc.lastReviewDate) : null;
                  const { last: lastReview, next: nextDue } = resolveDueDate({
                    manualLast: typedReview,
                    manualNext: kyc.nextReviewDate ? new Date(kyc.nextReviewDate) : null,
                    fileLast: latestReviewFileDate,
                    compute: (last) => computeNextReviewDate(last, overallRisk)
                  });
                  const lastReviewFromFile = !!latestReviewFileDate && (!typedReview || latestReviewFileDate > typedReview);
                  const isOverdue = nextDue && nextDue < new Date();

                  return (
                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        🔁 Periodic Review
                        {riskDisplay && (
                          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: '600', fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: `color-mix(in srgb, ${riskDisplay.color} 10%, transparent)`, color: riskDisplay.color }}>
                            {riskDisplay.emoji} {riskDisplay.labelEn} · every {years} year{years > 1 ? 's' : ''}
                          </span>
                        )}
                        {!riskDisplay && (
                          <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: '500', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            no account assessed yet — assess the risk matrix to set the cadence
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '4px' }}>
                        <EntityField
                          label="Last Review Date"
                          editing={editingEntityKyc}
                          type="date"
                          value={toDateInputValue(kyc.lastReviewDate)}
                          display={lastReview
                            ? `${new Date(lastReview).toLocaleDateString()}${lastReviewFromFile ? ' (latest review file)' : ''}`
                            : ''}
                          onChange={v => setKyc({
                            lastReviewDate: v || null,
                            // Recomputed from the risk level in force at review time,
                            // so a later re-rating doesn't silently move a past due date.
                            nextReviewDate: v ? computeNextReviewDate(v, overallRisk) : null
                          })}
                        />
                        <div>
                          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
                            Next Review Due
                          </label>
                          <ReadOnlyField style={{ fontWeight: isOverdue ? '700' : '400', color: isOverdue ? 'var(--loss-color)' : 'var(--text-primary)' }}>
                            {nextDue ? nextDue.toLocaleDateString() : ''}
                            {isOverdue && ' (overdue)'}
                          </ReadOnlyField>
                          {lastReview && years && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {years} year{years > 1 ? 's' : ''} after the last review
                            </div>
                          )}
                        </div>
                      </div>

                      <SingleTypeDocumentManager
                        userId={entityId}
                        documentType={DOCUMENT_TYPES.PERIODIC_REVIEW}
                        title="📄 Review Files"
                        bordered={false}
                      />
                    </div>
                  );
                })()}

                {/* Visit reports — the yearly client visit. Same shape as the
                    periodic review, but the cadence is fixed at one year and
                    does not depend on the risk level. */}
                {(() => {
                  // The newest of the typed date and the latest dated visit
                  // report (finalized meeting reports are filed here too) is
                  // the last visit — same rule as the compliance dashboard.
                  const typedVisit = kyc.lastVisitDate ? new Date(kyc.lastVisitDate) : null;
                  const { last: lastVisit, next: nextDue } = resolveDueDate({
                    manualLast: typedVisit,
                    manualNext: kyc.nextVisitDate ? new Date(kyc.nextVisitDate) : null,
                    fileLast: latestVisitFileDate,
                    compute: computeNextVisitDate
                  });
                  const lastVisitFromFile = !!latestVisitFileDate && (!typedVisit || latestVisitFileDate > typedVisit);
                  const isOverdue = nextDue && nextDue < new Date();

                  return (
                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        🤝 Visit Reports
                        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: '500', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          one visit every {VISIT_INTERVAL_YEARS > 1 ? `${VISIT_INTERVAL_YEARS} years` : 'year'}
                        </span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '12px', marginBottom: '4px' }}>
                        <EntityField
                          label="Last Visit Date"
                          editing={editingEntityKyc}
                          type="date"
                          value={toDateInputValue(kyc.lastVisitDate)}
                          display={lastVisit
                            ? `${new Date(lastVisit).toLocaleDateString()}${lastVisitFromFile ? ' (latest visit report)' : ''}`
                            : ''}
                          onChange={v => setKyc({
                            lastVisitDate: v || null,
                            nextVisitDate: v ? computeNextVisitDate(v) : null
                          })}
                        />
                        <div>
                          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
                            Next Visit Due
                          </label>
                          <ReadOnlyField style={{ fontWeight: isOverdue ? '700' : '400', color: isOverdue ? 'var(--loss-color)' : 'var(--text-primary)' }}>
                            {nextDue ? nextDue.toLocaleDateString() : ''}
                            {isOverdue && ' (overdue)'}
                          </ReadOnlyField>
                          {lastVisit && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {VISIT_INTERVAL_YEARS} year{VISIT_INTERVAL_YEARS > 1 ? 's' : ''} after the last visit
                            </div>
                          )}
                        </div>
                      </div>

                      <SingleTypeDocumentManager
                        userId={entityId}
                        documentType={DOCUMENT_TYPES.VISIT_REPORT}
                        title="📄 Visit Report Files"
                        bordered={false}
                      />
                    </div>
                  );
                })()}

                {/* Signed portfolios — each portfolio (bank account) is signed by
                    the client once a year, on its own date. The last signature per
                    portfolio comes from the dated signed-portfolio files. */}
                {(() => {
                  const bankName = (bankId) => banks.find(b => b._id === bankId)?.name || '';
                  const portfolios = [...bankAccounts, ...beneficiaryAccounts]
                    .filter((a, i, all) => all.findIndex(x => x._id === a._id) === i);
                  const accountOptions = portfolios.map(a => ({
                    value: a._id,
                    label: [bankName(a.bankId), a.accountNumber, a.name && a.name !== a.accountNumber ? `(${a.name})` : '']
                      .filter(Boolean).join(' ')
                  }));
                  const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' };
                  const cell = { padding: '8px 10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.9rem', color: 'var(--text-primary)', textAlign: 'left' };

                  return (
                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        ✍️ Signed Portfolios
                        <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: '500', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          each portfolio signed every {SIGNED_PORTFOLIO_INTERVAL_YEARS > 1 ? `${SIGNED_PORTFOLIO_INTERVAL_YEARS} years` : 'year'}
                        </span>
                      </div>

                      {portfolios.length === 0 ? (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                          No portfolio yet — add a bank account in the Accounts tab.
                        </div>
                      ) : (
                        <div style={{ overflowX: 'auto', marginBottom: '4px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ ...cell, ...labelStyle, display: 'table-cell' }}>Portfolio</th>
                                <th style={{ ...cell, ...labelStyle, display: 'table-cell' }}>Last Signed</th>
                                <th style={{ ...cell, ...labelStyle, display: 'table-cell' }}>Next Signature Due</th>
                              </tr>
                            </thead>
                            <tbody>
                              {portfolios.map(account => {
                                const lastSigned = lastPortfolioSignatureByAccount[account._id] || null;
                                const nextDue = computeNextPortfolioSignatureDate(lastSigned);
                                const isOverdue = nextDue && nextDue < new Date();
                                return (
                                  <tr key={account._id}>
                                    <td style={cell}>{accountOptions.find(o => o.value === account._id)?.label || account.accountNumber}</td>
                                    <td style={cell}>{lastSigned ? lastSigned.toLocaleDateString() : <span style={{ color: 'var(--text-muted)' }}>Never signed</span>}</td>
                                    <td style={{ ...cell, fontWeight: isOverdue ? '700' : '400', color: isOverdue ? 'var(--loss-color)' : 'var(--text-primary)' }}>
                                      {nextDue ? nextDue.toLocaleDateString() : '-'}
                                      {isOverdue && ' (overdue)'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <SingleTypeDocumentManager
                        userId={entityId}
                        documentType={DOCUMENT_TYPES.SIGNED_PORTFOLIO}
                        title="📄 Signed Portfolio Files"
                        bordered={false}
                        accountOptions={accountOptions}
                      />
                    </div>
                  );
                })()}
              </LiquidGlassCard>
            );
          })()}

          {/* Family Members — entity mode */}
          {activeTab === 'familyMembers' && isEntityMode && entity && (() => {
            const members = editingFamily ? familyDraft : familyMembers;
            const updateMember = (idx, patch) => setFamilyDraft(familyDraft.map((m, i) => i === idx ? { ...m, ...patch } : m));
            const addManualMember = () => setFamilyDraft([...familyDraft, { mode: 'manual', firstName: '', lastName: '', relationship: 'partner', birthDate: '', birthPlace: '', address: '' }]);
            const addLinkedMember = () => {
              setFamilyDraft([...familyDraft, { mode: 'linked', linkedEntityId: null, linked: null, relationship: 'partner' }]);
              setFamilyPickerIdx(familyDraft.length);
              setFamilyPickerQuery('');
            };
            const removeMember = (idx) => {
              setFamilyDraft(familyDraft.filter((_, i) => i !== idx));
              if (familyPickerIdx === idx) setFamilyPickerIdx(null);
            };
            const pickPerson = (idx, person) => {
              const p = person.profile || {};
              updateMember(idx, {
                linkedEntityId: person._id,
                linked: { entityId: person._id, status: person.status || null, firstName: p.firstName || '', lastName: p.lastName || '', birthDate: p.birthday || '', birthPlace: p.birthPlace || '', address: '' }
              });
              setFamilyPickerIdx(null);
              setFamilyPickerQuery('');
            };
            const startEditing = () => {
              setFamilyDraft(familyMembers.map(m => ({ ...m, mode: m.linkedEntityId ? 'linked' : 'manual' })));
              setFamilySaveError(null);
              setFamilyPickerIdx(null);
              setEditingFamily(true);
            };
            const saveFamily = async () => {
              const incomplete = familyDraft.some(m => m.mode === 'linked' && !m.linkedEntityId);
              if (incomplete) {
                setFamilySaveError('Select a person for each linked member, or remove it.');
                return;
              }
              setFamilySaving(true);
              setFamilySaveError(null);
              try {
                const payload = familyDraft.map(m => (m.mode === 'linked'
                  ? { linkedEntityId: m.linkedEntityId, relationship: m.relationship || 'other' }
                  : {
                      firstName: (m.firstName || '').trim(),
                      lastName: (m.lastName || '').trim(),
                      relationship: m.relationship || 'other',
                      birthDate: m.birthDate ? String(m.birthDate).slice(0, 10) : '',
                      birthPlace: (m.birthPlace || '').trim(),
                      address: (m.address || '').trim()
                    }));
                await Meteor.callAsync('clientEntities.updateFamilyMembers', entityId, payload, sessionId);
                setEditingFamily(false);
                setFamilyReloadKey(k => k + 1);
              } catch (err) {
                console.error('Error updating family members:', err);
                setFamilySaveError(err.reason || err.message || 'Could not save family members');
              } finally {
                setFamilySaving(false);
              }
            };
            const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.88rem', boxSizing: 'border-box' };
            const fieldLabel = { display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' };
            const addButtonStyle = { flex: 1, padding: '10px 16px', background: 'var(--bg-secondary)', border: '1px dashed var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' };
            const linkedBadge = <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', background: 'var(--accent-color)', color: 'white', fontSize: '0.7rem', fontWeight: '600' }}>🔗 Linked contact</span>;
            const formatBirth = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '');
            // Linked members show the linked person's live details; manual ones what was typed
            const shown = (m) => {
              if (m.linked) return m.linked;
              const [fallbackFirst, ...fallbackRest] = (m.name || '').split(' ');
              return {
                firstName: m.firstName ?? (m.lastName ? '' : fallbackFirst),
                lastName: m.lastName ?? (m.firstName ? '' : fallbackRest.join(' ')),
                birthDate: m.birthDate,
                birthPlace: m.birthPlace,
                address: m.address
              };
            };
            const readOnlyDetails = (m) => {
              const d = shown(m);
              return (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px' }}>
                  <div><label style={fieldLabel}>First Name</label><ReadOnlyField size="sm">{d.firstName}</ReadOnlyField></div>
                  <div><label style={fieldLabel}>Surname</label><ReadOnlyField size="sm">{d.lastName}</ReadOnlyField></div>
                  <div><label style={fieldLabel}>Relationship</label><ReadOnlyField size="sm">{FAMILY_RELATIONSHIP_LABELS[m.relationship] || m.relationship}</ReadOnlyField></div>
                  <div><label style={fieldLabel}>Date of Birth</label><ReadOnlyField size="sm">{formatBirth(d.birthDate)}</ReadOnlyField></div>
                  <div><label style={fieldLabel}>Place of Birth</label><ReadOnlyField size="sm">{d.birthPlace}</ReadOnlyField></div>
                  <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}><label style={fieldLabel}>Address</label><ReadOnlyField size="sm">{d.address}</ReadOnlyField></div>
                </div>
              );
            };
            return (
              <LiquidGlassCard borderRadius="12px" style={{ padding: isMobile ? '1.5rem' : '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '2px solid var(--border-color)', paddingBottom: '1rem' }}>
                  <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.5rem' }}>👨‍👩‍👧</span> Family Members
                  </h2>
                  {!editingFamily ? (
                    <button onClick={startEditing} disabled={!!familyLoadError} style={{ padding: '8px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: familyLoadError ? 'not-allowed' : 'pointer', opacity: familyLoadError ? 0.5 : 1, fontSize: '0.85rem', fontWeight: '600' }}>Edit</button>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={saveFamily} disabled={familySaving} style={{ padding: '8px 16px', background: 'var(--gain-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: familySaving ? 'wait' : 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>{familySaving ? 'Saving…' : 'Save'}</button>
                      <button onClick={() => { setEditingFamily(false); setFamilySaveError(null); setFamilyPickerIdx(null); }} disabled={familySaving} style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
                    </div>
                  )}
                </div>

                {familyLoadError && (
                  <div style={{ color: 'var(--loss-color)', fontSize: '0.85rem', marginBottom: '12px' }}>Could not load family members: {familyLoadError}</div>
                )}
                {familySaveError && (
                  <div style={{ color: 'var(--loss-color)', fontSize: '0.85rem', marginBottom: '12px' }}>{familySaveError}</div>
                )}

                {members.length === 0 && !editingFamily && !familyLoadError && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '12px 0' }}>No family members recorded.</div>
                )}

                {!editingFamily && members.map((m, idx) => (
                  <div key={idx} style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                    <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)' }}>Member #{idx + 1}</span>
                      {m.linked && linkedBadge}
                    </div>
                    {readOnlyDetails(m)}
                  </div>
                ))}

                {editingFamily && (
                  <div>
                    {familyDraft.map((m, idx) => (
                      <div key={idx} style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '14px', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
                            Member #{idx + 1}{m.mode === 'linked' && linkedBadge}
                          </span>
                          <button onClick={() => removeMember(idx)} style={{ padding: '4px 10px', background: 'var(--loss-color)', border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer', fontSize: '0.75rem' }}>Remove</button>
                        </div>

                        {m.mode === 'linked' ? (
                          <div>
                            {(!m.linkedEntityId || familyPickerIdx === idx) ? (
                              <div style={{ position: 'relative', marginBottom: '10px' }}>
                                <label style={fieldLabel}>Search a person known to the system</label>
                                <input
                                  autoFocus
                                  value={familyPickerIdx === idx ? familyPickerQuery : ''}
                                  onFocus={() => setFamilyPickerIdx(idx)}
                                  onChange={e => { setFamilyPickerIdx(idx); setFamilyPickerQuery(e.target.value); }}
                                  placeholder="Type at least 2 letters of the name…"
                                  style={inputStyle}
                                />
                                {familyPickerIdx === idx && familyPickerQuery.trim().length >= 2 && (
                                  <div style={{ marginTop: '4px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', maxHeight: '240px', overflowY: 'auto' }}>
                                    {familyCandidates.length === 0 ? (
                                      <div style={{ padding: '8px 10px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>No matching person — use “Add manually” instead.</div>
                                    ) : familyCandidates.map(person => (
                                      <div
                                        key={person._id}
                                        onClick={() => pickPerson(idx, person)}
                                        style={{ padding: '8px 10px', cursor: 'pointer', fontSize: '0.88rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '8px' }}
                                      >
                                        <span>{ClientEntityHelpers.getEntityDisplayName(person)}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                                          {[person.profile?.birthday ? formatBirth(person.profile.birthday) : null, person.status].filter(Boolean).join(' · ')}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ marginBottom: '10px' }}>
                                <button onClick={() => { setFamilyPickerIdx(idx); setFamilyPickerQuery(''); }} style={{ padding: '4px 10px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.75rem' }}>Change person</button>
                              </div>
                            )}
                            {m.linkedEntityId && (
                              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px' }}>
                                <div><label style={fieldLabel}>Name</label><ReadOnlyField size="sm">{`${m.linked?.firstName || m.firstName || ''} ${m.linked?.lastName || m.lastName || ''}`.trim()}</ReadOnlyField></div>
                                <div>
                                  <label style={fieldLabel}>Relationship</label>
                                  <select value={m.relationship || 'other'} onChange={e => updateMember(idx, { relationship: e.target.value })} style={{ ...inputStyle, cursor: 'pointer' }}>
                                    {FAMILY_RELATIONSHIP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                  </select>
                                </div>
                                <div style={{ gridColumn: isMobile ? '1' : '1 / -1', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                  Date of birth, place of birth and address are taken from this person's own client file.
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '10px' }}>
                            <div><label style={fieldLabel}>First Name</label><input value={m.firstName || ''} onChange={e => updateMember(idx, { firstName: e.target.value })} style={inputStyle} /></div>
                            <div><label style={fieldLabel}>Surname</label><input value={m.lastName || ''} onChange={e => updateMember(idx, { lastName: e.target.value })} style={inputStyle} /></div>
                            <div>
                              <label style={fieldLabel}>Relationship</label>
                              <select value={m.relationship || 'other'} onChange={e => updateMember(idx, { relationship: e.target.value })} style={{ ...inputStyle, cursor: 'pointer' }}>
                                {FAMILY_RELATIONSHIP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                            <div><label style={fieldLabel}>Date of Birth</label><input type="date" value={m.birthDate ? String(m.birthDate).slice(0, 10) : ''} onChange={e => updateMember(idx, { birthDate: e.target.value })} style={inputStyle} /></div>
                            <div><label style={fieldLabel}>Place of Birth</label><input value={m.birthPlace || ''} onChange={e => updateMember(idx, { birthPlace: e.target.value })} style={inputStyle} /></div>
                            <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}><label style={fieldLabel}>Address</label><input value={m.address || ''} onChange={e => updateMember(idx, { address: e.target.value })} style={inputStyle} /></div>
                          </div>
                        )}
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: '10px', flexDirection: isMobile ? 'column' : 'row' }}>
                      <button onClick={addLinkedMember} style={addButtonStyle}>🔗 Link an existing person</button>
                      <button onClick={addManualMember} style={addButtonStyle}>➕ Add manually</button>
                    </div>
                  </div>
                )}
              </LiquidGlassCard>
            );
          })()}

          {/* US Person — entity mode */}
          {activeTab === 'usPerson' && isEntityMode && entity && (() => {
            const us = editingUsPerson ? usPersonDraft : (entity.usPerson || {});
            const setUs = (patch) => setUsPersonDraft({ ...usPersonDraft, ...patch });
            return (
              <LiquidGlassCard borderRadius="12px" style={{ padding: isMobile ? '1.5rem' : '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '2px solid var(--border-color)', paddingBottom: '1rem' }}>
                  <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.5rem' }}>🇺🇸</span> US Person
                  </h2>
                  {!editingUsPerson ? (
                    <button onClick={() => { setUsPersonDraft({ ...(entity.usPerson || {}) }); setEditingUsPerson(true); }} style={{ padding: '8px 16px', background: 'var(--accent-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Edit</button>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={async () => {
                        try {
                          await Meteor.callAsync('clientEntities.update', entityId, { usPerson: usPersonDraft }, sessionId);
                          setEditingUsPerson(false);
                        } catch (err) {
                          console.error('Error updating US Person status:', err);
                        }
                      }} style={{ padding: '8px 16px', background: 'var(--gain-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>Save</button>
                      <button onClick={() => setEditingUsPerson(false)} style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
                    </div>
                  )}
                </div>

                <YesNoField
                  label="US Person"
                  editing={editingUsPerson}
                  value={us.isUsPerson ?? null}
                  onChange={v => setUs({ isUsPerson: v })}
                />
                <YesNoField
                  label="American Citizenship"
                  sublabel="Including dual or multiple nationalities"
                  editing={editingUsPerson}
                  value={us.usCitizenship ?? null}
                  onChange={v => setUs({ usCitizenship: v })}
                />
                <YesNoField
                  label="Permanent Residence in the USA"
                  sublabel="Green Card, positive Substantial Presence Test"
                  editing={editingUsPerson}
                  value={us.usPermanentResidence ?? null}
                  onChange={v => setUs({ usPermanentResidence: v })}
                />
                <YesNoField
                  label="Place of Birth in the USA"
                  sublabel="Unless Certificate of Loss of Nationality, …"
                  editing={editingUsPerson}
                  value={us.usBirthPlace ?? null}
                  onChange={v => setUs({ usBirthPlace: v })}
                />
                <YesNoField
                  label="Address in the USA"
                  sublabel="Secondary residence, …"
                  editing={editingUsPerson}
                  value={us.usAddress ?? null}
                  onChange={v => setUs({ usAddress: v })}
                />
                <YesNoField
                  label="Taxable in the USA for Another Reason"
                  sublabel="Dual residence, joint filing with a US Person spouse, long-term stay, …"
                  editing={editingUsPerson}
                  value={us.usOtherTaxReason ?? null}
                  onChange={v => setUs({ usOtherTaxReason: v })}
                />
              </LiquidGlassCard>
            );
          })()}

          {/* KYC - kyc tab (when viewing a client profile) */}
          {activeTab === 'kyc' && hasUser && user.role === USER_ROLES.CLIENT && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span>✅</span> KYC Status
                </h2>
              </div>

              {/* KYC Status Overview */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                marginBottom: '24px'
              }}>
                {/* Identity Verification */}
                <div style={{
                  padding: '16px',
                  background: user.profile?.kyc?.identityVerified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  border: `1px solid ${user.profile?.kyc?.identityVerified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  borderRadius: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.25rem' }}>{user.profile?.kyc?.identityVerified ? '✅' : '⏳'}</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Identity</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {user.profile?.kyc?.identityVerified ? 'Verified' : 'Pending verification'}
                  </div>
                  {user.profile?.kyc?.identityVerifiedDate && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {new Date(user.profile.kyc.identityVerifiedDate).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {/* Address Verification */}
                <div style={{
                  padding: '16px',
                  background: user.profile?.kyc?.addressVerified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  border: `1px solid ${user.profile?.kyc?.addressVerified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  borderRadius: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.25rem' }}>{user.profile?.kyc?.addressVerified ? '✅' : '⏳'}</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Address</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {user.profile?.kyc?.addressVerified ? 'Verified' : 'Pending verification'}
                  </div>
                  {user.profile?.kyc?.addressVerifiedDate && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {new Date(user.profile.kyc.addressVerifiedDate).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {/* Source of Funds */}
                <div style={{
                  padding: '16px',
                  background: user.profile?.kyc?.sourceOfFundsVerified ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                  border: `1px solid ${user.profile?.kyc?.sourceOfFundsVerified ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  borderRadius: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.25rem' }}>{user.profile?.kyc?.sourceOfFundsVerified ? '✅' : '⏳'}</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Source of Funds</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {user.profile?.kyc?.sourceOfFundsVerified ? 'Verified' : 'Pending verification'}
                  </div>
                  {user.profile?.kyc?.sourceOfFundsVerifiedDate && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {new Date(user.profile.kyc.sourceOfFundsVerifiedDate).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {/* Risk Assessment */}
                <div style={{
                  padding: '16px',
                  background: user.profile?.kyc?.riskLevel
                    ? (user.profile.kyc.riskLevel === 'low' ? 'rgba(16, 185, 129, 0.1)'
                       : user.profile.kyc.riskLevel === 'medium' ? 'rgba(245, 158, 11, 0.1)'
                       : 'rgba(239, 68, 68, 0.1)')
                    : 'rgba(107, 114, 128, 0.1)',
                  border: `1px solid ${user.profile?.kyc?.riskLevel
                    ? (user.profile.kyc.riskLevel === 'low' ? 'rgba(16, 185, 129, 0.3)'
                       : user.profile.kyc.riskLevel === 'medium' ? 'rgba(245, 158, 11, 0.3)'
                       : 'rgba(239, 68, 68, 0.3)')
                    : 'rgba(107, 114, 128, 0.3)'}`,
                  borderRadius: '12px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.25rem' }}>
                      {user.profile?.kyc?.riskLevel === 'low' ? '🟢'
                       : user.profile?.kyc?.riskLevel === 'medium' ? '🟡'
                       : user.profile?.kyc?.riskLevel === 'high' ? '🔴'
                       : '⚪'}
                    </span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary)' }}>Risk Level</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                    {user.profile?.kyc?.riskLevel || 'Not assessed'}
                  </div>
                </div>
              </div>

              {/* KYC Details */}
              <div style={{
                padding: '16px',
                background: 'var(--bg-secondary)',
                borderRadius: '12px',
                border: '1px solid var(--border-color)'
              }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                  Additional Information
                </h3>

                <div style={{ display: 'grid', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Nationality</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      {user.profile?.kyc?.nationality || '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Tax Residence</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      {user.profile?.kyc?.taxResidence || '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>PEP Status</span>
                    <span style={{
                      color: user.profile?.kyc?.isPEP ? 'var(--warning-color)' : 'var(--text-primary)',
                      fontWeight: '500'
                    }}>
                      {user.profile?.kyc?.isPEP ? 'Yes - Politically Exposed Person' : 'No'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Last Review</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      {user.profile?.kyc?.lastReviewDate
                        ? new Date(user.profile.kyc.lastReviewDate).toLocaleDateString()
                        : '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Next Review Due</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>
                      {user.profile?.kyc?.nextReviewDate
                        ? new Date(user.profile.kyc.nextReviewDate).toLocaleDateString()
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {user.profile?.kyc?.notes && (
                <div style={{
                  marginTop: '16px',
                  padding: '16px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-color)'
                }}>
                  <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                    Notes
                  </h3>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>
                    {user.profile.kyc.notes}
                  </p>
                </div>
              )}

              <KycDocumentManager userId={userId} />
            </LiquidGlassCard>
          )}


          {/* Family Members - family tab (when viewing a client profile) */}
          {activeTab === 'family' && hasUser && user.role === USER_ROLES.CLIENT && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span style={{ fontSize: '24px' }}>👨‍👩‍👧‍👦</span>
                  Family Members
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '12px',
                    background: isDarkMode ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                    color: '#8b5cf6',
                    fontSize: '14px',
                    fontWeight: '600'
                  }}>
                    {user.profile?.familyMembers?.length || 0}
                  </span>
                </h2>
                <button
                  onClick={() => setShowAddFamilyMember(true)}
                  style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 8px rgba(139, 92, 246, 0.3)'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  + Add Member
                </button>
              </div>

              {showAddFamilyMember && (
                <div style={{
                  marginBottom: '24px',
                  padding: '20px',
                  background: isDarkMode ? 'rgba(139, 92, 246, 0.05)' : 'rgba(139, 92, 246, 0.03)',
                  borderRadius: '12px',
                  border: `2px solid ${isDarkMode ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.15)'}`,
                  animation: 'slideUp 0.3s ease-out'
                }}>
                  <h3 style={{
                    margin: '0 0 16px',
                    color: 'var(--text-primary)',
                    fontSize: '16px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{ fontSize: '20px' }}>➕</span>
                    New Family Member
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: isDarkMode ? '#e5e7eb' : '#374151',
                        fontSize: '13px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Name *
                      </label>
                      <input
                        type="text"
                        value={newFamilyMember.name}
                        onChange={(e) => setNewFamilyMember({ ...newFamilyMember, name: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          fontSize: '15px',
                          outline: 'none'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: isDarkMode ? '#e5e7eb' : '#374151',
                        fontSize: '13px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Relationship
                      </label>
                      <select
                        value={newFamilyMember.relationship}
                        onChange={(e) => setNewFamilyMember({ ...newFamilyMember, relationship: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          fontSize: '15px',
                          outline: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        <option value="spouse">💑 Spouse</option>
                        <option value="child">👶 Child</option>
                        <option value="parent">👴 Parent</option>
                        <option value="sibling">👫 Sibling</option>
                      </select>
                    </div>

                    <div>
                      <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        color: isDarkMode ? '#e5e7eb' : '#374151',
                        fontSize: '13px',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        Date of Birth
                      </label>
                      <input
                        type="date"
                        value={newFamilyMember.birthday}
                        onChange={(e) => setNewFamilyMember({ ...newFamilyMember, birthday: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          fontSize: '15px',
                          outline: 'none'
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                    <button
                      onClick={() => {
                        setShowAddFamilyMember(false);
                        setNewFamilyMember({ name: '', relationship: 'spouse', birthday: '' });
                      }}
                      style={{
                        padding: '10px 20px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddFamilyMember}
                      style={{
                        padding: '10px 20px',
                        background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                        boxShadow: '0 4px 8px rgba(139, 92, 246, 0.3)'
                      }}
                    >
                      ✓ Add Member
                    </button>
                  </div>
                </div>
              )}

              {(!user.profile?.familyMembers || user.profile.familyMembers.length === 0) && !showAddFamilyMember ? (
                <div style={{
                  padding: '48px 24px',
                  textAlign: 'center',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '12px',
                  border: '2px dashed var(--border-color)'
                }}>
                  <div style={{ fontSize: '64px', marginBottom: '16px', opacity: 0.5 }}>👨‍👩‍👧‍👦</div>
                  <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '16px', fontWeight: '500' }}>
                    No family members added
                  </p>
                  <p style={{ margin: '0 0 20px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Add family members to keep track of important information
                  </p>
                  <button
                    onClick={() => setShowAddFamilyMember(true)}
                    style={{
                      padding: '10px 24px',
                      background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    + Add Your First Family Member
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                  {(user.profile?.familyMembers || []).map(member => {
                    const memberInitials = member.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
                    const age = calculateAge(member.birthday);
                    const relationshipEmoji = {
                      spouse: '💑',
                      child: '👶',
                      parent: '👴',
                      sibling: '👫'
                    }[member.relationship] || '👤';

                    return (
                      <div
                        key={member._id}
                        style={{
                          padding: '20px',
                          background: isDarkMode
                            ? 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)'
                            : 'linear-gradient(135deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.01) 100%)',
                          borderRadius: '12px',
                          border: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                          transition: 'all 0.3s ease',
                          position: 'relative'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = 'translateY(-4px)';
                          e.currentTarget.style.boxShadow = `0 12px 20px ${isDarkMode ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.1)'}`;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <button
                          onClick={() => handleDeleteFamilyMember(member._id)}
                          style={{
                            position: 'absolute',
                            top: '12px',
                            right: '12px',
                            padding: '6px 10px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '6px',
                            color: 'var(--loss-color)',
                            cursor: 'pointer',
                            fontSize: '12px',
                            fontWeight: '600',
                            transition: 'all 0.3s ease'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                        >
                          🗑️
                        </button>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                          <div style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '50%',
                            background: getAvatarGradient(member.name),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '20px',
                            fontWeight: '700',
                            color: '#fff',
                            boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
                          }}>
                            {memberInitials}
                          </div>
                          <div style={{ flex: 1 }}>
                            <p style={{
                              margin: '0 0 4px',
                              color: 'var(--text-primary)',
                              fontSize: '16px',
                              fontWeight: '600'
                            }}>
                              {member.name}
                            </p>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}>
                              <span style={{
                                padding: '3px 10px',
                                borderRadius: '8px',
                                background: isDarkMode ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                                color: '#8b5cf6',
                                fontSize: '12px',
                                fontWeight: '600',
                                textTransform: 'capitalize'
                              }}>
                                {relationshipEmoji} {member.relationship}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div style={{
                          padding: '12px',
                          background: 'var(--bg-tertiary)',
                          borderRadius: '8px',
                          fontSize: '13px',
                          color: 'var(--text-secondary)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>🎂</span>
                            {member.birthday ? (
                              <>
                                {new Date(member.birthday).toLocaleDateString()}
                                {age && (
                                  <span style={{
                                    marginLeft: '8px',
                                    padding: '2px 8px',
                                    borderRadius: '6px',
                                    background: isDarkMode ? 'rgba(79, 166, 255, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                    color: 'var(--accent-color)',
                                    fontSize: '12px',
                                    fontWeight: '600'
                                  }}>
                                    {age} years
                                  </span>
                                )}
                              </>
                            ) : (
                              <span>Date of birth not set</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* Password Reset (ADMIN and SUPERADMIN - but ADMINs cannot reset SUPERADMIN passwords) - password tab */}
          {activeTab === 'password' && (currentUser?.role === USER_ROLES.SUPERADMIN ||
            (currentUser?.role === USER_ROLES.ADMIN && user?.role !== USER_ROLES.SUPERADMIN)) && (
            <LiquidGlassCard style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '20px',
                  fontWeight: '600',
                  color: isDarkMode ? '#fff' : '#000',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}>
                  <span style={{ fontSize: '24px' }}>🔒</span>
                  Password Reset
                </h2>
                {!editingPassword && (
                  <button
                    onClick={() => setEditingPassword(true)}
                    style={{
                      padding: '8px 16px',
                      background: 'linear-gradient(135deg, var(--loss-color) 0%, #dc2626 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: '500',
                      transition: 'all 0.3s ease',
                      boxShadow: '0 4px 8px rgba(239, 68, 68, 0.3)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    🔑 Reset Password
                  </button>
                )}
              </div>

              {editingPassword ? (
                <div>
                  {/* Warning Alert */}
                  <div style={{
                    padding: '16px',
                    marginBottom: '20px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: '10px',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'flex-start'
                  }}>
                    <span style={{ fontSize: '24px', flexShrink: 0 }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                      <p style={{
                        margin: '0 0 6px',
                        color: 'var(--warning-color)',
                        fontSize: '14px',
                        fontWeight: '600'
                      }}>
                        Security Warning
                      </p>
                      <p style={{
                        margin: 0,
                        color: 'var(--warning-color)',
                        fontSize: '13px',
                        lineHeight: 1.5
                      }}>
                        The user will be logged out of all active sessions and must use the new password to log in again.
                      </p>
                    </div>
                  </div>

                  <div style={{ marginBottom: '16px' }}>
                    <label style={{
                      display: 'block',
                      marginBottom: '8px',
                      color: isDarkMode ? '#e5e7eb' : '#374151',
                      fontSize: '13px',
                      fontWeight: '600',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      New Password (min 6 characters)
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={formData.newPassword}
                        onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px 44px 12px 12px',
                          background: 'var(--bg-secondary)',
                          border: '2px solid var(--border-color)',
                          borderRadius: '8px',
                          color: 'var(--text-primary)',
                          fontSize: '15px',
                          outline: 'none'
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: 'absolute',
                          right: '8px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          padding: '6px',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '20px',
                          opacity: 0.6
                        }}
                      >
                        {showPassword ? '🙈' : '👁️'}
                      </button>
                    </div>

                    {/* Password Strength Indicator */}
                    {formData.newPassword && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            Password Strength:
                          </span>
                          <span style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: getPasswordStrength(formData.newPassword).color
                          }}>
                            {getPasswordStrength(formData.newPassword).label}
                          </span>
                        </div>
                        <div style={{
                          height: '6px',
                          background: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                          borderRadius: '3px',
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${(getPasswordStrength(formData.newPassword).strength / 5) * 100}%`,
                            background: getPasswordStrength(formData.newPassword).color,
                            transition: 'all 0.3s ease'
                          }} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => {
                        setEditingPassword(false);
                        setFormData({ ...formData, newPassword: '' });
                        setShowPassword(false);
                      }}
                      style={{
                        padding: '12px 24px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                        transition: 'all 0.3s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleResetPassword}
                      style={{
                        padding: '12px 24px',
                        background: 'linear-gradient(135deg, var(--loss-color) 0%, #dc2626 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: '#fff',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: '500',
                        transition: 'all 0.3s ease',
                        boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                      onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                    >
                      🔒 Reset Password
                    </button>
                  </div>
                </div>
              ) : passwordResetSuccess ? (
                <div style={{
                  padding: '24px',
                  textAlign: 'center',
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%)',
                  borderRadius: '10px',
                  border: '1px solid rgba(16, 185, 129, 0.3)'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
                  <p style={{ margin: 0, color: 'var(--gain-color)', fontSize: '16px', fontWeight: '600' }}>
                    Password Reset Successfully!
                  </p>
                  <p style={{ margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
                    The user has been logged out of all sessions and must use the new password to log in.
                  </p>
                </div>
              ) : (
                <div style={{
                  padding: '24px',
                  textAlign: 'center',
                  background: 'var(--bg-tertiary)',
                  borderRadius: '10px'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px', opacity: 0.5 }}>🔐</div>
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>
                    Click "Reset Password" to change this user's password
                  </p>
                </div>
              )}
            </LiquidGlassCard>
          )}

          {/* User Access Management - only shown for entity views */}
          {activeTab === 'access' && entityId && (() => {
            // Inline access management component
            const AccessManager = () => {
              const [accessUsers, setAccessUsers] = React.useState([]);
              const [allUsers, setAllUsers] = React.useState([]);
              const [loadingAccess, setLoadingAccess] = React.useState(true);
              const [addingUserId, setAddingUserId] = React.useState('');
              const [addingLevel, setAddingLevel] = React.useState('full');

              React.useEffect(() => {
                // Fetch access records and all users for this entity
                const loadAccess = async () => {
                  try {
                    const accessRecords = UserEntityAccessCollection.find({ entityId, isActive: true }).fetch();
                    setAccessUsers(accessRecords);

                    // Get all staff users for the add dropdown
                    const users = UsersCollection.find({
                      isActive: { $ne: false }
                    }).fetch();
                    setAllUsers(users);
                  } catch (e) {
                    console.error('Error loading access:', e);
                  }
                  setLoadingAccess(false);
                };
                loadAccess();
              }, []);

              const handleGrant = () => {
                if (!addingUserId) return;
                Meteor.call('userEntityAccess.grant', addingUserId, entityId, addingLevel, sessionId, (err) => {
                  if (err) {
                    alert('Error granting access: ' + (err.reason || err.message));
                  } else {
                    setAccessUsers(UserEntityAccessCollection.find({ entityId, isActive: true }).fetch());
                    setAddingUserId('');
                  }
                });
              };

              const handleRevoke = async (targetUserId) => {
                const confirmed = await showConfirm('Revoke this user\'s access?');
                if (!confirmed) return;
                Meteor.call('userEntityAccess.revoke', targetUserId, entityId, sessionId, (err) => {
                  if (err) {
                    alert('Error revoking access: ' + (err.reason || err.message));
                  } else {
                    setAccessUsers(UserEntityAccessCollection.find({ entityId, isActive: true }).fetch());
                  }
                });
              };

              const entity = ClientEntitiesCollection.findOne(entityId);
              const entityName = entity ? ClientEntityHelpers.getEntityDisplayName(entity) : 'Entity';

              // Users who already have access
              const accessUserIds = accessUsers.map(a => a.userId);
              // Available users to add (not already having access)
              const availableUsers = allUsers.filter(u => !accessUserIds.includes(u._id));

              return (
                <LiquidGlassCard style={{ padding: '24px' }}>
                  <h2 style={{
                    margin: '0 0 16px 0',
                    fontSize: '20px',
                    fontWeight: '600',
                    color: isDarkMode ? '#fff' : '#000',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}>
                    <span style={{ fontSize: '24px' }}>{'\ud83d\udd11'}</span>
                    User Access — {entityName}
                  </h2>
                  <p style={{ margin: '0 0 20px 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Manage which user accounts can view this client entity's data (holdings, orders, documents).
                  </p>

                  {/* Current access list */}
                  {loadingAccess ? (
                    <p style={{ color: 'var(--text-secondary)' }}>Loading access records...</p>
                  ) : accessUsers.length === 0 ? (
                    <div style={{
                      padding: '20px',
                      textAlign: 'center',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '8px',
                      marginBottom: '16px'
                    }}>
                      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>No user accounts have access to this entity yet.</p>
                    </div>
                  ) : (
                    <div style={{ marginBottom: '20px' }}>
                      {accessUsers.map(access => {
                        const accessUser = allUsers.find(u => u._id === access.userId);
                        const name = accessUser
                          ? `${accessUser.profile?.firstName || accessUser.firstName || ''} ${accessUser.profile?.lastName || accessUser.lastName || ''}`.trim() || accessUser.email
                          : access.userId;

                        return (
                          <div key={access._id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 16px',
                            background: 'var(--bg-secondary)',
                            borderRadius: '8px',
                            marginBottom: '8px',
                            border: '1px solid var(--border-color)'
                          }}>
                            <div>
                              <div style={{ fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.95rem' }}>{name}</div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                {accessUser?.email} — {access.accessLevel} access
                              </div>
                            </div>
                            <button
                              onClick={() => handleRevoke(access.userId)}
                              style={{
                                padding: '6px 12px',
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: 'var(--loss-color)',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontWeight: '500'
                              }}
                            >
                              Revoke
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add access form */}
                  {(currentUser?.role === USER_ROLES.SUPERADMIN || currentUser?.role === USER_ROLES.ADMIN) && (
                    <div style={{
                      padding: '16px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)'
                    }}>
                      <h4 style={{ margin: '0 0 12px 0', color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                        Grant Access
                      </h4>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          value={addingUserId}
                          onChange={(e) => setAddingUserId(e.target.value)}
                          style={{
                            flex: 1,
                            minWidth: '200px',
                            padding: '8px 12px',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem'
                          }}
                        >
                          <option value="">Select user...</option>
                          {availableUsers.map(u => (
                            <option key={u._id} value={u._id}>
                              {`${u.profile?.firstName || u.firstName || ''} ${u.profile?.lastName || u.lastName || ''}`.trim() || u.email} ({u.role})
                            </option>
                          ))}
                        </select>
                        <select
                          value={addingLevel}
                          onChange={(e) => setAddingLevel(e.target.value)}
                          style={{
                            padding: '8px 12px',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem'
                          }}
                        >
                          <option value="full">Full Access</option>
                          <option value="readonly">Read Only</option>
                        </select>
                        <button
                          onClick={handleGrant}
                          disabled={!addingUserId}
                          style={{
                            padding: '8px 16px',
                            background: addingUserId ? 'var(--accent-color)' : 'var(--text-muted)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: addingUserId ? 'pointer' : 'not-allowed',
                            fontSize: '0.9rem',
                            fontWeight: '600'
                          }}
                        >
                          Grant
                        </button>
                      </div>
                    </div>
                  )}
                </LiquidGlassCard>
              );
            };

            return <AccessManager />;
          })()}
        </div>
      </div>

      {/* Risk Score Assessment Modal — always scoped to one bank account */}
      {riskScoreModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 10000, overflowY: 'auto', padding: '40px 0' }}
          onClick={closeRiskScoreModal}>
          <div style={{ background: 'var(--bg-primary)', borderRadius: '12px', padding: '24px', maxWidth: '900px', width: '95%', margin: 'auto', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {viewingVersion ? 'KYC Risk Assessment' : (riskScoreAccount?.kycRiskScore ? 'New KYC Risk Assessment' : 'KYC Risk Assessment')}
                  {viewingVersion && (
                    <span style={{ fontSize: '0.7rem', fontWeight: '600', padding: '2px 8px', borderRadius: '10px', background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                      {viewingVersion.versionLabel} · superseded · read-only
                    </span>
                  )}
                </h3>
                {/* The assessment covers this banking relationship only */}
                {riskScoreAccount && (
                  <div style={{ marginTop: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {(banks.find(b => b._id === riskScoreAccount.bankId)?.name) || 'Bank'} · {riskScoreAccount.accountNumber}
                    {riskScoreAccount.name ? ` · ${riskScoreAccount.name}` : ''}
                  </div>
                )}
              </div>
              <button onClick={closeRiskScoreModal}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '20px', cursor: 'pointer', padding: '4px' }}>✕</button>
            </div>

            {riskScoreError && (
              <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'color-mix(in srgb, var(--loss-color) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--loss-color) 30%, transparent)', borderRadius: '8px', color: 'var(--loss-color)', fontSize: '0.82rem' }}>
                {riskScoreError}
              </div>
            )}

            {viewingVersion ? (
              <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <span>
                  Recorded {viewingVersion.assessmentDate ? new Date(viewingVersion.assessmentDate).toLocaleDateString() : 'on an unknown date'}
                  {viewingVersion.nextReviewDate ? ` · review was due ${new Date(viewingVersion.nextReviewDate).toLocaleDateString()}` : ''}
                  . This version has been superseded and cannot be changed.
                </span>
                <button
                  onClick={() => exportRiskScorePdf(viewingVersion, riskScoreAccount, `${riskScoreAccountId}:${viewingVersion.versionLabel}`)}
                  disabled={!!pdfBusyKey}
                  style={{ padding: '5px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: pdfBusyKey ? 'wait' : 'pointer', fontSize: '0.78rem', fontWeight: '600', flexShrink: 0 }}>
                  {pdfBusyKey ? '⏳ Generating…' : '📄 Export PDF'}
                </button>
              </div>
            ) : riskScoreAccount?.kycRiskScore ? (
              // Seeded from the current assessment because a periodic review
              // usually revisits the same answers; clear it for a fresh scoring.
              <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <span>Pre-filled from the current assessment{riskScoreAccount.kycRiskScore.assessmentDate ? ` of ${new Date(riskScoreAccount.kycRiskScore.assessmentDate).toLocaleDateString()}` : ''}.</span>
                <button
                  onClick={() => { setRiskScoreForm(EMPTY_RISK_SCORE_FORM); setRiskScoreError(null); }}
                  style={{ padding: '5px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '6px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600', flexShrink: 0 }}>
                  Start blank
                </button>
              </div>
            ) : null}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', width: '40%' }}>Criteria</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--info-color)', fontWeight: '600' }}>Client</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: '#8b5cf6', fontWeight: '600' }}>Benef. Owner</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--warning-color)', fontWeight: '600' }}>Business Rel.</th>
                  </tr>
                </thead>
                <tbody>
                  {RISK_CRITERIA.map((criterion, idx) => (
                    <tr key={criterion.id} style={{ borderBottom: '1px solid var(--border-color)', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                      <td style={{ padding: '6px 10px', color: 'var(--text-primary)', fontSize: '0.76rem' }}>
                        <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>{idx + 1}.</span>
                        {criterion.labelEn}
                      </td>
                      {['clientProspect', 'beneficialOwner'].map(column => {
                        const answer = riskScoreForm[column]?.[criterion.id];
                        if (criterion.multiple) {
                          // Multiple choice: one checkbox per option, points add up.
                          const picked = Array.isArray(answer) ? answer : (answer ? [answer] : []);
                          const toggle = (value) => handleRiskScoreChange(
                            column, criterion.id,
                            picked.includes(value) ? picked.filter(v => v !== value) : [...picked, value]
                          );
                          return (
                            <td key={column} style={{ padding: '6px 8px', textAlign: 'left' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.72rem', color: 'var(--text-primary)', opacity: viewingVersion ? 0.85 : 1 }}>
                                {criterion.options.map(opt => (
                                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: viewingVersion ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                                    <input
                                      type="checkbox"
                                      checked={picked.includes(opt.value)}
                                      onChange={() => toggle(opt.value)}
                                      disabled={!!viewingVersion}
                                      style={{ margin: 0, accentColor: 'var(--accent-color)' }}
                                    />
                                    <span>{opt.labelEn} ({opt.score} pts)</span>
                                  </label>
                                ))}
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td key={column} style={{ padding: '6px 8px', textAlign: 'center' }}>
                            {/* Option values are slugs ('euLowRisk'), and calculateRiskScore
                                matches on the slug. Coercing them with parseInt produced NaN,
                                which matched no option, so every selection snapped back to "-". */}
                            <select
                              value={answer ?? ''}
                              onChange={(e) => handleRiskScoreChange(column, criterion.id, e.target.value)}
                              disabled={!!viewingVersion}
                              style={{
                                width: '100%', padding: '4px', border: '1px solid var(--border-color)', borderRadius: '4px',
                                background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.72rem',
                                cursor: viewingVersion ? 'default' : 'pointer', opacity: viewingVersion ? 0.85 : 1
                              }}>
                              <option value="">-</option>
                              {criterion.options.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.labelEn} ({opt.score} pts)</option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                      {/* Business Relationship is not answered — one merged cell states the rule. */}
                      {idx === 0 && (
                        <td rowSpan={RISK_CRITERIA.length} style={{ padding: '6px 8px', textAlign: 'center', verticalAlign: 'middle', color: 'var(--text-muted)', fontSize: '0.72rem', fontStyle: 'italic', background: 'var(--bg-secondary)' }}>
                          Calculated<br />{BUSINESS_RELATIONSHIP_RULE.toLowerCase()}
                        </td>
                      )}
                    </tr>
                  ))}
                  {(() => {
                    const clientResult = calculateRiskScore(riskScoreForm.clientProspect || {});
                    const uboResult = calculateRiskScore(riskScoreForm.beneficialOwner || {});
                    const brResult = deriveBusinessRelationship(clientResult, uboResult);
                    const totals = [
                      { key: 'clientProspect', result: clientResult },
                      { key: 'beneficialOwner', result: uboResult },
                      { key: 'businessRelationship', result: brResult, note: brResult.derivedFrom === 'clientProspect' ? 'from Client' : 'from Benef. Owner' }
                    ];
                    return (
                      <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: '700' }}>
                        <td style={{ padding: '10px', color: 'var(--text-primary)' }}>TOTAL SCORE</td>
                        {totals.map(({ key, result, note }) => {
                          const colDisplay = getRiskLevelDisplay(result.riskLevel);
                          return (
                            <td key={key} style={{ padding: '10px', textAlign: 'center' }}>
                              <div style={{ fontSize: '1rem', fontWeight: '700', color: colDisplay.color }}>{result.totalScore}</div>
                              <span style={{ padding: '2px 8px', borderRadius: '8px', fontSize: '0.68rem', fontWeight: '600', background: `color-mix(in srgb, ${colDisplay.color} 8%, transparent)`, color: colDisplay.color }}>
                                {colDisplay.emoji} {colDisplay.labelEn}
                              </span>
                              {note && <div style={{ fontSize: '0.62rem', fontWeight: '500', color: 'var(--text-muted)', marginTop: '3px' }}>{note}</div>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <span>{'< 15 pts = Low Risk'}</span>
              <span>{'15-29 pts = Medium Risk'}</span>
              <span>{'≥ 30 pts = High Risk'}</span>
              <span>Review: every year (high) / 2 years (medium) / 3 years (low)</span>
            </div>

            <div style={{ marginTop: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '4px' }}>Comments</label>
              <textarea
                value={riskScoreForm.comments || ''}
                onChange={(e) => setRiskScoreForm(prev => ({ ...prev, comments: e.target.value }))}
                readOnly={!!viewingVersion}
                rows={2}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '0.82rem', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                placeholder="Additional notes..."
              />
            </div>

            {!viewingVersion && riskScoreAccount?.kycRiskScore?.assessmentDate && (
              <div style={{ marginTop: '8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Saving records a new version. The assessment of {new Date(riskScoreAccount.kycRiskScore.assessmentDate).toLocaleDateString()} is kept in this account's version history.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeRiskScoreModal}
                style={{ padding: '8px 16px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem' }}>
                {viewingVersion ? 'Close' : 'Cancel'}
              </button>
              {!viewingVersion && (
                <button
                  // Only close on success — a failed save must keep the filled-in form
                  onClick={async () => { try { await handleSaveRiskScore(); closeRiskScoreModal(); } catch { /* error shown in the modal */ } }}
                  disabled={savingRiskScore}
                  style={{ padding: '8px 16px', background: 'var(--gain-color)', color: 'white', border: 'none', borderRadius: '8px', cursor: savingRiskScore ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '600', opacity: savingRiskScore ? 0.7 : 1 }}>
                  {savingRiskScore ? 'Saving...' : 'Save Assessment'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archive Client Modal — closure date + PDF closure letter */}
      {showArchiveModal && (
        <div
          onClick={() => { if (!archiveBusy) setShowArchiveModal(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-primary)', borderRadius: '12px', border: '1px solid var(--border-color)', maxWidth: '480px', width: '100%', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
          >
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-primary)' }}>
              Archive Client
            </h3>
            <p style={{ margin: '0 0 18px 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Provide the closure date and attach the signed closure letter (PDF).
            </p>

            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Closure Date
            </label>
            <input
              type="date"
              value={archiveClosureDate}
              onChange={e => setArchiveClosureDate(e.target.value)}
              disabled={archiveBusy}
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--border-color)', borderRadius: '8px', fontSize: '0.9rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxSizing: 'border-box', marginBottom: '16px' }}
            />

            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>
              Closure Letter (PDF)
            </label>
            <input
              type="file"
              accept="application/pdf"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f && f.type !== 'application/pdf') {
                  setArchiveError('File must be a PDF.');
                  setArchiveClosureFile(null);
                  return;
                }
                if (f && f.size > 10 * 1024 * 1024) {
                  setArchiveError('File must be smaller than 10MB.');
                  setArchiveClosureFile(null);
                  return;
                }
                setArchiveError('');
                setArchiveClosureFile(f || null);
              }}
              disabled={archiveBusy}
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', boxSizing: 'border-box', marginBottom: '4px' }}
            />
            {archiveClosureFile && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                {archiveClosureFile.name} — {(archiveClosureFile.size / 1024).toFixed(0)} KB
              </div>
            )}

            {archiveError && (
              <div style={{ marginTop: '8px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--loss-color)', fontSize: '0.8rem' }}>
                {archiveError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                onClick={() => setShowArchiveModal(false)}
                disabled={archiveBusy}
                style={{ padding: '9px 18px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: archiveBusy ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '500' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!archiveClosureDate) {
                    setArchiveError('Closure date is required.');
                    return;
                  }
                  if (!archiveClosureFile) {
                    setArchiveError('Closure letter PDF is required.');
                    return;
                  }
                  setArchiveBusy(true);
                  setArchiveError('');
                  try {
                    const base64Data = await new Promise((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result.split(',')[1]);
                      reader.onerror = reject;
                      reader.readAsDataURL(archiveClosureFile);
                    });
                    await Meteor.callAsync('clientEntities.updateStatus', entityId, ENTITY_STATUSES.ARCHIVED, sessionId, {
                      closureDate: archiveClosureDate,
                      fileName: archiveClosureFile.name,
                      base64Data,
                      mimeType: archiveClosureFile.type
                    });
                    setShowArchiveModal(false);
                  } catch (err) {
                    console.error('Failed to archive entity:', err);
                    setArchiveError(err.reason || 'Failed to archive client.');
                  } finally {
                    setArchiveBusy(false);
                  }
                }}
                disabled={archiveBusy}
                style={{ padding: '9px 18px', background: 'var(--warning-color)', border: 'none', borderRadius: '8px', color: 'white', cursor: archiveBusy ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '600', opacity: archiveBusy ? 0.7 : 1 }}
              >
                {archiveBusy ? 'Archiving…' : 'Archive Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Dialog
        isOpen={dialogState.isOpen}
        onClose={hideDialog}
        title={dialogState.title}
        message={dialogState.message}
        type={dialogState.type}
        onConfirm={dialogState.onConfirm}
        onCancel={dialogState.onCancel}
        confirmText={dialogState.confirmText}
        cancelText={dialogState.cancelText}
        showCancel={dialogState.showCancel}
      />
    </div>
  );
}
