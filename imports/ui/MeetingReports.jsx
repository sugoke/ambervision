import React, { useState, useMemo, useCallback } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import AccountAutocomplete from './components/AccountAutocomplete.jsx';
import { useTheme } from './ThemeContext.jsx';
import { MeetingReportsCollection } from '/imports/api/meetingReports';

const MEETING_TYPES = { IN_PERSON: 'in_person', CALL: 'call' };
const SATISFACTION = {
  VERY_SATISFIED: 'very_satisfied',
  SATISFIED: 'satisfied',
  MODERATELY_SATISFIED: 'moderately_satisfied',
  DISSATISFIED: 'dissatisfied'
};

const today = () => new Date().toISOString().slice(0, 10);

const labels = (lang = 'fr') => lang === 'en' ? {
  newReport: '+ New report',
  back: '← Back',
  client: 'Client',
  pickClient: 'Search a client or account…',
  meetingType: 'Meeting type',
  inPerson: 'In-person meeting',
  call: 'Call',
  date: 'Date',
  location: 'Location',
  rawNotes: 'Raw notes (paste any element, in any order)',
  generate: 'Rewrite & enrich with AI',
  generating: 'Researching markets & rewriting (up to ~30s)…',
  object: 'Object / Description of the exchange',
  proposition: 'Investment proposition',
  complaint: 'Complaint',
  satisfaction: 'Client satisfaction',
  verySat: 'Very satisfied',
  sat: 'Satisfied',
  moderate: 'Moderately satisfied',
  dissat: 'Dissatisfied',
  saveDraft: 'Save draft',
  finalize: 'Finalize & download PDF',
  saving: 'Saving…',
  downloadPdf: 'Download PDF',
  open: 'Open',
  delete: 'Delete',
  list: 'Meeting reports',
  noReports: 'No reports yet — click "+ New report" to create one.',
  status: 'Status',
  manager: 'Manager',
  draft: 'Draft',
  finalized: 'Finalized'
} : {
  newReport: '+ Nouveau rapport',
  back: '← Retour',
  client: 'Client',
  pickClient: 'Rechercher un client ou un compte…',
  meetingType: 'Type d\'entretien',
  inPerson: 'Rendez-vous Client',
  call: 'Call Report',
  date: 'Date',
  location: 'Lieu',
  rawNotes: 'Notes brutes (collez tout ce qui vous vient, dans n\'importe quel ordre)',
  generate: 'Reformuler & enrichir avec l\'IA',
  generating: 'Recherche marché & reformulation (env. 30s)…',
  object: 'Objet / Descriptif de l\'échange',
  proposition: 'Proposition d\'investissement',
  complaint: 'Réclamation',
  satisfaction: 'Niveau de satisfaction client',
  verySat: 'Très Satisfait',
  sat: 'Satisfait',
  moderate: 'Moyennement Satisfait',
  dissat: 'Mécontent',
  saveDraft: 'Enregistrer brouillon',
  finalize: 'Finaliser & télécharger PDF',
  saving: 'Enregistrement…',
  downloadPdf: 'Télécharger PDF',
  open: 'Ouvrir',
  delete: 'Supprimer',
  list: 'Rapports de visite',
  noReports: 'Aucun rapport — cliquez sur "+ Nouveau rapport" pour commencer.',
  status: 'Statut',
  manager: 'Gestionnaire',
  draft: 'Brouillon',
  finalized: 'Finalisé'
};

const inputBase = {
  width: '100%',
  padding: '10px 12px',
  fontSize: '13px',
  border: '1px solid var(--border-color)',
  borderRadius: '6px',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
  fontFamily: 'inherit'
};

function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div style={{
      padding: '10px 14px',
      background: 'rgba(220, 53, 69, 0.1)',
      border: '1px solid rgba(220, 53, 69, 0.3)',
      borderRadius: 6,
      color: '#dc3545',
      fontSize: 13,
      marginBottom: 12
    }}>
      {error}
    </div>
  );
}

