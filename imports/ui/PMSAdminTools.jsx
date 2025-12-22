import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import { useTheme } from './ThemeContext.jsx';

const PMSAdminTools = () => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [unmappedData, setUnmappedData] = useState(null);
  const [migrationResult, setMigrationResult] = useState(null);
  const [activeTab, setActiveTab] = useState('unmapped'); // 'unmapped' or 'migration'

  const sessionId = typeof window !== 'undefined' ? localStorage.getItem('sessionId') : null;

  const handleGetUnmappedCodes = async () => {
    setLoading(true);
    try {
      const result = await Meteor.callAsync('pms.getUnmappedPortfolioCodes', { sessionId });
      setUnmappedData(result);
    } catch (error) {
      console.error('Error fetching unmapped codes:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunFullMigration = async () => {
    if (!confirm('This will re-link ALL existing PMS holdings, operations, and snapshots to correct users. Continue?')) {
      return;
    }

    setLoading(true);
    setMigrationResult(null);
    try {
      const result = await Meteor.callAsync('pms.runFullMigration', { sessionId });
      setMigrationResult(result);
      alert('Migration completed successfully!');
    } catch (error) {
      console.error('Error running migration:', error);
      alert(`Migration failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunHoldingsMigration = async () => {
    if (!confirm('This will re-link existing PMS holdings to correct users. Continue?')) {
      return;
    }

    setLoading(true);
    try {
      const result = await Meteor.callAsync('pms.relinkHoldingsToUsers', { sessionId });
      setMigrationResult({ holdings: result });
      alert(`Holdings migration completed: ${result.matched} matched, ${result.unmatchedCount} unmapped`);
    } catch (error) {
      console.error('Error running holdings migration:', error);
      alert(`Migration failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRunOperationsMigration = async () => {
    if (!confirm('This will re-link existing PMS operations to correct users. Continue?')) {
      return;
    }

    setLoading(true);
    try {
      const result = await Meteor.callAsync('pms.relinkOperationsToUsers', { sessionId });
      setMigrationResult({ operations: result });
      alert(`Operations migration completed: ${result.matched} matched, ${result.unmatchedCount} unmapped`);
    } catch (error) {
      console.error('Error running operations migration:', error);
      alert(`Migration failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDiagnoseHoldings = async () => {
    setLoading(true);
    try {
      const result = await Meteor.callAsync('pms.diagnoseHoldingsState', { sessionId });
      console.log('[PMS DIAGNOSTIC] Database state:', result);

      const message = `Holdings Database Diagnostic:

Total Holdings: ${result.totalHoldings}
Active Holdings: ${result.activeHoldings}
With isLatest=true: ${result.withIsLatestTrue}
With isLatest=false: ${result.withIsLatestFalse}
Without isLatest field: ${result.withoutIsLatest}
Active with isLatest=true: ${result.activeWithIsLatestTrue}

${result.problem ? '⚠️ PROBLEM DETECTED: No active holdings have isLatest=true!' : '✅ Holdings state looks OK'}

Check browser console for sample records.`;

      alert(message);
    } catch (error) {
      console.error('Error running diagnostic:', error);
      alert(`Diagnostic failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSetIsLatestFlag = async () => {
    if (!confirm('This will set the isLatest flag on all existing holdings that don\'t have versioning. This is required for holdings to show up. Continue?')) {
      return;
    }

    setLoading(true);
    try {
      const result = await Meteor.callAsync('pms.setIsLatestFlag', { sessionId });
      alert(`isLatest flag migration completed: ${result.updated} holdings updated`);
      // Reload the page to refresh the holdings
      window.location.reload();
    } catch (error) {
      console.error('Error running isLatest migration:', error);
      alert(`Migration failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '2rem', color: 'var(--text-primary)' }}>
        PMS Admin Tools
      </h1>

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <button
          onClick={() => setActiveTab('unmapped')}
          style={{
            padding: '0.75rem 1.5rem',
            background: activeTab === 'unmapped' ? 'var(--accent-color)' : 'var(--bg-secondary)',
            color: activeTab === 'unmapped' ? '#fff' : 'var(--text-primary)',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '500',
            transition: 'all 0.2s ease'
          }}
        >
          Unmapped Portfolio Codes
        </button>
        <button
          onClick={() => setActiveTab('migration')}
          style={{
            padding: '0.75rem 1.5rem',
            background: activeTab === 'migration' ? 'var(--accent-color)' : 'var(--bg-secondary)',
            color: activeTab === 'migration' ? '#fff' : 'var(--text-primary)',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '500',
            transition: 'all 0.2s ease'
          }}
        >
          Data Migration
        </button>
      </div>

      {/* Unmapped Codes Tab */}
      {activeTab === 'unmapped' && (
        <LiquidGlassCard>
          <div style={{ padding: '1.5rem' }}>
            <h2 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Unmapped Portfolio Codes
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              These portfolio codes exist in PMS data but have no matching bank account configuration.
              Create bank accounts with matching account numbers to link this data to clients.
            </p>

            <button
              onClick={handleGetUnmappedCodes}
              disabled={loading}
              style={{
                padding: '0.75rem 1.5rem',
                background: 'var(--accent-color)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: '500',
                opacity: loading ? 0.6 : 1,
                marginBottom: '1.5rem'
              }}
            >
              {loading ? 'Loading...' : 'Scan for Unmapped Codes'}
            </button>

            {unmappedData && (
              <div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: '1rem',
                  marginBottom: '2rem'
                }}>
                  <div style={{
                    padding: '1.5rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '8px',
                    border: '2px solid rgba(239, 68, 68, 0.3)'
                  }}>
                    <div style={{ fontSize: '2rem', color: '#ef4444', marginBottom: '0.5rem' }}>
                      {unmappedData.totalUnmappedHoldings}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      Unmapped Holdings
                    </div>
                  </div>

                  <div style={{
                    padding: '1.5rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '8px',
                    border: '2px solid rgba(239, 68, 68, 0.3)'
                  }}>
                    <div style={{ fontSize: '2rem', color: '#ef4444', marginBottom: '0.5rem' }}>
                      {unmappedData.totalUnmappedOperations}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      Unmapped Operations
                    </div>
                  </div>
                </div>

                {/* Holdings Table */}
                {unmappedData.unmappedHoldings.length > 0 && (
                  <div style={{ marginBottom: '2rem' }}>
                    <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
                      Unmapped Holdings Portfolio Codes
                    </h3>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                            <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--text-muted)' }}>
                              Portfolio Code
                            </th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--text-muted)' }}>
                              Bank
                            </th>
                            <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                              Holdings Count
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {unmappedData.unmappedHoldings.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '0.75rem', color: 'var(--accent-color)', fontFamily: 'monospace' }}>
                                {item.portfolioCode}
                              </td>
                              <td style={{ padding: '0.75rem', color: 'var(--text-primary)' }}>
                                {item.bankName}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)' }}>
                                {item.count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Operations Table */}
                {unmappedData.unmappedOperations.length > 0 && (
                  <div>
                    <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
                      Unmapped Operations Portfolio Codes
                    </h3>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                            <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--text-muted)' }}>
                              Portfolio Code
                            </th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', color: 'var(--text-muted)' }}>
                              Bank
                            </th>
                            <th style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                              Operations Count
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {unmappedData.unmappedOperations.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '0.75rem', color: 'var(--accent-color)', fontFamily: 'monospace' }}>
                                {item.portfolioCode}
                              </td>
                              <td style={{ padding: '0.75rem', color: 'var(--text-primary)' }}>
                                {item.bankName}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-primary)' }}>
                                {item.count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {unmappedData.unmappedHoldings.length === 0 && unmappedData.unmappedOperations.length === 0 && (
                  <div style={{
                    padding: '3rem',
                    textAlign: 'center',
                    background: 'rgba(16, 185, 129, 0.1)',
                    borderRadius: '8px',
                    border: '2px solid rgba(16, 185, 129, 0.3)'
                  }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                    <div style={{ color: '#10b981', fontSize: '1.25rem', fontWeight: '500' }}>
                      All portfolio codes are mapped!
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                      No unmapped data found in the system.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </LiquidGlassCard>
      )}

      {/* Migration Tab */}
      {activeTab === 'migration' && (
        <LiquidGlassCard>
          <div style={{ padding: '1.5rem' }}>
            <h2 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
              Data Migration
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
              Re-link existing PMS data to correct users based on portfolio code matching to bank accounts.
              This updates the userId field for holdings, operations, and snapshots.
            </p>

            <div style={{
              padding: '1rem',
              background: 'rgba(234, 179, 8, 0.1)',
              border: '2px solid rgba(234, 179, 8, 0.3)',
              borderRadius: '8px',
              marginBottom: '2rem'
            }}>
              <div style={{ color: '#eab308', fontWeight: '500', marginBottom: '0.5rem' }}>
                ⚠️ Warning
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Migration will modify existing database records. Make sure you have bank accounts configured
                with matching account numbers before running migration. Unmapped data will remain unchanged.
              </div>
            </div>

            <div style={{ display: 'grid', gap: '1rem', marginBottom: '2rem' }}>
              <button
                onClick={handleDiagnoseHoldings}
                disabled={loading}
                style={{
                  padding: '1rem',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: '500',
                  fontSize: '1rem',
                  opacity: loading ? 0.6 : 1,
                  transition: 'opacity 0.2s ease'
                }}
              >
                {loading ? 'Running Diagnostic...' : '🔍 Diagnose Holdings Database State'}
              </button>

              <button
                onClick={handleSetIsLatestFlag}
                disabled={loading}
                style={{
                  padding: '1rem',
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: '500',
                  fontSize: '1rem',
                  opacity: loading ? 0.6 : 1,
                  transition: 'opacity 0.2s ease'
                }}
              >
                {loading ? 'Running Migration...' : '🔧 Fix Holdings Visibility (Set isLatest Flag)'}
              </button>

              <button
                onClick={handleRunFullMigration}
                disabled={loading}
                style={{
                  padding: '1rem',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: '500',
                  fontSize: '1rem',
                  opacity: loading ? 0.6 : 1,
                  transition: 'opacity 0.2s ease'
                }}
              >
                {loading ? 'Running Migration...' : '🚀 Run Full Migration (Holdings + Operations + Snapshots)'}
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                <button
                  onClick={handleRunHoldingsMigration}
                  disabled={loading}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--accent-color)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontWeight: '500',
                    opacity: loading ? 0.6 : 1
                  }}
                >
                  Migrate Holdings Only
                </button>

                <button
                  onClick={handleRunOperationsMigration}
                  disabled={loading}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--accent-color)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontWeight: '500',
                    opacity: loading ? 0.6 : 1
                  }}
                >
                  Migrate Operations Only
                </button>
              </div>
            </div>

            {/* Migration Results */}
            {migrationResult && (
              <div>
                <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
                  Migration Results
                </h3>

                {migrationResult.summary && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '1rem',
                    marginBottom: '2rem'
                  }}>
                    <div style={{
                      padding: '1.5rem',
                      background: 'rgba(16, 185, 129, 0.1)',
                      borderRadius: '8px',
                      border: '2px solid rgba(16, 185, 129, 0.3)'
                    }}>
                      <div style={{ fontSize: '2rem', color: '#10b981', marginBottom: '0.5rem' }}>
                        {migrationResult.summary.totalMatched}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        Total Matched & Updated
                      </div>
                    </div>

                    <div style={{
                      padding: '1.5rem',
                      background: 'rgba(239, 68, 68, 0.1)',
                      borderRadius: '8px',
                      border: '2px solid rgba(239, 68, 68, 0.3)'
                    }}>
                      <div style={{ fontSize: '2rem', color: '#ef4444', marginBottom: '0.5rem' }}>
                        {migrationResult.summary.totalUnmapped}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        Total Unmapped (Skipped)
                      </div>
                    </div>
                  </div>
                )}

                {/* Holdings Results */}
                {migrationResult.holdings && (
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Holdings Migration</h4>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      Processed: {migrationResult.holdings.totalProcessed} |
                      Matched: <span style={{ color: '#10b981' }}>{migrationResult.holdings.matched}</span> |
                      Unmapped: <span style={{ color: '#ef4444' }}>{migrationResult.holdings.unmatchedCount}</span>
                    </div>
                  </div>
                )}

                {/* Operations Results */}
                {migrationResult.operations && (
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Operations Migration</h4>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      Processed: {migrationResult.operations.totalProcessed} |
                      Matched: <span style={{ color: '#10b981' }}>{migrationResult.operations.matched}</span> |
                      Unmapped: <span style={{ color: '#ef4444' }}>{migrationResult.operations.unmatchedCount}</span>
                    </div>
                  </div>
                )}

                {/* Snapshots Results */}
                {migrationResult.snapshots && (
                  <div style={{ marginBottom: '2rem' }}>
                    <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Snapshots Migration</h4>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      Processed: {migrationResult.snapshots.totalProcessed} |
                      Matched: <span style={{ color: '#10b981' }}>{migrationResult.snapshots.matched}</span> |
                      Unmapped: <span style={{ color: '#ef4444' }}>{migrationResult.snapshots.unmatchedCount}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </LiquidGlassCard>
      )}
    </div>
  );
};

export default PMSAdminTools;
