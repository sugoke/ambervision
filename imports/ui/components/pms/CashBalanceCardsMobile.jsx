import React from 'react';
import { formatCurrency, getCurrencySymbol, getCurrencyFlag } from './pmsFormatters.js';
import { S, labelStyle, headlineRowStyle, cardStyle, dividerStyle } from './pmsMobileStyles.js';

/**
 * CashBalanceCardsMobile - phone rendering of the Cash Balances block.
 *
 * The desktop version is a 4-column table (Currency | Balance | Portfolio
 * Value | Account) which needs ~470px and therefore side-scrolls inside a
 * ~260px container on a phone. Here each currency becomes its own card with
 * the balance as the headline figure.
 *
 * Two deliberate differences from the table:
 *  - The currency code is spelled out next to the flag. A flag alone is not a
 *    reliable identifier, especially at reading distance.
 *  - The Account column's ">2 accounts collapses into a hover tooltip"
 *    behaviour is dropped: hover does not exist on touch, so every account
 *    code is listed. A card has the vertical room a table cell did not.
 */

const CashBalanceCardsMobile = ({
  cashByCurrency,
  portfolioCurrency,
  totalCashPortfolioValue,
  theme
}) => {
  const rows = Object.values(cashByCurrency);
  const currencyCount = Object.keys(cashByCurrency).length;

  const renderFlag = (currency) => {
    const FlagComponent = getCurrencyFlag(currency);
    if (FlagComponent) {
      return (
        <FlagComponent
          style={{ width: '2rem', height: 'auto', display: 'block', borderRadius: '2px', flexShrink: 0 }}
        />
      );
    }
    return (
      <span style={{ fontSize: '1.5rem', lineHeight: '1', fontWeight: '300', flexShrink: 0 }}>
        {getCurrencySymbol(currency)}
      </span>
    );
  };

  const figureStyle = (color) => ({
    fontSize: S.figure,
    fontWeight: '700',
    color: color || 'var(--text-primary)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: '1.2',
    whiteSpace: 'nowrap'
  });

  const detailValueStyle = {
    fontSize: S.value,
    color: 'var(--text-primary)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
    minWidth: 0,
    wordBreak: 'break-word'
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {rows.map((cash) => {
        const accounts = cash.positions
          .map((p) => p.portfolioCode)
          .filter((v, i, a) => v && a.indexOf(v) === i);
        // When the cash is already held in the portfolio currency the
        // converted value is the same number - showing it twice just adds noise.
        const showConverted = cash.currency !== portfolioCurrency;

        return (
          <div key={cash.currency} style={cardStyle(theme)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              {renderFlag(cash.currency)}
              <div style={{ fontSize: S.name, fontWeight: '600', color: 'var(--text-primary)' }}>
                {cash.currency}
              </div>
            </div>

            <div style={{ ...dividerStyle, display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <div style={headlineRowStyle}>
                <div style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>Balance</div>
                <div style={figureStyle(cash.totalValue < 0 ? 'var(--text-primary)' : null)}>
                  {formatCurrency(cash.totalValue, cash.currency)}
                </div>
              </div>

              {showConverted && (
                <div style={headlineRowStyle}>
                  <div style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>
                    Value ({portfolioCurrency})
                  </div>
                  <div style={{ ...detailValueStyle, whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                    {formatCurrency(cash.totalPortfolioValue, portfolioCurrency)}
                  </div>
                </div>
              )}

              {accounts.length > 0 && (
                <div style={headlineRowStyle}>
                  <div style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>
                    {accounts.length === 1 ? 'Account' : 'Accounts'}
                  </div>
                  <div style={{ ...detailValueStyle, color: 'var(--text-secondary)' }}>
                    {accounts.map((a) => (
                      <div key={a}>{a}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Total */}
      <div style={{
        ...cardStyle(theme),
        background: theme === 'light'
          ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.04) 100%)'
          : 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%)',
        borderColor: 'rgba(59, 130, 246, 0.35)'
      }}>
        <div style={{ fontSize: S.name, fontWeight: '600', color: 'var(--text-primary)' }}>
          Total cash
        </div>
        <div style={{ fontSize: S.label, color: 'var(--text-secondary)', marginTop: '0.125rem' }}>
          {currencyCount} {currencyCount === 1 ? 'currency' : 'currencies'}
        </div>

        <div style={{ ...dividerStyle, display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {currencyCount === 1 && (
            <div style={headlineRowStyle}>
              <div style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>Balance</div>
              <div style={figureStyle('var(--info-color)')}>
                {formatCurrency(rows[0].totalValue, rows[0].currency)}
              </div>
            </div>
          )}
          <div style={headlineRowStyle}>
            <div style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>
              Value ({portfolioCurrency})
            </div>
            <div style={figureStyle('var(--info-color)')}>
              {formatCurrency(totalCashPortfolioValue, portfolioCurrency)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CashBalanceCardsMobile;