function ListView({ reports, isLoading, t, onOpen, onNew, onDelete, onDownload }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--text-primary)' }}>{t.list}</h2>
        <button
          onClick={onNew}
          style={{
            padding: '10px 18px',
            background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >{t.newReport}</button>
      </div>

      {isLoading ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>…</div>
      ) : reports.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-secondary)', borderRadius: 8 }}>
          {t.noReports}
        </div>
      ) : (
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px' }}>{t.client}</th>
                <th style={{ padding: '10px 14px' }}>{t.date}</th>
                <th style={{ padding: '10px 14px' }}>{t.meetingType}</th>
                <th style={{ padding: '10px 14px' }}>{t.status}</th>
                <th style={{ padding: '10px 14px' }}>{t.manager}</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <tr key={r._id} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '10px 14px' }}>{r.clientNameSnapshot || '—'}</td>
                  <td style={{ padding: '10px 14px' }}>{r.meetingDate ? new Date(r.meetingDate).toLocaleDateString() : ''}</td>
                  <td style={{ padding: '10px 14px' }}>{r.meetingType === MEETING_TYPES.CALL ? t.call : t.inPerson}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      background: r.status === 'finalized' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                      color: r.status === 'finalized' ? '#16a34a' : '#d97706'
                    }}>{r.status === 'finalized' ? t.finalized : t.draft}</span>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>{r.managerNameSnapshot || ''}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => onOpen(r._id)} style={btnGhost}>{t.open}</button>
                    <button onClick={() => onDownload(r._id)} style={{ ...btnGhost, marginLeft: 6 }}>{t.downloadPdf}</button>
                    <button onClick={() => onDelete(r._id)} style={{ ...btnGhost, marginLeft: 6, color: '#dc3545' }}>{t.delete}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const btnGhost = {
  padding: '5px 10px',
  background: 'transparent',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 12
};

