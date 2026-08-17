import React, { useState, useMemo, useEffect } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { USER_ROLES } from '/imports/api/users';
import { ClientEntitiesCollection, ENTITY_TYPES, ENTITY_STATUSES, ClientEntityHelpers } from '/imports/api/clientEntities';
import { UserEntityAccessCollection } from '/imports/api/userEntityAccess';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import UserDetailsScreen from './UserDetailsScreen.jsx';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';

// Entity sub-tabs
const ENTITY_SUB_TABS = {
  ALL: 'all',
  PHYSICAL_PERSON: ENTITY_TYPES.PHYSICAL_PERSON,
  COMPANY: ENTITY_TYPES.COMPANY
};

// ── Shared Styles ──
const S = {
  input: {
    width: '100%', padding: '10px 12px', border: '1.5px solid var(--border-color)', borderRadius: '8px',
    fontSize: '0.9rem', background: 'var(--bg-primary)', color: 'var(--text-primary)', boxSizing: 'border-box',
    outline: 'none', transition: 'border-color 0.2s ease'
  },
  select: {
    width: '100%', padding: '10px 12px', border: '1.5px solid var(--border-color)', borderRadius: '8px',
    fontSize: '0.9rem', background: 'var(--bg-primary)', color: 'var(--text-primary)', boxSizing: 'border-box',
    cursor: 'pointer', outline: 'none'
  },
  btnPrimary: {
    background: 'var(--accent-color)', color: 'white', border: 'none', padding: '9px 18px',
    borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600',
    transition: 'all 0.2s ease', letterSpacing: '0.01em'
  },
  btnGhost: {
    background: 'transparent', color: 'var(--text-secondary)', border: '1.5px solid var(--border-color)',
    padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500',
    transition: 'all 0.2s ease'
  },
  badge: (color, bg) => ({
    display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '6px',
    fontSize: '0.68rem', fontWeight: '600', letterSpacing: '0.03em',
    color, background: bg || `color-mix(in srgb, ${color} 8%, transparent)`, whiteSpace: 'nowrap'
  }),
  th: {
    padding: '11px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600',
    fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em',
    borderBottom: '1.5px solid var(--border-color)'
  },
  td: {
    padding: '12px 16px', borderTop: '1px solid var(--border-color)', verticalAlign: 'middle'
  }
};

