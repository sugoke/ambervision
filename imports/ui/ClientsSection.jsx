import React, { useState, useMemo, useEffect } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { USER_ROLES } from '/imports/api/users';
import { ClientEntitiesCollection, ENTITY_TYPES, ENTITY_STATUSES, ClientEntityHelpers } from '/imports/api/clientEntities';
import { UserEntityAccessCollection } from '/imports/api/userEntityAccess';
import { BankAccountsCollection, getAccountHolderIds, isJointAccount, buildJointAccountName, getClientReferenceCurrency } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import UserDetailsScreen from './UserDetailsScreen.jsx';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';

// Archived is a stored flag, independent of whether the entity holds accounts
// (see ClientEntityHelpers.getComputedEntityStatus, which checks it first).
const isArchivedEntity = (entity) => entity?.status === ENTITY_STATUSES.ARCHIVED;

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

const ClientsSection = ({ user: currentUser, theme, initialEntityId = null, onInitialEntityConsumed }) => {
  const [selectedEntityId, setSelectedEntityId] = useState(initialEntityId);

  // A dashboard link can ask for a specific client file to be opened
  useEffect(() => {
    if (!initialEntityId) return;
    setSelectedEntityId(initialEntityId);
    onInitialEntityConsumed?.();
  }, [initialEntityId]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateEntityForm, setShowCreateEntityForm] = useState(false);
  const [entitySubTab, setEntitySubTab] = useState('clients');
  const [typeFilter, setTypeFilter] = useState(null); // null = all, 'physical_person', 'company'
  const [entityStatusFilter, setEntityStatusFilter] = useState('active');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [exporting, setExporting] = useState(false);

  // Whole client base to Excel - server enforces the same roles and audits it
  const canExportClients = [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(currentUser?.role);
  const handleExportClients = async () => {
    setExporting(true);
    setError('');
    try {
      const { base64, fileName, counts } = await Meteor.callAsync('clients.exportAllToExcel', localStorage.getItem('sessionId'));
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSuccess(`Exported ${counts.clients} clients and ${counts.accounts} bank accounts`);
    } catch (err) {
      setError(err.reason || err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

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
    Meteor.subscribe('banks', localStorage.getItem('sessionId'));

    // Query all client entities
    const allEntities = ClientEntitiesCollection.find(
      { isActive: true },
      { sort: { 'profile.lastName': 1, 'profile.firstName': 1, 'profile.companyName': 1 } }
    ).fetch();

    // Query access records
    const allAccess = UserEntityAccessCollection.find({ isActive: true }).fetch();

    // All active bank accounts with entityId — deduplicated by accountNumber +
    // bankId. A joint account is now ONE row listing every holder, so the account
    // number identifies it uniquely; each holder is counted as a client through
    // holderEntityIds below rather than through a row of their own.
    const allAccountsRaw = BankAccountsCollection.find({ entityId: { $exists: true }, isActive: true }).fetch();
    const seen = new Set();
    const bankAccountsData = allAccountsRaw.filter(a => {
      const key = `${a.accountNumber}_${a.bankId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const banksData = BanksCollection.find().fetch();

    // Entity IDs holding a bank account (= clients, as opposed to prospects).
    // Every holder of a joint account counts, not just the primary one.
    const accountEntityIds = new Set(
      bankAccountsData.flatMap(a => getAccountHolderIds(a))
    );

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

  // ── Client groups ──────────────────────────────────────────────────────
  // A joint account is held by several entities (a couple). They are separate
  // legal persons — so the Entities tab lists them individually — but they are
  // ONE client relationship, and the Clients tab shows them on one line.
  //
  // Entities are grouped by co-holding: any two entities sharing an account land
  // in the same group, transitively (union-find), so a chain of shared accounts
  // collapses into a single client.
  const clientGroups = useMemo(() => {
    const parent = new Map();
    const find = (x) => {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)));
        x = parent.get(x);
      }
      return x;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    entityIdsWithAccounts.forEach(id => parent.set(id, id));
    allBankAccounts.forEach(acc => {
      const holders = getAccountHolderIds(acc).filter(id => parent.has(id));
      for (let i = 1; i < holders.length; i++) union(holders[0], holders[i]);
    });

    // Collect members per root, and remember which joint account tied them
    // together so the group can borrow the bank's own wording for the couple.
    const byRoot = new Map();
    parent.forEach((_, id) => {
      const root = find(id);
      if (!byRoot.has(root)) byRoot.set(root, []);
      const ent = entities.find(e => e._id === id);
      if (ent) byRoot.get(root).push(ent);
    });

    const jointAccountByRoot = new Map();
    allBankAccounts.forEach(acc => {
      const holders = getAccountHolderIds(acc).filter(id => parent.has(id));
      if (holders.length < 2) return;
      const root = find(holders[0]);
      if (!jointAccountByRoot.has(root)) jointAccountByRoot.set(root, acc);
    });

    const groups = [];
    byRoot.forEach((members, root) => {
      if (members.length === 0) return;
      const jointAccount = jointAccountByRoot.get(root);
      // The account's primary holder leads the group; that is the profile the
      // row opens, and the one the bank files the holdings under.
      const primary = (jointAccount && members.find(m => m._id === jointAccount.entityId)) || members[0];
      const ordered = [primary, ...members.filter(m => m._id !== primary._id)];
      groups.push({
        key: root,
        members: ordered,
        primary,
        isJoint: members.length > 1,
        // Prefer the bank's own label for the couple ("WARKENTIN David & Bethany"),
        // which reads the way the desk says it; fall back to composing one.
        displayName: members.length > 1
          ? (formatAccountName(jointAccount?.name) || buildJointAccountName(ordered))
          : getEntitySortName(primary)
      });
    });
    return groups;
  }, [entities, allBankAccounts, entityIdsWithAccounts]);

  // Rows for the sidebar: one per entity on the Entities tab, one per client
  // relationship (joint holders collapsed) on the Clients tab.
  const filteredRows = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    const matchesSearch = (members) => !search || members.some(m =>
      getEntityDisplayName(m).toLowerCase().includes(search)
      || getEntitySortName(m).toLowerCase().includes(search)
    );

    const rows = entitySubTab === 'clients'
      ? clientGroups
      : entities.map(e => ({ key: e._id, members: [e], primary: e, isJoint: false, displayName: getEntitySortName(e) }));

    return rows
      .filter(row => {
        // A group's type/status is that of its lead entity — joint holders are
        // the same kind of client and share the relationship's status.
        const primary = row.primary;
        const normalizedType = primary.type === 'life_insurance' ? ENTITY_TYPES.COMPANY : primary.type;
        if (typeFilter && normalizedType !== typeFilter) return false;
        if (entityStatusFilter === 'all') {
          // Unfiltered means "the book as it stands": archived relationships are
          // left out so the list matches the counts above it. They are one click
          // away under the Archived filter.
          if (isArchivedEntity(primary)) return false;
        } else if (getEntityComputedStatus(primary) !== entityStatusFilter) {
          return false;
        }
        return matchesSearch(row.members);
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [entities, clientGroups, entitySubTab, typeFilter, entityStatusFilter, searchTerm, entityIdsWithAccounts, entityStakeholderRoles, entityBeneficiaryRoles]);

  // Entity counts by type. The Clients tab counts client RELATIONSHIPS, so a
  // couple holding one joint account counts once; the Entities tab counts every
  // legal person separately.
  //
  // Archived entities are excluded: these badges answer "how many clients do we
  // have", and an archived relationship is no longer one. They stay reachable
  // through the Archived status filter, which keeps its own count.
  const entityTypeCounts = useMemo(() => {
    const all = { total: 0, clients: 0, [ENTITY_TYPES.PHYSICAL_PERSON]: 0, [ENTITY_TYPES.COMPANY]: 0 };
    const clientsOnly = { [ENTITY_TYPES.PHYSICAL_PERSON]: 0, [ENTITY_TYPES.COMPANY]: 0 };
    entities.forEach(e => {
      if (isArchivedEntity(e)) return;
      all.total++;
      const normalizedType = e.type === 'life_insurance' ? ENTITY_TYPES.COMPANY : e.type;
      if (all[normalizedType] !== undefined) all[normalizedType]++;
    });
    clientGroups.forEach(group => {
      const primary = group.primary;
      if (isArchivedEntity(primary)) return;
      all.clients++;
      const normalizedType = primary.type === 'life_insurance' ? ENTITY_TYPES.COMPANY : primary.type;
      if (clientsOnly[normalizedType] !== undefined) clientsOnly[normalizedType]++;
    });
    return { all, clientsOnly };
  }, [entities, clientGroups]);

  // Entity status counts — respects entitySubTab and typeFilter, and counts one
  // per client relationship on the Clients tab (see clientGroups).
  const entityStatusCounts = useMemo(() => {
    let subjects = entitySubTab === 'clients'
      ? clientGroups.map(g => g.primary)
      : entities;
    if (typeFilter) subjects = subjects.filter(e => (e.type === 'life_insurance' ? ENTITY_TYPES.COMPANY : e.type) === typeFilter);
    const counts = { all: subjects.length, active: 0, prospect: 0, archived: 0 };
    subjects.forEach(e => {
      const status = getEntityComputedStatus(e);
      if (counts[status] !== undefined) counts[status]++;
    });
    return counts;
  }, [entities, clientGroups, entitySubTab, typeFilter, entityIdsWithAccounts, entityStakeholderRoles, entityBeneficiaryRoles]);

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
            {canExportClients && (
              <button
                onClick={handleExportClients}
                disabled={exporting}
                style={{
                  ...S.btnGhost,
                  padding: '7px 10px',
                  border: '1.5px solid var(--border-color)',
                  color: 'var(--text-muted)',
                  cursor: exporting ? 'wait' : 'pointer',
                  opacity: exporting ? 0.6 : 1
                }}
                title="Export all clients, bank accounts, stakeholders and family members to Excel"
              >
                {exporting ? '…' : '⬇ Excel'}
              </button>
            )}
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
            ) : filteredRows.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                {searchTerm ? 'No entities match your search' : 'No entities found'}
              </div>
            ) : (
              filteredRows.map(row => {
                // A row is one entity, or one client relationship whose joint
                // holders share a line. The lead entity drives type and status.
                const entity = row.primary;
                const displayName = row.displayName;
                const initials = row.isJoint
                  ? displayName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
                  : getEntityInitials(entity);
                const typeDisplay = getEntityTypeDisplay(entity.type);
                const statusDisplay = ClientEntityHelpers.getEntityStatusDisplay(getEntityComputedStatus(entity));
                const isSelected = row.members.some(m => m._id === selectedEntityId);

                return (
                  <div
                    key={row.key}
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
                          {row.isJoint && (
                            <span style={{
                              fontSize: '0.6rem', fontWeight: '600', padding: '1px 5px', borderRadius: '3px',
                              background: isSelected ? 'rgba(255,255,255,0.15)' : 'rgba(139, 92, 246, 0.12)',
                              color: isSelected ? 'rgba(255,255,255,0.8)' : '#8b5cf6',
                              whiteSpace: 'nowrap', flexShrink: 0
                            }} title={row.members.map(m => getEntitySortName(m)).join(' & ')}>
                              Joint
                            </span>
                          )}
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
                          {getClientReferenceCurrency(entity, allBankAccounts.filter(a => getAccountHolderIds(a).includes(entity._id))).currency}
                        </div>
                      </div>
                    </div>

                    {/* Joint holders are one client but separate legal persons —
                        each keeps their own KYC, documents and profile, so the
                        open row lets you jump straight to either file. */}
                    {row.isJoint && isSelected && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px', paddingLeft: '46px' }}>
                        {row.members.map(member => {
                          const isCurrent = member._id === selectedEntityId;
                          return (
                            <span
                              key={member._id}
                              onClick={(e) => { e.stopPropagation(); setSelectedEntityId(member._id); }}
                              style={{
                                fontSize: '0.7rem', fontWeight: '600', padding: '3px 8px', borderRadius: '5px',
                                cursor: 'pointer', whiteSpace: 'nowrap',
                                background: isCurrent ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.12)',
                                color: 'white',
                                border: isCurrent ? '1px solid rgba(255,255,255,0.6)' : '1px solid transparent'
                              }}
                            >
                              {getEntitySortName(member)}
                            </span>
                          );
                        })}
                      </div>
                    )}
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
          {entitySubTab === 'clients'
            ? `${filteredRows.length} client${filteredRows.length !== 1 ? 's' : ''}`
            : `${filteredRows.length} entit${filteredRows.length !== 1 ? 'ies' : 'y'}`}
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
              // One row per client relationship, so a couple's joint account is
              // a single client here too — matching the sidebar. Archived
              // relationships are left out, as in the sidebar counts.
              const clientRows = clientGroups
                .filter(row => !isArchivedEntity(row.primary))
                .sort((a, b) => a.displayName.localeCompare(b.displayName));
              return (
                <div style={{ marginBottom: '2.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <span style={S.badge('#2563eb', 'rgba(37, 99, 235, 0.1)')}>Client</span>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                      Entities
                    </h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{clientRows.length}</span>
                  </div>
                  {clientRows.length === 0 ? (
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
                          {clientRows.map((row, i) => {
                            const ent = row.primary;
                            const typeDisplay = getEntityTypeDisplay(ent.type);
                            // Count the relationship's accounts once, however many
                            // of its holders appear on each one.
                            const memberIds = row.members.map(m => m._id);
                            const accountCount = allBankAccounts.filter(a =>
                              getAccountHolderIds(a).some(id => memberIds.includes(id))
                            ).length;
                            const statusDisplay = ClientEntityHelpers.getEntityStatusDisplay(getEntityComputedStatus(ent));
                            return (
                              <tr key={row.key}
                                onClick={() => { setSelectedEntityId(ent._id); }}
                                style={{ cursor: 'pointer', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)', transition: 'background 0.12s' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                                onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)'}
                              >
                                <td style={{ ...S.td, fontWeight: '600', color: 'var(--text-primary)' }}>
                                  {row.displayName}
                                  {row.isJoint && (
                                    <span style={{ ...S.badge('#8b5cf6', 'rgba(139, 92, 246, 0.12)'), marginLeft: '8px' }}
                                      title={row.members.map(m => getEntitySortName(m)).join(' & ')}>
                                      Joint
                                    </span>
                                  )}
                                </td>
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
                        const holders = getAccountHolderIds(acc)
                          .map(id => entities.find(e => e._id === id))
                          .filter(Boolean);
                        const ent = holders[0] || entities.find(e => e._id === acc.entityId);
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
                            <td style={{ ...S.td, fontWeight: '600', color: 'var(--text-primary)' }}>
                              {formatAccountName(acc.name) || getEntitySortName(ent) || '-'}
                              {isJointAccount(acc) && (
                                <span title={holders.map(h => getEntitySortName(h)).join(' & ')}
                                  style={{ marginLeft: '6px', padding: '1px 6px', borderRadius: '4px', fontSize: '0.68rem', fontWeight: '600', background: 'rgba(139, 92, 246, 0.12)', color: '#8b5cf6' }}>
                                  Joint · {holders.length}
                                </span>
                              )}
                            </td>
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