function Editor({ initial, t, onCancel, onSaved }) {
  const [client, setClient] = useState({
    entityId: initial?.entityId || null,
    bankAccountId: initial?.bankAccountId || null,
    clientName: initial?.clientNameSnapshot || '',
    accountNumber: initial?.accountNumberSnapshot || '',
    bankName: initial?.bankNameSnapshot || '',
    label: initial?.clientNameSnapshot
      ? `${initial.clientNameSnapshot}${initial.accountNumberSnapshot ? ' — ' + initial.accountNumberSnapshot : ''}`
      : ''
  });
  const [meetingType, setMeetingType] = useState(initial?.meetingType || MEETING_TYPES.IN_PERSON);
  const [meetingDate, setMeetingDate] = useState(
    initial?.meetingDate ? new Date(initial.meetingDate).toISOString().slice(0, 10) : today()
  );
  const [location, setLocation] = useState(initial?.location || '');
  const [rawNotes, setRawNotes] = useState(initial?.rawNotes || '');
  const [object, setObject] = useState(initial?.sections?.object || '');
  const [proposition, setProposition] = useState(initial?.sections?.proposition || '');
  const [complaint, setComplaint] = useState(initial?.sections?.complaint || '');
  const [satisfaction, setSatisfaction] = useState(initial?.satisfaction || SATISFACTION.SATISFIED);
  const [language, setLanguage] = useState(initial?.language || 'fr');
  const [meetingReportId, setMeetingReportId] = useState(initial?._id || null);

  const [error, setError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleClientSelect = (sel) => {
    setClient({
      entityId: sel.entityId,
      bankAccountId: sel.bankAccountId,
      clientName: sel.clientName,
      // Bank/account snapshots are resolved authoritatively server-side
      // from bankAccountId — no need to parse the label string here.
      accountNumber: '',
      bankName: '',
      label: sel.accountLabel
    });
  };

  const handleGenerate = async () => {
    setError(null);
    if (!rawNotes.trim()) {
      setError(t.rawNotes);
      return;
    }
    setIsGenerating(true);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const res = await Meteor.callAsync('meetingReports.rewrite', sessionId, {
        rawNotes,
        clientNameSnapshot: client.clientName,
        meetingDate,
        meetingType,
        location
      });
      setObject(res.object);
      setProposition(res.proposition);
      setComplaint(res.complaint);
      setLanguage(res.language || 'fr');
    } catch (err) {
      setError(err.reason || err.message || 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const buildSavePayload = () => ({
    meetingReportId: meetingReportId || undefined,
    entityId: client.entityId || undefined,
    bankAccountId: client.bankAccountId || undefined,
    clientNameSnapshot: client.clientName,
    accountNumberSnapshot: client.accountNumber,
    bankNameSnapshot: client.bankName,
    meetingType,
    meetingDate,
    location,
    language,
    rawNotes,
    sections: { object, proposition, complaint },
    satisfaction
  });

  const validate = () => {
    if (!client.clientName) { setError(t.pickClient); return false; }
    if (!object.trim() || !proposition.trim() || !complaint.trim()) {
      setError(t.generate);
      return false;
    }
    return true;
  };

  const handleSaveDraft = async () => {
    setError(null);
    if (!validate()) return;
    setIsSaving(true);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const res = await Meteor.callAsync('meetingReports.saveDraft', sessionId, buildSavePayload());
      setMeetingReportId(res._id);
      onSaved && onSaved();
    } catch (err) {
      setError(err.reason || err.message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalize = async () => {
    setError(null);
    if (!validate()) return;
    setIsSaving(true);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const saved = await Meteor.callAsync('meetingReports.saveDraft', sessionId, buildSavePayload());
      const id = saved._id;
      setMeetingReportId(id);
      const finalized = await Meteor.callAsync('meetingReports.finalize', sessionId, id);
      if (finalized.url) window.open(finalized.url, '_blank');
      onSaved && onSaved();
    } catch (err) {
      setError(err.reason || err.message || 'Finalize failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button onClick={onCancel} style={{ ...btnGhost, padding: '6px 12px' }}>{t.back}</button>
        {language && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            {language}
          </span>
        )}
      </div>

      <ErrorBanner error={error} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Field label={t.client}>
          <AccountAutocomplete
            onSelect={handleClientSelect}
            value={client.label}
            placeholder={t.pickClient}
          />
        </Field>
        <Field label={t.date}>
          <input type="date" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} style={inputBase} />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Field label={t.meetingType}>
          <div style={{ display: 'flex', gap: 16, paddingTop: 6 }}>
            <RadioOption checked={meetingType === MEETING_TYPES.IN_PERSON} onChange={() => setMeetingType(MEETING_TYPES.IN_PERSON)} label={t.inPerson} />
            <RadioOption checked={meetingType === MEETING_TYPES.CALL} onChange={() => setMeetingType(MEETING_TYPES.CALL)} label={t.call} />
          </div>
        </Field>
        <Field label={t.location}>
          <input type="text" value={location} onChange={e => setLocation(e.target.value)} style={inputBase} placeholder="Monaco, Geneva, Paris…" />
        </Field>
      </div>

      <Field label={t.rawNotes}>
        <textarea
          value={rawNotes}
          onChange={e => setRawNotes(e.target.value)}
          rows={8}
          style={{ ...inputBase, minHeight: 140, resize: 'vertical' }}
        />
      </Field>

      <div style={{ marginTop: 8, marginBottom: 20 }}>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !rawNotes.trim()}
          style={{
            padding: '10px 18px',
            background: isGenerating ? '#9ca3af' : 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: isGenerating || !rawNotes.trim() ? 'not-allowed' : 'pointer',
            opacity: !rawNotes.trim() ? 0.6 : 1
          }}
        >{isGenerating ? `⏳ ${t.generating}` : `✨ ${t.generate}`}</button>
      </div>

      <Field label={t.object}>
        <textarea value={object} onChange={e => setObject(e.target.value)} rows={7} style={{ ...inputBase, minHeight: 130, resize: 'vertical' }} />
      </Field>

      <Field label={t.proposition}>
        <textarea value={proposition} onChange={e => setProposition(e.target.value)} rows={8} style={{ ...inputBase, minHeight: 150, resize: 'vertical' }} />
      </Field>

      <Field label={t.complaint}>
        <textarea value={complaint} onChange={e => setComplaint(e.target.value)} rows={3} style={{ ...inputBase, minHeight: 60, resize: 'vertical' }} />
      </Field>

      <Field label={t.satisfaction}>
        <div style={{ display: 'flex', gap: 18, paddingTop: 6, flexWrap: 'wrap' }}>
          <RadioOption checked={satisfaction === SATISFACTION.VERY_SATISFIED} onChange={() => setSatisfaction(SATISFACTION.VERY_SATISFIED)} label={t.verySat} />
          <RadioOption checked={satisfaction === SATISFACTION.SATISFIED} onChange={() => setSatisfaction(SATISFACTION.SATISFIED)} label={t.sat} />
          <RadioOption checked={satisfaction === SATISFACTION.MODERATELY_SATISFIED} onChange={() => setSatisfaction(SATISFACTION.MODERATELY_SATISFIED)} label={t.moderate} />
          <RadioOption checked={satisfaction === SATISFACTION.DISSATISFIED} onChange={() => setSatisfaction(SATISFACTION.DISSATISFIED)} label={t.dissat} />
        </div>
      </Field>

      <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
        <button onClick={handleSaveDraft} disabled={isSaving} style={{
          padding: '10px 18px',
          background: 'transparent',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          fontSize: 13,
          cursor: isSaving ? 'wait' : 'pointer'
        }}>{isSaving ? t.saving : t.saveDraft}</button>
        <button onClick={handleFinalize} disabled={isSaving} style={{
          padding: '10px 18px',
          background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
          color: 'white',
          border: 'none',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          cursor: isSaving ? 'wait' : 'pointer',
          opacity: isSaving ? 0.7 : 1
        }}>{isSaving ? t.saving : `📄 ${t.finalize}`}</button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function RadioOption({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
      <input type="radio" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

export default function MeetingReports({ user }) {
  const { isDark } = useTheme();
  const t = labels(user?.profile?.preferredLanguage === 'en' ? 'en' : 'fr');

  const sub = useMemo(() => {
    const sessionId = localStorage.getItem('sessionId');
    return Meteor.subscribe('meetingReports.list', sessionId, {});
  }, []);

  const { reports, isLoading } = useTracker(() => ({
    reports: MeetingReportsCollection.find(
      { status: { $ne: 'deleted' } },
      { sort: { createdAt: -1 } }
    ).fetch(),
    isLoading: !sub.ready()
  }), [sub]);

  const [view, setView] = useState({ mode: 'list', initial: null });

  const handleOpen = useCallback(async (id) => {
    try {
      const sessionId = localStorage.getItem('sessionId');
      const doc = await Meteor.callAsync('meetingReports.get', sessionId, id);
      setView({ mode: 'edit', initial: doc });
    } catch (err) {
      alert(err.reason || err.message || 'Could not open report');
    }
  }, []);

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm(t.delete + '?')) return;
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('meetingReports.delete', sessionId, id);
    } catch (err) {
      alert(err.reason || err.message || 'Delete failed');
    }
  }, [t]);

  const handleDownload = useCallback(async (id) => {
    try {
      const sessionId = localStorage.getItem('sessionId');
      const res = await Meteor.callAsync('meetingReports.generatePdf', sessionId, id);
      if (res.url) window.open(res.url, '_blank');
    } catch (err) {
      alert(err.reason || err.message || 'PDF generation failed');
    }
  }, []);

  return (
    <div style={{
      maxWidth: 1100,
      margin: '0 auto',
      padding: '8px 4px',
      color: 'var(--text-primary)'
    }}>
      {view.mode === 'list' ? (
        <ListView
          reports={reports}
          isLoading={isLoading}
          t={t}
          onOpen={handleOpen}
          onNew={() => setView({ mode: 'edit', initial: null })}
          onDelete={handleDelete}
          onDownload={handleDownload}
        />
      ) : (
        <Editor
          initial={view.initial}
          t={t}
          onCancel={() => setView({ mode: 'list', initial: null })}
          onSaved={() => setView({ mode: 'list', initial: null })}
        />
      )}
    </div>
  );
}