const ClientsSection = ({ user: currentUser, theme }) => {
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateEntityForm, setShowCreateEntityForm] = useState(false);
  const [entitySubTab, setEntitySubTab] = useState('clients');
  const [typeFilter, setTypeFilter] = useState(null); // null = all, 'physical_person', 'company'
  const [entityStatusFilter, setEntityStatusFilter] = useState('active');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Create entity form state
  const [newEntityType, setNewEntityType] = useState(ENTITY_TYPES.PHYSICAL_PERSON);
  const [newEntityStatus, setNewEntityStatus] = useState(ENTITY_STATUSES.ACTIVE);
  const [newEntityFirstName, setNewEntityFirstName] = useState('');
  const [newEntityLastName, setNewEntityLastName] = useState('');
  const [newEntityCompanyName, setNewEntityCompanyName] = useState('');
  const [isCreatingEntity, setIsCreatingEntity] = useState(false);

  // Subscribe to client entities
  const entitySubscription = useMemo(() => {
    const sessionId = localStorage.getItem('sessionId');
    return Meteor.subscribe('clientEntities', sessionId);
  }, []);

  // Subscribe to access records
  const accessSubscription = useMemo(() => {
    const sessionId = localStorage.getItem('sessionId');
    return Meteor.subscribe('userEntityAccess', sessionId);
  }, []);

  const { entities, allBankAccounts, banks, entityIdsWithAccounts, accessRecords, isEntitiesLoading } = useTracker(() => {
    const isEntitiesReady = entitySubscription.ready();
    Meteor.subscribe('allBankAccounts', localStorage.getItem('sessionId'));
    Meteor.subscribe('banks');

    // Query all client entities
    const allEntities = ClientEntitiesCollection.find(
      { isActive: true },
      { sort: { 'profile.lastName': 1, 'profile.firstName': 1, 'profile.companyName': 1 } }
    ).fetch();

    // Query access records
    const allAccess = UserEntityAccessCollection.find({ isActive: true }).fetch();

    // All active bank accounts with entityId — deduplicated per entity by
    // accountNumber + bankId. The entityId MUST be part of the key: joint accounts are
    // held by several entities under the same account number at the same bank, and a
    // key without entityId silently drops all but one holder (they then look like
    // prospects while their detail page shows them as clients).
    const allAccountsRaw = BankAccountsCollection.find({ entityId: { $exists: true }, isActive: true }).fetch();
    const seen = new Set();
    const bankAccountsData = allAccountsRaw.filter(a => {
      const key = `${a.entityId}_${a.accountNumber}_${a.bankId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const banksData = BanksCollection.find().fetch();

    // Build set of entity IDs that have bank accounts (= clients)
    const accountEntityIds = new Set(bankAccountsData.map(a => a.entityId));

    return {
      entities: allEntities,
      allBankAccounts: bankAccountsData,
      banks: banksData,
      entityIdsWithAccounts: accountEntityIds,
      accessRecords: allAccess,
      isEntitiesLoading: !isEntitiesReady
    };
  }, [entitySubscription, accessSubscription]);

  // Fetch breach status for all clients
  const [userBreaches, setUserBreaches] = useState({});
  useEffect(() => {
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId || entities.length === 0) return;

    Meteor.call('rmDashboard.getClientBreachStatus', sessionId, (err, result) => {
      if (!err && result) {
        setUserBreaches(result);
      }
    });
  }, [entities.length]);

  // Entity type display helpers
  const getEntityTypeDisplay = (type) => {
    switch (type) {
      case ENTITY_TYPES.PHYSICAL_PERSON:
        return { label: 'Person', icon: '\ud83d\udc64', color: '#059669', bg: 'rgba(5, 150, 105, 0.1)' };
      case 'life_insurance': // Legacy — show as Company
        return { label: 'Company', icon: '\ud83c\udfe2', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.1)' };
      case ENTITY_TYPES.COMPANY:
        return { label: 'Company', icon: '\ud83c\udfe2', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.1)' };
      default:
        return { label: 'Unknown', icon: '\u2753', color: 'var(--text-muted)', bg: 'rgba(107, 114, 128, 0.1)' };
    }
  };

  const getEntityDisplayName = (entity) => {
    return ClientEntityHelpers.getEntityDisplayName(entity);
  };

  // Surname-first name for lists: "ANDREEVA Tatjana" — eases alphabetical scanning
  const getEntitySortName = (entity) => {
    if (!entity) return '';
    if (entity.type === ENTITY_TYPES.PHYSICAL_PERSON) {
      return `${entity.profile?.lastName || ''} ${entity.profile?.firstName || ''}`.trim() || getEntityDisplayName(entity);
    }
    return getEntityDisplayName(entity);
  };

  // Surname-first account name: "Eric & Christine BOEHM" → "BOEHM Eric & Christine".
  // Moves the trailing all-caps surname block to the front; leaves all-caps or
  // non-person names (companies, policy numbers) untouched.
  const formatAccountName = (name) => {
    if (!name) return '';
    const words = name.trim().split(/\s+/);
    const isUpperWord = w => /[A-ZÀ-Þ]/.test(w) && w === w.toUpperCase();
    let i = words.length;
    while (i > 0 && isUpperWord(words[i - 1])) i--;
    if (i === 0 || i === words.length) return name;
    const hasGivenName = words.slice(0, i).some(w => /[a-zà-þ]/.test(w));
    if (!hasGivenName) return name;
    return [...words.slice(i), ...words.slice(0, i)].join(' ');
  };

  const getEntityInitials = (entity) => {
    const name = getEntitySortName(entity);
    return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() || '?';
  };
  // Build map: entityId → [{ role, companyName }] from all company stakeholders
  const entityStakeholderRoles = useMemo(() => {
    const map = {};
    const roleLabels = { ubo: 'UBO', director: 'Director', signatory: 'Signatory', shareholder: 'Shareholder' };
    entities.forEach(company => {
      if (!company.stakeholders?.length) return;
      const companyName = ClientEntityHelpers.getEntityDisplayName(company);
      company.stakeholders.forEach(sh => {
        if (!sh.entityId) return;
        if (!map[sh.entityId]) map[sh.entityId] = [];
        map[sh.entityId].push({ role: roleLabels[sh.role] || sh.role, companyName });
      });
    });
    return map;
  }, [entities]);

  // Build map: entityId → [{ role: 'Beneficiary', companyName }] from life-insurance
  // accounts. The contract is held by the insurer, so the beneficiary owns no account
  // of their own — they are a related party, not a direct client and not a prospect.
  const entityBeneficiaryRoles = useMemo(() => {
    const map = {};
    allBankAccounts.forEach(acc => {
      const accountLabel = acc.name || acc.accountNumber;
      ClientEntityHelpers.getAccountBeneficialOwnerIds(acc).forEach(ownerId => {
        if (!map[ownerId]) map[ownerId] = [];
        map[ownerId].push({ role: 'Beneficiary', companyName: accountLabel });
      });
    });
    return map;
  }, [allBankAccounts]);

  // All relationship badges for an entity, in one list
  const getEntityRoles = (entityId) => [
    ...(entityStakeholderRoles[entityId] || []),
    ...(entityBeneficiaryRoles[entityId] || [])
  ];

  // Computed status — shared with the entity detail header via ClientEntityHelpers
  // so the sidebar badge and the header badge always agree.
  const getEntityComputedStatus = (e) => ClientEntityHelpers.getComputedEntityStatus(e, {
    hasAccounts: entityIdsWithAccounts.has(e._id),
    hasStakeholderRoles: entityStakeholderRoles[e._id]?.length > 0,
    isBeneficialOwner: entityBeneficiaryRoles[e._id]?.length > 0
  });

  // Filter entities by sub-tab, status, and search
  const filteredEntities = entities
    .filter(entity => {
      const normalizedType = entity.type === 'life_insurance' ? ENTITY_TYPES.COMPANY : entity.type;
      if (entitySubTab === 'clients' && !entityIdsWithAccounts.has(entity._id)) return false;
      if (typeFilter && normalizedType !== typeFilter) return false;
      if (entityStatusFilter !== 'all' && getEntityComputedStatus(entity) !== entityStatusFilter) return false;
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return getEntityDisplayName(entity).toLowerCase().includes(search)
        || getEntitySortName(entity).toLowerCase().includes(search);
    })
    .sort((a, b) => getEntitySortName(a).localeCompare(getEntitySortName(b)));

  // Role priority for sorting (lower number = higher priority)
  // Entity counts by type
  const entityTypeCounts = useMemo(() => {
    const all = { total: 0, clients: 0, [ENTITY_TYPES.PHYSICAL_PERSON]: 0, [ENTITY_TYPES.COMPANY]: 0 };
    const clientsOnly = { [ENTITY_TYPES.PHYSICAL_PERSON]: 0, [ENTITY_TYPES.COMPANY]: 0 };
    entities.forEach(e => {
      all.total++;
      const normalizedType = e.type === 'life_insurance' ? ENTITY_TYPES.COMPANY : e.type;
      if (all[normalizedType] !== undefined) all[normalizedType]++;
      if (entityIdsWithAccounts.has(e._id)) {
        all.clients++;
        if (clientsOnly[normalizedType] !== undefined) clientsOnly[normalizedType]++;
      }
    });
    return { all, clientsOnly };
  }, [entities, entityIdsWithAccounts]);

  // Entity status counts — respects entitySubTab and typeFilter
  const entityStatusCounts = useMemo(() => {
    let filtered = entities;
    if (entitySubTab === 'clients') filtered = filtered.filter(e => entityIdsWithAccounts.has(e._id));
    if (typeFilter) filtered = filtered.filter(e => (e.type === 'life_insurance' ? ENTITY_TYPES.COMPANY : e.type) === typeFilter);
    const counts = { all: filtered.length, active: 0, prospect: 0, archived: 0 };
    filtered.forEach(e => {
      const status = getEntityComputedStatus(e);
      if (counts[status] !== undefined) counts[status]++;
    });
    return counts;
  }, [entities, entitySubTab, typeFilter, entityIdsWithAccounts, entityStakeholderRoles, entityBeneficiaryRoles]);

  const canCreateEntities = currentUser?.role === USER_ROLES.ADMIN || currentUser?.role === USER_ROLES.SUPERADMIN || currentUser?.role === USER_ROLES.COMPLIANCE;

  const handleCreateEntity = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsCreatingEntity(true);

    const sessionId = localStorage.getItem('sessionId');
    const isPersonType = newEntityType === ENTITY_TYPES.PHYSICAL_PERSON;
    const profile = isPersonType
      ? { firstName: newEntityFirstName, lastName: newEntityLastName }
      : { companyName: newEntityCompanyName };

    Meteor.call('clientEntities.create', {
      type: newEntityType,
      status: newEntityStatus,
      profile,
      referenceCurrency: 'EUR'
    }, sessionId, (err, entityId) => {
      setIsCreatingEntity(false);
      if (err) {
        setError(err.reason || 'Failed to create entity');
      } else {
        const statusLabel = ClientEntityHelpers.getEntityStatusDisplay(newEntityStatus).label;
        setSuccess(`${ClientEntityHelpers.getEntityTypeLabel(newEntityType)} (${statusLabel}) created!`);
        setNewEntityFirstName('');
        setNewEntityLastName('');
        setNewEntityCompanyName('');
        setNewEntityType(ENTITY_TYPES.PHYSICAL_PERSON);
        setNewEntityStatus(ENTITY_STATUSES.ACTIVE);
        setShowCreateEntityForm(false);
        setSelectedEntityId(entityId);
        setTimeout(() => setSuccess(''), 3000);
      }
    });
  };

  return (
    <div style={{
      display: 'flex',
      height: 'calc(100vh - 80px)',
      background: 'var(--bg-primary)'
    }}>
      {/* Left Panel - User List */}
      <div style={{
        width: '400px',
        minWidth: '400px',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.25rem 1rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem'
          }}>
            <h2 style={{
              margin: 0,
              fontSize: '1.3rem',
              fontWeight: '700',
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em'
            }}>
              Contacts
            </h2>
            {canCreateEntities && (
              <button
                onClick={() => setShowCreateEntityForm(!showCreateEntityForm)}
                style={{
                  ...S.btnPrimary,
                  background: showCreateEntityForm ? 'var(--danger-color)' : 'var(--accent-color)',
                  padding: '7px 14px', fontSize: '0.82rem'
                }}
              >
                {showCreateEntityForm ? 'Cancel' : '+ New'}
              </button>
            )}
            <button
              onClick={() => setSelectedEntityId(null)}
              style={{
                ...S.btnGhost,
                padding: '7px 10px',
                background: !selectedEntityId ? 'var(--accent-color)' : 'transparent',
                color: !selectedEntityId ? 'white' : 'var(--text-muted)',
                border: !selectedEntityId ? 'none' : '1.5px solid var(--border-color)'
              }}
              title="Overview dashboard"
            >
              📊
            </button>
          </div>

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.85rem', pointerEvents: 'none' }}>
              🔍
            </span>
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                ...S.input,
                paddingLeft: '36px',
                fontSize: '0.88rem',
                background: 'var(--bg-tertiary)',
                border: '1.5px solid transparent'
              }}
            />
          </div>
        </div>


        {/* ── Navigation: 3-tier filter system ── */}

        {/* Tier 1: Primary scope — Entities vs Clients */}
        <div style={{ display: 'flex', background: 'var(--bg-secondary)' }}>
          {[
            { id: ENTITY_SUB_TABS.ALL, label: 'Entities', count: entityTypeCounts.all.total, icon: '📋' },
            { id: 'clients', label: 'Clients', count: entityTypeCounts.all.clients, icon: '💼' }
          ].map(tab => {
            const isActive = tab.id === 'clients' ? entitySubTab === 'clients' : entitySubTab !== 'clients';
            return (
              <button key={tab.id} onClick={() => { setEntitySubTab(tab.id); setTypeFilter(null); setSelectedEntityId(null); }}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  padding: '12px 10px', border: 'none', cursor: 'pointer',
                  background: isActive ? 'var(--bg-primary)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontSize: '0.88rem', fontWeight: isActive ? '700' : '500',
                  borderBottom: isActive ? '2px solid var(--accent-color)' : '2px solid transparent',
                  transition: 'all 0.2s ease', letterSpacing: '-0.01em'
                }}>
                <span style={{ fontSize: '0.9rem' }}>{tab.icon}</span>
                {tab.label}
                <span style={{
                  fontSize: '0.72rem', fontWeight: '700', padding: '2px 7px', borderRadius: '10px', minWidth: '18px', textAlign: 'center',
                  background: isActive ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                  color: isActive ? 'white' : 'var(--text-muted)'
                }}>{tab.count}</span>
              </button>
            );
          })}
        </div>

        {/* Tier 2: Type filter — Persons / Companies */}
        <div style={{
          display: 'flex', gap: '6px', padding: '8px 12px',
          borderTop: '1px solid var(--border-color)',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-primary)'
        }}>
          {[
            { id: ENTITY_TYPES.PHYSICAL_PERSON, label: 'Persons', icon: '👤', count: entitySubTab === 'clients' ? entityTypeCounts.clientsOnly[ENTITY_TYPES.PHYSICAL_PERSON] : entityTypeCounts.all[ENTITY_TYPES.PHYSICAL_PERSON] },
            { id: ENTITY_TYPES.COMPANY, label: 'Companies', icon: '🏢', count: entitySubTab === 'clients' ? entityTypeCounts.clientsOnly[ENTITY_TYPES.COMPANY] : entityTypeCounts.all[ENTITY_TYPES.COMPANY] }
          ].map(tab => {
            const active = typeFilter === tab.id;
            return (
              <button key={tab.id} onClick={() => { setTypeFilter(active ? null : tab.id); setSelectedEntityId(null); }}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  padding: '7px 8px', borderRadius: '8px', cursor: 'pointer',
                  border: active ? '1.5px solid var(--accent-color)' : '1.5px solid var(--border-color)',
                  background: active ? 'rgba(var(--accent-rgb, 59, 130, 246), 0.08)' : 'var(--bg-secondary)',
                  color: active ? 'var(--accent-color)' : 'var(--text-secondary)',
                  fontSize: '0.78rem', fontWeight: active ? '600' : '500', transition: 'all 0.15s ease'
                }}>
                <span style={{ fontSize: '0.75rem' }}>{tab.icon}</span>
                {tab.label}
                <span style={{
                  fontSize: '0.65rem', fontWeight: '600', padding: '1px 5px', borderRadius: '6px',
                  background: active ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                  color: active ? 'white' : 'var(--text-muted)'
                }}>{tab.count}</span>
              </button>
            );
          })}
        </div>

        {/* Tier 3: Status filter — Active / Prospects / Archived */}
        <div style={{
          display: 'flex', gap: '4px', padding: '6px 12px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)'
        }}>
          {[
            { id: 'active', label: 'Active', color: 'var(--gain-color)', count: entityStatusCounts.active },
            { id: 'prospect', label: 'Prospects', color: 'var(--warning-color)', count: entityStatusCounts.prospect },
            { id: 'archived', label: 'Archived', color: 'var(--text-muted)', count: entityStatusCounts.archived }
          ].map(s => {
            const active = entityStatusFilter === s.id;
            return (
              <button key={s.id} onClick={() => setEntityStatusFilter(active ? 'all' : s.id)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  padding: '5px 6px', borderRadius: '6px', cursor: 'pointer',
                  border: 'none',
                  background: active ? `color-mix(in srgb, ${s.color} 9%, transparent)` : 'transparent',
                  color: active ? s.color : 'var(--text-muted)',
                  fontSize: '0.72rem', fontWeight: active ? '700' : '400', transition: 'all 0.15s ease'
                }}>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: active ? s.color : 'var(--text-muted)',
                  opacity: active ? 1 : 0.3
                }} />
                {s.label}
                {s.count > 0 && <span style={{ fontWeight: '600', opacity: active ? 1 : 0.5 }}>{s.count}</span>}
              </button>
            );
          })}
        </div>

        {/* Create Entity Form */}
        {showCreateEntityForm && canCreateEntities && (
          <div style={{
            padding: '1rem',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-primary)'
          }}>
            <form onSubmit={handleCreateEntity}>
              <div style={{ marginBottom: '0.75rem' }}>
                <select
                  value={newEntityType}
                  onChange={(e) => setNewEntityType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box',
                    cursor: 'pointer'
                  }}
                >
                  <option value={ENTITY_TYPES.PHYSICAL_PERSON}>Person</option>
                  <option value={ENTITY_TYPES.COMPANY}>Company</option>
                </select>
              </div>
              {/* No status picker: Prospect/Active is derived from bank accounts and
                  stakeholder roles, so picking one here would be ignored by the list. */}
              {newEntityType === ENTITY_TYPES.PHYSICAL_PERSON ? (
                <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="First Name *"
                    value={newEntityFirstName}
                    onChange={(e) => setNewEntityFirstName(e.target.value)}
                    required
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '10px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Last Name *"
                    value={newEntityLastName}
                    onChange={(e) => setNewEntityLastName(e.target.value)}
                    required
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '10px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
              ) : (
                <div style={{ marginBottom: '0.75rem' }}>
                  <input
                    type="text"
                    placeholder="Company Name *"
                    value={newEntityCompanyName}
                    onChange={(e) => setNewEntityCompanyName(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              )}
              {error && (
                <div style={{
                  color: 'var(--danger-color)',
                  fontSize: '0.85rem',
                  marginBottom: '0.75rem'
                }}>
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={isCreatingEntity}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: isCreatingEntity ? 'var(--text-muted)' : 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isCreatingEntity ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600'
                }}
              >
                {isCreatingEntity ? 'Creating...' : 'Create Entity'}
              </button>
            </form>
          </div>
        )}


        {/* Success message */}
        {success && (
          <div style={{
            padding: '0.75rem 1rem',
            background: 'rgba(16, 185, 129, 0.1)',
            borderBottom: '1px solid rgba(16, 185, 129, 0.3)',
            color: 'var(--gain-color)',
            fontSize: '0.85rem'
          }}>
            {success}
          </div>
        )}

        {/* List — Entities or Users depending on view mode */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.5rem'
        }}>
          {isEntitiesLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Loading entities...
              </div>
            ) : filteredEntities.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                {searchTerm ? 'No entities match your search' : 'No entities found'}
              </div>
            ) : (
              filteredEntities.map(entity => {
                const displayName = getEntitySortName(entity);
                const initials = getEntityInitials(entity);
                const typeDisplay = getEntityTypeDisplay(entity.type);
                const statusDisplay = ClientEntityHelpers.getEntityStatusDisplay(getEntityComputedStatus(entity));
                const isSelected = selectedEntityId === entity._id;

                return (
                  <div
                    key={entity._id}
                    onClick={() => { setSelectedEntityId(entity._id); }}
                    style={{
                      padding: '10px 12px',
                      marginBottom: '4px',
                      background: isSelected ? 'var(--accent-color)' : 'transparent',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      borderLeft: isSelected ? '3px solid white' : '3px solid transparent'
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-tertiary)'; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '10px',
                        background: isSelected ? 'rgba(255,255,255,0.2)' : `linear-gradient(135deg, color-mix(in srgb, ${typeDisplay.color} 19%, transparent), color-mix(in srgb, ${typeDisplay.color} 6%, transparent))`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: isSelected ? 'white' : typeDisplay.color,
                        fontWeight: '700', fontSize: '0.78rem',
                        border: isSelected ? 'none' : `1px solid color-mix(in srgb, ${typeDisplay.color} 15%, transparent)`,
                        flexShrink: 0
                      }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '2px' }}>
                          <span style={{
                            fontWeight: '600',
                            color: isSelected ? 'white' : 'var(--text-primary)',
                            fontSize: '0.95rem',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {displayName}
                          </span>
                          <span style={{
                            fontSize: '0.65rem',
                            fontWeight: '600',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: isSelected ? 'rgba(255,255,255,0.2)' : typeDisplay.bg,
                            color: isSelected ? 'white' : typeDisplay.color,
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                          }}>
                            {typeDisplay.label}
                          </span>
                          {(entity.isInsurance || entity.type === 'life_insurance') && (
                            <span style={{
                              fontSize: '0.6rem', fontWeight: '600', padding: '1px 5px', borderRadius: '3px',
                              background: isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(20, 184, 166, 0.12)',
                              color: isSelected ? 'rgba(255,255,255,0.8)' : '#14b8a6',
                              whiteSpace: 'nowrap', flexShrink: 0
                            }}>
                              Insurance
                            </span>
                          )}
                          {entityIdsWithAccounts.has(entity._id) && (
                            <span style={{
                              fontSize: '0.6rem',
                              fontWeight: '600',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              background: isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(37, 99, 235, 0.12)',
                              color: isSelected ? 'rgba(255,255,255,0.8)' : '#2563eb',
                              whiteSpace: 'nowrap',
                              flexShrink: 0
                            }}>
                              Client
                            </span>
                          )}
                          {getEntityRoles(entity._id).map((sr, i) => (
                            <span key={i} style={{
                              fontSize: '0.55rem', fontWeight: '600', padding: '1px 4px', borderRadius: '3px',
                              background: isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(139, 92, 246, 0.12)',
                              color: isSelected ? 'rgba(255,255,255,0.8)' : '#8b5cf6',
                              whiteSpace: 'nowrap', flexShrink: 0
                            }} title={sr.companyName}>
                              {sr.role}
                            </span>
                          ))}
                          {/* Only non-active statuses get a badge — "Active" is the norm */}
                          {getEntityComputedStatus(entity) !== ENTITY_STATUSES.ACTIVE && (
                            <span style={{
                              fontSize: '0.6rem',
                              fontWeight: '600',
                              padding: '1px 5px',
                              borderRadius: '3px',
                              background: isSelected ? 'rgba(255,255,255,0.15)' : `color-mix(in srgb, ${statusDisplay.color} 8%, transparent)`,
                              color: isSelected ? 'rgba(255,255,255,0.8)' : statusDisplay.color,
                              whiteSpace: 'nowrap',
                              flexShrink: 0
                            }}>
                              {statusDisplay.label}
                            </span>
                          )}
                        </div>
                        <div style={{
                          fontSize: '0.8rem',
                          color: isSelected ? 'rgba(255,255,255,0.7)' : 'var(--text-secondary)',
                        }}>
                          {entity.referenceCurrency || 'EUR'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
        </div>

        {/* Count footer */}
        <div style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid var(--border-color)',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          textAlign: 'center'
        }}>
          {`${filteredEntities.length} entit${filteredEntities.length !== 1 ? "ies" : "y"}`}
        </div>
      </div>

      {/* Right Panel - Entity or User Details */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        background: 'var(--bg-primary)'
      }}>
        {selectedEntityId ? (
          (() => {
            const entity = entities.find(e => e._id === selectedEntityId);
            return (
              <UserDetailsScreen
                userId={entity?.migratedFromUserId || null}
                entityId={selectedEntityId}
                onBack={() => setSelectedEntityId(null)}
                embedded={true}
              />
            );
          })()
        ) : (
          <div style={{ padding: '1.5rem 2rem', overflowY: 'auto', height: '100%' }}>
            {/* Clients Table */}
            {(() => {
              const clientEntities = entities
                .filter(e => entityIdsWithAccounts.has(e._id))
                .sort((a, b) => getEntitySortName(a).localeCompare(getEntitySortName(b)));
              return (
                <div style={{ marginBottom: '2.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <span style={S.badge('#2563eb', 'rgba(37, 99, 235, 0.1)')}>Client</span>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                      Entities
                    </h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{clientEntities.length}</span>
                  </div>
                  {clientEntities.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: '10px', fontSize: '0.9rem' }}>No client entities yet</div>
                  ) : (
                    <div style={{ borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)' }}>
                            <th style={S.th}>Entity</th>
                            <th style={S.th}>Type</th>
                            <th style={{ ...S.th, textAlign: 'center' }}>Accounts</th>
                            <th style={S.th}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {clientEntities.map((ent, i) => {
                            const typeDisplay = getEntityTypeDisplay(ent.type);
                            const accountCount = allBankAccounts.filter(a => a.entityId === ent._id).length;
                            const statusDisplay = ClientEntityHelpers.getEntityStatusDisplay(getEntityComputedStatus(ent));
                            return (
                              <tr key={ent._id}
                                onClick={() => { setSelectedEntityId(ent._id); }}
                                style={{ cursor: 'pointer', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)', transition: 'background 0.12s' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)'}
                              >
                                <td style={{ ...S.td, fontWeight: '600', color: 'var(--text-primary)' }}>{ClientEntityHelpers.getEntityDisplayName(ent)}</td>
                                <td style={S.td}><span style={S.badge(typeDisplay.color, typeDisplay.bg)}>{typeDisplay.label}</span></td>
                                <td style={{ ...S.td, textAlign: 'center', fontWeight: '700', color: 'var(--accent-color)', fontSize: '0.9rem' }}>{accountCount}</td>
                                <td style={S.td}>
                                  {(
                                    <span style={S.badge(statusDisplay.color)}>{statusDisplay.label}</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* All Bank Accounts Table */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <span style={{ fontSize: '1.1rem' }}>🏦</span>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                  All Accounts
                </h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{allBankAccounts.length}</span>
              </div>
              {allBankAccounts.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: '10px', fontSize: '0.9rem' }}>No bank accounts yet</div>
              ) : (
                <div style={{ borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)' }}>
                        <th style={S.th}>Account Name</th>
                        <th style={S.th}>Bank</th>
                        <th style={S.th}>Account #</th>
                        <th style={{ ...S.th, textAlign: 'center' }}>CCY</th>
                        <th style={S.th}>Type</th>
                        <th style={S.th}>UBO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...allBankAccounts].sort((a, b) => {
                        const keyA = getEntitySortName(entities.find(e => e._id === a.entityId)) || formatAccountName(a.name) || '';
                        const keyB = getEntitySortName(entities.find(e => e._id === b.entityId)) || formatAccountName(b.name) || '';
                        return keyA.localeCompare(keyB);
                      }).map((acc, i) => {
                        const ent = entities.find(e => e._id === acc.entityId);
                        const bank = banks.find(b => b._id === acc.bankId);
                        const uboIds = acc.beneficialOwnerIds || (acc.beneficialOwnerId ? [acc.beneficialOwnerId] : []);
                        const ubos = uboIds.map(id => entities.find(e => e._id === id)).filter(Boolean);
                        return (
                          <tr key={acc._id}
                            onClick={() => { if (ent) { setSelectedEntityId(ent._id); }}}
                            style={{ cursor: 'pointer', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)', transition: 'background 0.12s' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                            onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)'}
                          >
                            <td style={{ ...S.td, fontWeight: '600', color: 'var(--text-primary)' }}>{formatAccountName(acc.name) || getEntitySortName(ent) || '-'}</td>
                            <td style={{ ...S.td, color: 'var(--text-primary)' }}>{bank?.name || '-'}</td>
                            <td style={{ ...S.td, color: 'var(--text-secondary)', fontFamily: "'Roboto Mono', monospace", fontSize: '0.82rem', letterSpacing: '0.03em' }}>{acc.accountNumber}</td>
                            <td style={{ ...S.td, textAlign: 'center' }}>
                              <span style={S.badge('var(--accent-color)', 'rgba(79, 166, 255, 0.1)')}>{acc.referenceCurrency}</span>
                            </td>
                            <td style={{ ...S.td, color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{acc.comment || acc.accountType}</td>
                            <td style={{ ...S.td, color: ubos.length > 0 ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '0.82rem' }}>{ubos.length > 0 ? ubos.map(u => getEntitySortName(u)).join(', ') : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientsSection;
