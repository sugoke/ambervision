import React from 'react';
import { BUILT_IN_TEMPLATES } from '/imports/api/templates';

const SummaryModule = ({ 
  selectedTemplateId, 
  productDetails, 
  underlyings, 
  observationSchedule,
  droppedItems,
  basketMode,
  structureParams,
  onSaveProduct,
  editingProduct
}) => {

  // Get selected template information
  const selectedTemplate = selectedTemplateId ? 
    BUILT_IN_TEMPLATES.find(t => t._id === selectedTemplateId) : null;

  // Extract actual configuration values from structure params and schedule
  const extractConfiguredValues = () => {
    // Use structureParams as primary source, fallback to extracting from droppedItems
    let config = {
      couponRate: 8.5,
      autocallBarrier: 100,
      protectionBarrier: 70,
      couponBarrier: 65,
      frequency: 'Quarterly',
      nonCallPeriods: 0,
      totalPeriods: 0,
      hasMemory: true,
      hasAutocall: true,
      hasProtection: true
    };

    // Use structureParams if available
    if (structureParams) {
      config.couponRate = structureParams.couponRate || 8.5;
      config.protectionBarrier = structureParams.protectionBarrierLevel || 70;
      config.autocallBarrier = 100; // This could be derived from template
      config.couponBarrier = structureParams.memoryBarrier || structureParams.couponBarrier || 65;
      config.hasMemory = structureParams.memoryCoupon !== false || structureParams.memoryAutocall !== false;
      config.hasAutocall = structureParams.memoryAutocall !== false;
      config.hasProtection = true;
    }

    // Extract observation frequency from schedule
    if (observationSchedule && observationSchedule.length > 0) {
      const totalDays = observationSchedule.length > 1 ? 
        Math.abs(new Date(observationSchedule[1].observationDate) - new Date(observationSchedule[0].observationDate)) / (1000 * 60 * 60 * 24) : 0;
      
      if (totalDays <= 31) config.frequency = 'Monthly';
      else if (totalDays <= 93) config.frequency = 'Quarterly';
      else if (totalDays <= 186) config.frequency = 'Semi-Annual';
      else config.frequency = 'Annual';
    }

    // Extract schedule information
    config.nonCallPeriods = observationSchedule.filter(item => !item.isCallable).length;
    config.totalPeriods = observationSchedule.length;

    // Fallback to droppedItems extraction if needed
    if (!structureParams || observationSchedule.length === 0) {
      // Handle both formats: flat array or {life: [], maturity: []} object
      let allItems = [];
      if (Array.isArray(droppedItems)) {
        allItems = droppedItems;
      } else if (droppedItems && typeof droppedItems === 'object') {
        allItems = [...(droppedItems.life || []), ...(droppedItems.maturity || [])];
      }
      
      // Extract from droppedItems as fallback
      const barriers = allItems.filter(item => item.type === 'BARRIER');
      const actions = allItems.filter(item => item.type === 'ACTION');
      
      if (barriers.length > 0) {
        config.autocallBarrier = barriers.find(b => b.barrier_type === 'autocall')?.barrier_level || config.autocallBarrier;
        config.protectionBarrier = barriers.find(b => b.barrier_type === 'protection')?.barrier_level || config.protectionBarrier;
        config.couponBarrier = barriers.find(b => b.barrier_type === 'coupon')?.barrier_level || config.couponBarrier;
      }
      
      if (actions.length > 0) {
        const couponAction = actions.find(a => a.value?.includes('Coupon') || a.value?.includes('%'));
        if (couponAction) {
          const match = couponAction.value.match(/(\d+\.?\d*)%/);
          if (match) config.couponRate = parseFloat(match[1]);
        }
      }
    }

    return config;
  };

  const config = extractConfiguredValues();

  // Common styles
  const cardStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    boxShadow: '0 2px 8px var(--shadow)'
  };

  const titleStyle = {
    margin: '0 0 1rem 0',
    color: 'var(--text-primary)',
    fontSize: '1.1rem',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  };

  const infoRowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 0',
    borderBottom: '1px solid var(--border-color)',
    fontSize: '0.9rem'
  };

  const labelStyle = {
    fontWeight: '600',
    color: 'var(--text-secondary)'
  };

  const valueStyle = {
    color: 'var(--text-primary)',
    fontWeight: '500'
  };

  // Phoenix Autocallable Summary
  const renderPhoenixSummary = () => (
    <div>
      <div style={cardStyle}>
        <h3 style={titleStyle}>
          🔥 Phoenix Autocallable Product Summary
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          <div>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Product Structure
            </h4>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Product Type:</span>
              <span style={valueStyle}>Phoenix Autocallable</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Memory Feature:</span>
              <span style={valueStyle}>
                {(() => {
                  const features = [];
                  if (structureParams?.memoryCoupon !== false) features.push('Coupon');
                  if (structureParams?.memoryAutocall !== false) features.push('Autocall');
                  return features.length > 0 ? features.join(' + ') : 'None';
                })()}
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Observation Frequency:</span>
              <span style={valueStyle}>{config.frequency}</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Capital Protection:</span>
              <span style={valueStyle}>{config.protectionBarrier}% at Maturity</span>
            </div>
            <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
              <span style={labelStyle}>Early Redemption:</span>
              <span style={valueStyle}>100% + {config.hasMemory ? 'Memory ' : ''}Coupon</span>
            </div>
          </div>

          <div>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Key Features
            </h4>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Coupon Rate:</span>
              <span style={valueStyle}>{config.couponRate}% p.a.</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Autocall Level:</span>
              <span style={valueStyle}>{config.autocallBarrier}% (Step-down)</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Protection Barrier:</span>
              <span style={valueStyle}>{config.protectionBarrier}%</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Total Periods:</span>
              <span style={valueStyle}>{config.totalPeriods}</span>
            </div>
            <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
              <span style={labelStyle}>Non-call Periods:</span>
              <span style={valueStyle}>{config.nonCallPeriods > 0 ? `${config.nonCallPeriods} periods` : 'None'}</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );

  // Orion Memory Summary
  const renderOrionSummary = () => (
    <div>
      <div style={cardStyle}>
        <h3 style={titleStyle}>
          ⭐ Orion Memory Product Summary
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          <div>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Product Structure
            </h4>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Product Type:</span>
              <span style={valueStyle}>Memory Coupon Note</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Memory Feature:</span>
              <span style={valueStyle}>
                {structureParams?.memoryFeature === 'full' ? 'Full Memory - Cumulative' :
                 structureParams?.memoryFeature === 'partial' ? 'Partial Memory - Limited' :
                 structureParams?.memoryFeature === 'none' ? 'No Memory' :
                 config.hasMemory ? 'Full Memory - Cumulative' : 'No Memory'}
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Coupon Frequency:</span>
              <span style={valueStyle}>{config.frequency}</span>
            </div>
            <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
              <span style={labelStyle}>Capital Protection:</span>
              <span style={valueStyle}>{config.protectionBarrier}% at Maturity</span>
            </div>
          </div>

          <div>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Key Parameters
            </h4>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Coupon Rate:</span>
              <span style={valueStyle}>{config.couponRate}% p.a.</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Memory Barrier:</span>
              <span style={valueStyle}>{config.couponBarrier}%</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Protection Level:</span>
              <span style={valueStyle}>{config.protectionBarrier}%</span>
            </div>
            <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
              <span style={labelStyle}>Memory Type:</span>
              <span style={valueStyle}>
                {structureParams?.memoryFeature === 'full' ? 'Accumulative' :
                 structureParams?.memoryFeature === 'partial' ? 'Limited Carryover' :
                 structureParams?.memoryFeature === 'none' ? 'None' :
                 config.hasMemory ? 'Accumulative' : 'None'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={titleStyle}>
          💰 Memory Coupon Mechanism
        </h3>
        
        <div style={{ 
          background: 'var(--bg-tertiary)', 
          padding: '1.5rem', 
          borderRadius: '8px',
          marginBottom: '1rem'
        }}>
          <h4 style={{ margin: '0 0 0.75rem 0', color: 'var(--text-primary)', fontSize: '0.95rem' }}>
            How Memory Works
          </h4>
          <div style={{ display: 'grid', gap: '0.75rem', fontSize: '0.9rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--success-color)', fontWeight: '600' }}>✓</span>
              <span>If underlying ≥ {config.couponBarrier}%: Coupon is paid ({config.couponRate}% {config.frequency.toLowerCase()})</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--warning-color)', fontWeight: '600' }}>○</span>
              <span>If underlying &lt; {config.couponBarrier}%: Coupon is stored in memory</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--accent-color)', fontWeight: '600' }}>⚡</span>
              <span>When barrier is reached again: All memory coupons paid out</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>💎</span>
              <span>At maturity: All accumulated memory coupons paid regardless</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Himalaya Protection Summary
  const renderHimalayaSummary = () => (
    <div>
      <div style={cardStyle}>
        <h3 style={titleStyle}>
          🏔️ Himalaya Protection Product Summary
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          <div>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Product Structure
            </h4>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Product Type:</span>
              <span style={valueStyle}>Capital Protected Note</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Protection Type:</span>
              <span style={valueStyle}>Hard Protection</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Observation:</span>
              <span style={valueStyle}>Annual</span>
            </div>
            <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
              <span style={labelStyle}>Reference:</span>
              <span style={valueStyle}>Worst Of Performance</span>
            </div>
          </div>

          <div>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Key Parameters
            </h4>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Capital Protection:</span>
              <span style={valueStyle}>85%</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Participation Rate:</span>
              <span style={valueStyle}>120%</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Cap Level:</span>
              <span style={valueStyle}>150%</span>
            </div>
            <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
              <span style={labelStyle}>Digital Coupon:</span>
              <span style={valueStyle}>8% annually</span>
            </div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={titleStyle}>
          🛡️ Protection Features
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div style={{ 
            background: 'var(--success-color)', 
            color: 'white', 
            padding: '1rem', 
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>💚 Capital Protection</h4>
            <p style={{ margin: 0, fontSize: '0.8rem' }}>
              85% of invested capital is guaranteed regardless of underlying performance
            </p>
          </div>

          <div style={{ 
            background: 'var(--accent-color)', 
            color: 'white', 
            padding: '1rem', 
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>⚡ Enhanced Participation</h4>
            <p style={{ margin: 0, fontSize: '0.8rem' }}>
              120% participation in positive performance up to 150% cap
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // Shark Note Summary
  const renderSharkSummary = () => (
    <div>
      <div style={cardStyle}>
        <h3 style={titleStyle}>
          🦈 Shark Note Product Summary
        </h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          <div>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Product Structure
            </h4>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Product Type:</span>
              <span style={valueStyle}>Leveraged Participation</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Barrier Observation:</span>
              <span style={valueStyle}>Continuous</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Payout Structure:</span>
              <span style={valueStyle}>Leveraged Performance</span>
            </div>
            <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
              <span style={labelStyle}>Risk Level:</span>
              <span style={valueStyle}>High Risk / High Reward</span>
            </div>
          </div>

          <div>
            <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
              Key Parameters
            </h4>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Strike Level:</span>
              <span style={valueStyle}>100%</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Leverage Factor:</span>
              <span style={valueStyle}>2.0x</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Knock-Out Barrier:</span>
              <span style={valueStyle}>130%</span>
            </div>
            <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
              <span style={labelStyle}>Maximum Return:</span>
              <span style={valueStyle}>Unlimited*</span>
            </div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h3 style={titleStyle}>
          ⚠️ Risk Warning
        </h3>
        
        <div style={{ 
          background: 'var(--error-color)', 
          color: 'white', 
          padding: '1rem', 
          borderRadius: '8px',
          marginBottom: '1rem'
        }}>
          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>High Risk Investment</h4>
          <p style={{ margin: 0, fontSize: '0.8rem' }}>
            This product offers leveraged exposure and can result in significant losses. 
            If the knock-out barrier is breached, the product terminates early with limited upside.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div style={{ 
            background: 'var(--warning-color)', 
            color: 'white', 
            padding: '1rem', 
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>🎯 Best Case</h4>
            <p style={{ margin: 0, fontSize: '0.8rem' }}>
              No barrier breach + positive performance = 2x leveraged returns
            </p>
          </div>

          <div style={{ 
            background: 'var(--error-color)', 
            color: 'white', 
            padding: '1rem', 
            borderRadius: '8px'
          }}>
            <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>💥 Worst Case</h4>
            <p style={{ margin: 0, fontSize: '0.8rem' }}>
              Barrier breach = Early termination with capped returns
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // Reverse Convertible Summary (for both stock and bond versions)
  const renderReverseConvertibleSummary = () => {
    const isBondVersion = selectedTemplateId === 'reverse_convertible_bond';
    const icon = isBondVersion ? '📜' : '🔄';
    const title = isBondVersion ? 'Reverse Convertible (Bond)' : 'Reverse Convertible';

    return (
      <div style={cardStyle}>
        <h3 style={titleStyle}>
          {icon} {title} Summary
        </h3>

        {/* Product Details Section */}
        <div style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1.5rem',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            color: 'var(--text-primary)',
            fontSize: '1rem',
            fontWeight: '600',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '0.5rem'
          }}>
            📄 Product Details
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={infoRowStyle}>
              <span style={labelStyle}>ISIN:</span>
              <span style={valueStyle}>{productDetails.isin || 'Not specified'}</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Issuer:</span>
              <span style={valueStyle}>{productDetails.issuer || 'Not specified'}</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Currency:</span>
              <span style={valueStyle}>{productDetails.currency}</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Trade Date:</span>
              <span style={valueStyle}>{productDetails.tradeDate || 'Not specified'}</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Value Date:</span>
              <span style={valueStyle}>{productDetails.valueDate || 'Not specified'}</span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Final Observation:</span>
              <span style={valueStyle}>{productDetails.finalObservation || productDetails.finalObservationDate || 'Not specified'}</span>
            </div>
          </div>
        </div>

        {/* Underlying Details Section */}
        <div style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1.5rem',
          marginBottom: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            color: 'var(--text-primary)',
            fontSize: '1rem',
            fontWeight: '600',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '0.5rem'
          }}>
            📈 {isBondVersion ? 'Bond' : 'Underlying'} Details
          </h4>
          {underlyings.length > 0 ? (
            underlyings.map((underlying, index) => (
              <div key={index} style={{ marginBottom: index < underlyings.length - 1 ? '1rem' : '0' }}>
                <div style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '1rem'
                }}>
                  <div style={{
                    fontSize: '1rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    marginBottom: '0.5rem'
                  }}>
                    {underlying.ticker || underlying.securityData?.symbol || 'N/A'}
                  </div>
                  <div style={{
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '0.75rem'
                  }}>
                    {underlying.name || underlying.securityData?.name || 'N/A'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    {underlying.isin && (
                      <div style={infoRowStyle}>
                        <span style={labelStyle}>ISIN:</span>
                        <span style={{ ...valueStyle, fontFamily: 'monospace', fontSize: '0.85rem' }}>{underlying.isin}</span>
                      </div>
                    )}
                    <div style={infoRowStyle}>
                      <span style={labelStyle}>Initial Price:</span>
                      <span style={valueStyle}>
                        {underlying.securityData?.currency || productDetails.currency} {underlying.strike?.toFixed(2) || '0.00'}
                      </span>
                    </div>
                    {underlying.securityData?.exchange && (
                      <div style={infoRowStyle}>
                        <span style={labelStyle}>Exchange:</span>
                        <span style={valueStyle}>{underlying.securityData.exchange}</span>
                      </div>
                    )}
                    {underlying.securityData?.price && (
                      <div style={infoRowStyle}>
                        <span style={labelStyle}>Last Price:</span>
                        <span style={valueStyle}>
                          {underlying.securityData.currency || productDetails.currency} {(underlying.securityData.price.close || underlying.securityData.price.price || underlying.securityData.price)?.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div style={{
              textAlign: 'center',
              padding: '2rem',
              color: 'var(--text-muted)',
              fontStyle: 'italic'
            }}>
              No {isBondVersion ? 'bond' : 'underlying'} added yet
            </div>
          )}
        </div>

        {/* Structure Parameters Section */}
        <div style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            color: 'var(--text-primary)',
            fontSize: '1rem',
            fontWeight: '600',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '0.5rem'
          }}>
            🏗️ Structure Parameters
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Coupon Rate p.a.:</span>
              <span style={{ ...valueStyle, fontWeight: '600', color: '#10b981' }}>
                {structureParams?.couponRate !== undefined ? `${structureParams.couponRate}%` : '3.5%'}
              </span>
            </div>
            <div style={infoRowStyle}>
              <span style={labelStyle}>Capital Protection Barrier:</span>
              <span style={{ ...valueStyle, fontWeight: '600', color: '#f59e0b' }}>
                {structureParams?.barrierType === 'american' ? 'American' : 'European'} {structureParams?.capitalProtectionBarrier || (isBondVersion ? 100 : 70)}%
              </span>
            </div>
            {!isBondVersion && (
              <div style={infoRowStyle}>
                <span style={labelStyle}>Strike Level:</span>
                <span style={valueStyle}>{structureParams?.strike || 100}%</span>
              </div>
            )}
            <div style={infoRowStyle}>
              <span style={labelStyle}>Gearing Factor:</span>
              <span style={{ ...valueStyle, fontWeight: '600', color: '#ef4444' }}>
                {(1 / ((structureParams?.capitalProtectionBarrier || (isBondVersion ? 100 : 70)) / 100)).toFixed(2)}x
              </span>
            </div>
          </div>

          {/* Payoff Logic Explanation */}
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: 'var(--bg-primary)',
            borderRadius: '6px',
            border: '1px solid var(--border-color)'
          }}>
            <h5 style={{
              margin: '0 0 0.75rem 0',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              💡 Payoff Logic
            </h5>
            <ul style={{
              margin: '0',
              paddingLeft: '1.5rem',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              lineHeight: '1.6'
            }}>
              <li>
                <strong>Guaranteed Coupon:</strong> {structureParams?.couponRate || 3.5}% paid at maturity regardless of {isBondVersion ? 'bond' : 'underlying'} performance
              </li>
              <li>
                <strong>Above Barrier ({structureParams?.capitalProtectionBarrier || (isBondVersion ? 100 : 70)}%):</strong> Full capital protection → 100% + {structureParams?.couponRate || 3.5}% coupon
              </li>
              <li>
                <strong>Below Barrier:</strong> Geared downside exposure → 100% + (performance × {(1 / ((structureParams?.capitalProtectionBarrier || (isBondVersion ? 100 : 70)) / 100)).toFixed(2)}x) + {structureParams?.couponRate || 3.5}% coupon
              </li>
              <li>
                <strong>{structureParams?.barrierType === 'american' ? 'American Barrier:' : 'European Barrier:'}</strong> {structureParams?.barrierType === 'american' ? 'Monitored continuously during product life' : 'Checked only at final observation date'}
              </li>
            </ul>
          </div>
        </div>

        {/* Save Button */}
        <div style={{ marginTop: '2rem', textAlign: 'center' }}>
          <button
            onClick={onSaveProduct}
            style={{
              padding: '1rem 3rem',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'translateY(-2px)';
              e.target.style.boxShadow = '0 6px 16px rgba(16, 185, 129, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
            }}
          >
            {editingProduct ? '✏️ Update Product' : '💾 Save Product'}
          </button>
        </div>
      </div>
    );
  };

  // Generic Summary for unknown templates
  const renderGenericSummary = () => (
    <div style={cardStyle}>
      <h3 style={titleStyle}>
        📊 Product Summary
      </h3>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div>
          <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
            Basic Details
          </h4>
          <div style={infoRowStyle}>
            <span style={labelStyle}>ISIN:</span>
            <span style={valueStyle}>{productDetails.isin || 'Not specified'}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={labelStyle}>Issuer:</span>
            <span style={valueStyle}>{productDetails.issuer || 'Not specified'}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={labelStyle}>Currency:</span>
            <span style={valueStyle}>{productDetails.currency}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={labelStyle}>Trade Date:</span>
            <span style={valueStyle}>{productDetails.tradeDate || 'Not specified'}</span>
          </div>
          <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
            <span style={labelStyle}>Maturity:</span>
            <span style={valueStyle}>{productDetails.maturity || 'Not specified'}</span>
          </div>
        </div>

        <div>
          <h4 style={{ margin: '0 0 1rem 0', color: 'var(--text-primary)', fontSize: '1rem' }}>
            Structure Details
          </h4>
          <div style={infoRowStyle}>
            <span style={labelStyle}>Life Components:</span>
            <span style={valueStyle}>
              {Array.isArray(droppedItems) ? 
                droppedItems.filter(item => item.column === 'life').length : 
                (droppedItems?.life || []).length}
            </span>
          </div>
          <div style={infoRowStyle}>
            <span style={labelStyle}>Maturity Components:</span>
            <span style={valueStyle}>
              {Array.isArray(droppedItems) ? 
                droppedItems.filter(item => item.column === 'maturity').length : 
                (droppedItems?.maturity || []).length}
            </span>
          </div>
          <div style={infoRowStyle}>
            <span style={labelStyle}>Underlyings:</span>
            <span style={valueStyle}>{underlyings.length}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={labelStyle}>Basket Mode:</span>
            <span style={valueStyle}>{basketMode}</span>
          </div>
          <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
            <span style={labelStyle}>Observations:</span>
            <span style={valueStyle}>{observationSchedule.length}</span>
          </div>
        </div>
      </div>
    </div>
  );

  // Render appropriate summary based on template
  const renderTemplateSummary = () => {
    if (!selectedTemplateId) {
      return (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.5 }}>📋</div>
          <h3>No Template Selected</h3>
          <p>Please select a template first to view the product summary</p>
        </div>
      );
    }

    switch (selectedTemplateId) {
      case 'phoenix_autocallable':
        return renderPhoenixSummary();
      case 'orion_memory':
        return renderOrionSummary();
      case 'himalaya_protection':
        return renderHimalayaSummary();
      case 'shark_note':
        return renderSharkSummary();
      case 'reverse_convertible':
      case 'reverse_convertible_bond':
        return renderReverseConvertibleSummary();
      default:
        return renderGenericSummary();
    }
  };

  return (
    <div className="summary-module">
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '2rem',
        paddingBottom: '1rem',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>
          {selectedTemplate ? `${selectedTemplate.icon} ${selectedTemplate.name} Summary` : 'Product Summary'}
        </h2>
        <button
          onClick={onSaveProduct}
          disabled={!productDetails.isin}
          style={{
            padding: '1rem 2rem',
            background: productDetails.isin ? 'var(--success-color)' : 'gray',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: productDetails.isin ? 'pointer' : 'not-allowed',
            fontSize: '1rem',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          💾 {editingProduct ? 'Update Product' : 'Save Product'}
        </button>
      </div>

      {renderTemplateSummary()}

      {/* Product Configuration Validation */}
      <div style={cardStyle}>
        <h3 style={titleStyle}>
          ✅ Product Configuration
        </h3>
        
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem',
            padding: '0.5rem',
            borderRadius: '6px',
            background: productDetails.isin ? 'var(--success-color)' : 'var(--error-color)',
            color: 'white'
          }}>
            <span style={{ fontSize: '1.2rem' }}>{productDetails.isin ? '✅' : '❌'}</span>
            <span style={{ fontWeight: '500' }}>
              ISIN: {productDetails.isin ? `${productDetails.isin} (Valid)` : 'Required for saving'}
            </span>
          </div>
          
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.75rem',
            padding: '0.5rem',
            borderRadius: '6px',
            background: underlyings.length > 0 ? 'var(--success-color)' : 'var(--warning-color)',
            color: 'white'
          }}>
            <span style={{ fontSize: '1.2rem' }}>{underlyings.length > 0 ? '✅' : '⚠️'}</span>
            <span style={{ fontWeight: '500' }}>
              Underlyings: {underlyings.length > 0 ? `${underlyings.length} configured` : 'None configured'}
            </span>
          </div>
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.5rem',
            borderRadius: '6px',
            background: (() => {
              // Check for template-based structure (structureParams) OR drag-and-drop structure (droppedItems)
              let hasStructure = false;

              // For template-based products, check if structureParams exists and has properties
              if (structureParams && Object.keys(structureParams).length > 0) {
                hasStructure = true;
              }
              // For drag-and-drop products, check droppedItems
              else if (Array.isArray(droppedItems)) {
                hasStructure = droppedItems.length > 0;
              } else if (droppedItems && typeof droppedItems === 'object') {
                hasStructure = (droppedItems.life || []).length > 0 || (droppedItems.maturity || []).length > 0;
              }

              return hasStructure ? 'var(--success-color)' : 'var(--warning-color)';
            })(),
            color: 'white'
          }}>
            <span style={{ fontSize: '1.2rem' }}>
              {(() => {
                // Check for template-based structure (structureParams) OR drag-and-drop structure (droppedItems)
                let hasStructure = false;

                // For template-based products, check if structureParams exists and has properties
                if (structureParams && Object.keys(structureParams).length > 0) {
                  hasStructure = true;
                }
                // For drag-and-drop products, check droppedItems
                else if (Array.isArray(droppedItems)) {
                  hasStructure = droppedItems.length > 0;
                } else if (droppedItems && typeof droppedItems === 'object') {
                  hasStructure = (droppedItems.life || []).length > 0 || (droppedItems.maturity || []).length > 0;
                }

                return hasStructure ? '✅' : '⚠️';
              })()}
            </span>
            <span style={{ fontWeight: '500' }}>
              Structure: {(() => {
                // Check for template-based structure (structureParams) OR drag-and-drop structure (droppedItems)

                // For template-based products, show "Configured" if structureParams exists
                if (structureParams && Object.keys(structureParams).length > 0) {
                  return 'Configured';
                }

                // For drag-and-drop products, show count or "Empty"
                let itemCount = 0;
                if (Array.isArray(droppedItems)) {
                  itemCount = droppedItems.length;
                } else if (droppedItems && typeof droppedItems === 'object') {
                  itemCount = (droppedItems.life || []).length + (droppedItems.maturity || []).length;
                }
                return itemCount > 0 ? 'Configured' : 'Empty';
              })()}
            </span>
          </div>
        </div>
      </div>

      {!productDetails.isin && (
        <div style={{
          background: 'var(--error-color)',
          color: 'white',
          padding: '1.5rem',
          borderRadius: '12px',
          textAlign: 'center',
          marginTop: '1rem'
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
          <h3 style={{ margin: '0 0 0.5rem 0' }}>Cannot Save Product</h3>
          <p style={{ margin: 0 }}>
            ISIN is required to save the product. Please go to the Setup tab and enter a valid ISIN.
          </p>
        </div>
      )}
    </div>
  );
};

export default SummaryModule;