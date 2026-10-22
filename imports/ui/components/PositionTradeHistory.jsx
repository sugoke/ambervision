import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import Modal from './common/Modal.jsx';

/**
 * PositionTradeHistory - small round-trip icon next to the ISIN that opens the buy / sell
 * history of this security in this account: every trade, the FIFO round trips with their
 * realized result, and the lots still open.
 *
 * Display only: the server (pms.getPositionTradeHistory) computes and formats everything.
 */
const th = { textAlign: 'right', padding: '0.4rem 0.6rem', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' };
const td = { textAlign: 'right', padding: '0.4rem 0.6rem', fontSize: '0.8rem', borderBottom: '1px solid var(--border-color)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const left = { textAlign: 'left' };
const sectionTitle = { fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '1.1rem 0 0.4rem' };

const Table = ({ columns, rows, render }) => (
  <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>{columns.map((c, i) => <th key={c} style={{ ...th, ...(i === 0 ? left : null) }}>{c}</th>)}</tr>
      </thead>
      <tbody>{rows.map(render)}</tbody>
    </table>
  </div>
);

const Stat = ({ label, value, color }) => (
  <div>
    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: color || 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
  </div>
);

const PositionTradeHistory = ({ isin, securityName, bankId, portfolioCode, priceType, sessionId }) => {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  if (!isin || !bankId || !portfolioCode || portfolioCode === 'CONSOLIDATED') return null;

  const handleClick = async (e) => {
    e.stopPropagation();
    setShowModal(true);
    if (data) return;
    setLoading(true);
    setError(null);
    try {
      setData(await Meteor.callAsync('pms.getPositionTradeHistory', { sessionId, isin, bankId, portfolioCode, priceType }));
    } catch (err) {
      setError(err.reason || err.message || 'Failed to load the trade history');
    } finally {
      setLoading(false);
    }
  };

  const gain = 'var(--gain-color)';
  const loss = 'var(--loss-color)';

  return (
    <>
      <span
        onClick={handleClick}
        title={`Buy / sell history for ${isin}`}
        style={{ cursor: 'pointer', opacity: loading ? 0.5 : 0.6, marginLeft: '0.3rem', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = loading ? '0.5' : '0.6'; }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ display: 'block' }}>
          <path d="M2 4.5h9M8.5 2l2.5 2.5L8.5 7" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 9.5H3M5.5 7L3 9.5 5.5 12" stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={`Trade history · ${securityName || isin}`} size="large">
        {loading && <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading trade history...</div>}
        {error && !loading && <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>{error}</div>}

        {data && !loading && !data.hasTrades && (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No buy or sell on this security in the bank files for this account.
          </div>
        )}

        {data && !loading && data.hasTrades && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.75rem', padding: '0 0.25rem' }}>
              <Stat label={`Bought${data.currency ? ` (${data.currency})` : ''}`} value={data.summary.boughtFormatted} />
              <Stat label={`Sold${data.currency ? ` (${data.currency})` : ''}`} value={data.summary.soldFormatted} />
              <Stat label="Fees" value={data.summary.feesFormatted} />
              {data.summary.realizedFormatted && (
                <Stat label={`Realized (${data.summary.roundTripCount} round trip${data.summary.roundTripCount > 1 ? 's' : ''})`} value={data.summary.realizedFormatted} color={data.summary.realizedIsPositive ? gain : loss} />
              )}
            </div>

            {data.closed.length > 0 && (
              <>
                <div style={sectionTitle}>Round trips (first in, first out)</div>
                <Table
                  columns={['Opened', 'Closed', 'Held', 'Qty', 'Buy', 'Sell', 'Result']}
                  rows={data.closed}
                  render={(c, i) => (
                    <tr key={i}>
                      <td style={{ ...td, ...left }}>{c.openDateFormatted}</td>
                      <td style={td}>{c.closeDateFormatted}</td>
                      <td style={td}>{c.daysFormatted}</td>
                      <td style={td}>{c.quantityFormatted}</td>
                      <td style={td}>{c.buyUnitFormatted}</td>
                      <td style={td}>{c.sellUnitFormatted}</td>
                      <td style={{ ...td, fontWeight: 600, color: c.isPositive ? gain : loss }}>
                        {c.pnlFormatted}{c.pnlPercentFormatted ? ` (${c.pnlPercentFormatted})` : ''}
                      </td>
                    </tr>
                  )}
                />
              </>
            )}

            {data.open.length > 0 && (
              <>
                <div style={sectionTitle}>Still held</div>
                <Table
                  columns={['Bought', 'Qty', 'Buy', `Cost${data.currency ? ` (${data.currency})` : ''}`]}
                  rows={data.open}
                  render={(o, i) => (
                    <tr key={i}>
                      <td style={{ ...td, ...left }}>{o.dateFormatted}</td>
                      <td style={td}>{o.quantityFormatted}</td>
                      <td style={td}>{o.buyUnitFormatted}</td>
                      <td style={td}>{o.costFormatted}</td>
                    </tr>
                  )}
                />
              </>
            )}

            <div style={sectionTitle}>All trades</div>
            <Table
              columns={['Date', 'Side', 'Qty', 'Price', `Amount${data.currency ? ` (${data.currency})` : ''}`, 'Fees']}
              rows={data.trades}
              render={(t) => (
                <tr key={t.id}>
                  <td style={{ ...td, ...left }}>{t.dateFormatted}</td>
                  <td style={{ ...td, fontWeight: 600, color: t.side === 'BUY' ? gain : loss }}>{t.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                  <td style={td}>{t.quantityFormatted}</td>
                  <td style={td}>{t.unitFormatted}</td>
                  <td style={td}>{t.amountFormatted}</td>
                  <td style={td}>{t.feesFormatted}</td>
                </tr>
              )}
            />

            <div style={{ marginTop: '0.9rem', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Built from the bank's operation files for this account{data.firstOperationDate ? `, the first of which is dated ${data.firstOperationDate}` : ''}; earlier trades are not included.
              {data.unmatchedSoldQuantityFormatted && ` ${data.unmatchedSoldQuantityFormatted} units sold have no matching purchase in these files, so they are left out of the round trips.`}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default PositionTradeHistory;
