import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { ProductsCollection } from '../../api/products.js';
import {
  ASSET_CLASSES,
  SECTORS,
  EXCHANGES,
  STRUCTURED_PRODUCT_TYPES,
  STRUCTURED_PRODUCT_UNDERLYING_TYPES,
  STRUCTURED_PRODUCT_PROTECTION_TYPES,
  EQUITY_SUB_CLASSES,
  FIXED_INCOME_SUB_CLASSES
} from '../../api/securitiesMetadata.js';

export default function SecurityClassificationModal({ security, onSave, onClose }) {
  // Initialize form state with existing security data
  const [formData, setFormData] = useState({
    securityName: security.securityName || '',
    assetClass: security.assetClass || '',
    assetSubClass: security.assetSubClass || '',
    // Structured product specific fields
    structuredProductType: security.structuredProductType || '',
    structuredProductUnderlyingType: security.structuredProductUnderlyingType || '',
    structuredProductProtectionType: security.structuredProductProtectionType || '',
    capitalGuaranteed100: security.capitalGuaranteed100 || false,
    capitalGuaranteedPartial: security.capitalGuaranteedPartial || false,
    guaranteedLevel: security.guaranteedLevel || '',
    barrierProtected: security.barrierProtected || false,
    barrierLevel: security.barrierLevel || '',
    currency: security.currency || '',
    listingExchange: security.listingExchange || '',
    listingCountry: security.listingCountry || '',
    sector: security.sector || '',
    industry: security.industry || '',
    issuer: security.issuer || '',
    productType: security.productType || '',
    maturityDate: security.maturityDate ? new Date(security.maturityDate).toISOString().split('T')[0] : '',
    couponRate: security.couponRate || '',
    notes: security.notes || ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [classificationResult, setClassificationResult] = useState(null);
  const [classificationError, setClassificationError] = useState(null);

  // Lookup product in Ambervision database by ISIN
  const ambervisionProduct = useTracker(() => {
    if (!security?.isin) return null;

    // Subscribe to products
    const sessionId = localStorage.getItem('sessionId');
    Meteor.subscribe('products', sessionId);

    // Find product by ISIN
    return ProductsCollection.findOne({ isin: security.isin });
  }, [security?.isin]);

  // Auto-fill product name from Ambervision database
  const handleFillFromAmbervision = () => {
    if (!ambervisionProduct) return;

    // Debug: Log product data to understand what fields are available
    console.log('[SecurityClassificationModal] Ambervision product data:', {
      templateId: ambervisionProduct.templateId,
      title: ambervisionProduct.title,
      structureParams: ambervisionProduct.structureParams,
      structureParameters: ambervisionProduct.structureParameters,
      structure: ambervisionProduct.structure,
      underlyings: ambervisionProduct.underlyings
    });

    // Extract structure parameters from product
    const structureParams = ambervisionProduct.structureParams || ambervisionProduct.structureParameters || {};
    const structure = ambervisionProduct.structure || {};

    // Determine asset class and protection type based on product template and actual data
    let assetClass = 'structured_product';
    let protectionType = '';
    let assetSubClass = '';

    // Map template types to protection types
    const templateType = ambervisionProduct.templateId?.toLowerCase() || '';

    // Normalize product type from template variants like "orion_memory", "phoenix_autocall"
    let productType = '';
    if (templateType.includes('orion')) productType = 'orion';
    else if (templateType.includes('phoenix')) productType = 'phoenix';
    else if (templateType.includes('himalaya')) productType = 'himalaya';
    else if (templateType.includes('participation')) productType = 'participation_note';
    else if (templateType.includes('reverse')) productType = 'reverse_convertible';
    else if (templateType.includes('shark')) productType = 'shark_note';
    else productType = templateType || '';

    // Determine protection type based on template AND actual structure data
    if (templateType === 'orion' || templateType.includes('orion')) {
      // Orion: Check if capitalGuaranteed is 100%
      const capitalGuaranteed = structureParams.capitalGuaranteed ?? structure.capitalGuaranteed ?? 100;
      if (capitalGuaranteed >= 100) {
        protectionType = 'capital_guaranteed_100';
      } else if (capitalGuaranteed > 0) {
        protectionType = 'capital_guaranteed_partial';
      } else {
        protectionType = 'capital_protected_conditional';
      }
    } else if (templateType === 'phoenix' || templateType.includes('phoenix')) {
      // Phoenix products are barrier protected (conditional capital protection)
      protectionType = 'capital_protected_conditional';
    } else if (templateType === 'himalaya' || templateType.includes('himalaya')) {
      // Himalaya: Check floor level for protection type
      const floor = structureParams.floor ?? structureParams.floorLevel ?? structure.floor ?? 100;
      if (floor >= 100) {
        protectionType = 'capital_guaranteed_100';
      } else if (floor > 0) {
        protectionType = 'capital_protected_conditional';
      }
    } else if (templateType === 'participation_note' || templateType.includes('participation')) {
      // Participation notes: Check for capital guarantee
      const participationGuarantee = structureParams.capitalGuarantee ??
                                     structureParams.protectionBarrier ??
                                     structureParams.capitalProtection ??
                                     structure.capitalProtection ?? 0;
      if (participationGuarantee >= 100) {
        protectionType = 'capital_guaranteed_100';
      } else if (participationGuarantee > 0) {
        protectionType = 'capital_protected_conditional';
      } else {
        protectionType = 'other_protection'; // No protection
      }
    } else if (templateType === 'reverse_convertible' || templateType.includes('reverse')) {
      // Reverse convertibles typically have barrier protection
      protectionType = 'capital_protected_conditional';
    } else if (templateType === 'shark_note' || templateType.includes('shark')) {
      // Shark notes: Conditional protection
      protectionType = 'capital_protected_conditional';
    } else {
      // Unknown template: Check for any protection level in structure
      const genericProtection = structureParams.capitalGuarantee ??
                                structureParams.protectionBarrier ??
                                structureParams.capitalProtection ?? 0;
      if (genericProtection >= 100) {
        protectionType = 'capital_guaranteed_100';
      } else if (genericProtection > 0) {
        protectionType = 'capital_protected_conditional';
      }
    }

    // Determine underlying type from product underlyings
    let underlyingType = '';
    if (ambervisionProduct.underlyings && ambervisionProduct.underlyings.length > 0) {
      // Analyze underlyings to determine type
      const underlyingTypes = ambervisionProduct.underlyings.map(u => {
        const name = (u.name || '').toLowerCase();
        const type = (u.type || '').toLowerCase();
        const ticker = (u.ticker || u.symbol || '').toUpperCase();

        // Check for commodities
        if (name.includes('gold') || name.includes('silver') || name.includes('oil') ||
            name.includes('copper') || ticker === 'GC' || ticker === 'SI' || ticker === 'CL') {
          return 'commodities_linked';
        }
        // Check for bonds/fixed income
        if (name.includes('bond') || name.includes('treasury') || type === 'bond' || type === 'fixed_income') {
          return 'fixed_income_linked';
        }
        // Check for credit
        if (name.includes('credit') || name.includes('cds')) {
          return 'credit_linked';
        }
        // Default to equity (most common)
        return 'equity_linked';
      });

      // Use the most common type, default to equity_linked
      underlyingType = underlyingTypes[0] || 'equity_linked';
    }

    setFormData(prev => ({
      ...prev,
      securityName: ambervisionProduct.productTitle || prev.securityName,
      assetClass: assetClass,
      assetSubClass: assetSubClass,
      structuredProductType: productType, // Normalized product type (orion, phoenix, etc.)
      structuredProductProtectionType: protectionType,
      structuredProductUnderlyingType: underlyingType,
      currency: ambervisionProduct.currency || prev.currency,
      issuer: ambervisionProduct.issuer || prev.issuer,
      maturityDate: ambervisionProduct.maturityDate
        ? new Date(ambervisionProduct.maturityDate).toISOString().split('T')[0]
        : prev.maturityDate,
      // Fill barrier level if available (for barrier protected products)
      barrierProtected: protectionType === 'capital_protected_conditional',
      capitalGuaranteed100: protectionType === 'capital_guaranteed_100',
      capitalGuaranteedPartial: protectionType === 'capital_guaranteed_partial'
    }));

    setClassificationResult({
      message: `Product filled from Ambervision: ${ambervisionProduct.productTitle} (${productType.toUpperCase()})`,
      source: 'internal_product',
      confidence: 'high',
      confidenceScore: 100,
      success: true
    });
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Prepare data for saving
      const dataToSave = {
        ...formData,
        maturityDate: formData.maturityDate ? new Date(formData.maturityDate) : null,
        guaranteedLevel: formData.guaranteedLevel ? parseFloat(formData.guaranteedLevel) : null,
        barrierLevel: formData.barrierLevel ? parseFloat(formData.barrierLevel) : null,
        couponRate: formData.couponRate ? parseFloat(formData.couponRate) : null
      };

      console.log('[SecurityClassificationModal] Saving classification data:', {
        isin: security.isin,
        securityName: dataToSave.securityName,
        fullData: dataToSave
      });

      await onSave(dataToSave);

      console.log('[SecurityClassificationModal] Save completed successfully');
    } catch (error) {
      console.error('[SecurityClassificationModal] Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoClassify = async () => {
    setIsClassifying(true);
    setClassificationError(null);

    try {
      // Validate ISIN exists
      if (!security || !security.isin) {
        throw new Error('No ISIN found for this security');
      }

      const sessionId = localStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('No valid session found. Please log in again.');
      }

      console.log('Security object:', security);
      console.log('Requesting smart classification for ISIN:', security.isin);
      console.log('Session ID:', sessionId);
      console.log('Existing data:', { securityName: formData.securityName });

      const params = {
        isin: security.isin || '',
        existingData: {
          securityName: formData.securityName || ''
        },
        sessionId: sessionId
      };

      console.log('Calling method with params:', params);

      const result = await Meteor.callAsync('securitiesMetadata.smartClassify', params);

      console.log('Classification result:', result);
      console.log('Classified data fields:', result.data);

      // Log which fields are empty vs filled
      const allFields = [
        'securityName', 'assetClass', 'assetSubClass', 'sector', 'industry',
        'issuer', 'listingExchange', 'listingCountry', 'currency',
        'productType', 'maturityDate', 'couponRate'
      ];

      const emptyFields = allFields.filter(f => !result.data[f] || result.data[f] === '');
      const filledFields = allFields.filter(f => result.data[f] && result.data[f] !== '');

      console.log('Filled fields:', filledFields, filledFields.map(f => `${f}: "${result.data[f]}"`));
      console.log('Empty fields:', emptyFields);

      // Update form with classified data
      setFormData(prev => ({
        ...prev,
        securityName: result.data.securityName || prev.securityName,
        assetClass: result.data.assetClass || prev.assetClass,
        assetSubClass: result.data.assetSubClass || prev.assetSubClass,
        structuredProductType: result.data.structuredProductType || prev.structuredProductType,
        structuredProductUnderlyingType: result.data.structuredProductUnderlyingType || prev.structuredProductUnderlyingType,
        structuredProductProtectionType: result.data.structuredProductProtectionType || prev.structuredProductProtectionType,
        capitalGuaranteed100: result.data.capitalGuaranteed100 || prev.capitalGuaranteed100,
        capitalGuaranteedPartial: result.data.capitalGuaranteedPartial || prev.capitalGuaranteedPartial,
        guaranteedLevel: result.data.guaranteedLevel || prev.guaranteedLevel,
        barrierProtected: result.data.barrierProtected || prev.barrierProtected,
        barrierLevel: result.data.barrierLevel || prev.barrierLevel,
        currency: result.data.currency || prev.currency,
        listingExchange: result.data.listingExchange || prev.listingExchange,
        listingCountry: result.data.listingCountry || prev.listingCountry,
        sector: result.data.sector || prev.sector,
        industry: result.data.industry || prev.industry,
        issuer: result.data.issuer || prev.issuer,
        productType: result.data.productType || prev.productType,
        maturityDate: result.data.maturityDate ? new Date(result.data.maturityDate).toISOString().split('T')[0] : prev.maturityDate,
        couponRate: result.data.couponRate || prev.couponRate,
        notes: result.data.notes || prev.notes
      }));

      setClassificationResult(result);

    } catch (error) {
      console.error('Auto-classify error:', error);
      setClassificationError(error.reason || error.message || 'Classification failed');
    } finally {
      setIsClassifying(false);
    }
  };

  // Styles
  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px'
  };

  const modalStyle = {
    background: 'var(--bg-secondary)',
    borderRadius: '16px',
    maxWidth: '900px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    border: '2px solid var(--border-color)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  };

  const headerStyle = {
    padding: '25px 30px',
    borderBottom: '2px solid var(--border-color)',
    background: 'var(--bg-tertiary)'
  };

  const bodyStyle = {
    padding: '30px'
  };

  const footerStyle = {
    padding: '20px 30px',
    borderTop: '2px solid var(--border-color)',
    background: 'var(--bg-tertiary)',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '15px'
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 15px',
    borderRadius: '8px',
    border: '2px solid var(--border-color)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    fontFamily: 'inherit'
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  };

  const formGroupStyle = {
    marginBottom: '20px'
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '20px'
  };

  const sectionTitleStyle = {
    fontSize: '16px',
    fontWeight: '700',
    color: 'var(--text-primary)',
    marginTop: '30px',
    marginBottom: '15px',
    paddingBottom: '10px',
    borderBottom: '2px solid var(--border-color)'
  };

  const buttonStyle = {
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  };

  const primaryButtonStyle = {
    ...buttonStyle,
    background: 'var(--accent-color)',
    color: 'white'
  };

  const secondaryButtonStyle = {
    ...buttonStyle,
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: '2px solid var(--border-color)'
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px' }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ margin: 0, fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)' }}>
                Classify Security
              </h2>
              <div style={{ marginTop: '10px', fontSize: '14px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                ISIN: {security.isin}
              </div>
              {classificationResult && (
                <div style={{
                  marginTop: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  flexWrap: 'wrap'
                }}>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: classificationResult.source === 'internal_product' ? '#10b981' :
                               classificationResult.source === 'ai_analysis' ? '#3b82f6' : '#f59e0b',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}>
                    {classificationResult.source === 'internal_product' ? '🏢 Internal Product' :
                     classificationResult.source === 'ai_analysis' ? '🤖 AI Classified' : '🌐 Database Lookup'}
                  </span>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    background: classificationResult.confidence === 'high' ? '#10b981' :
                               classificationResult.confidence === 'medium' ? '#f59e0b' : '#ef4444',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}>
                    {classificationResult.confidence === 'high' ? '🟢 High' :
                     classificationResult.confidence === 'medium' ? '🟡 Medium' : '🔴 Low'} Confidence ({classificationResult.confidenceScore}%)
                  </span>
                </div>
              )}
              {classificationError && (
                <div style={{
                  marginTop: '12px',
                  padding: '10px',
                  borderRadius: '6px',
                  background: '#fee2e2',
                  color: '#991b1b',
                  fontSize: '13px'
                }}>
                  ⚠️ {classificationError}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {ambervisionProduct && (
                <button
                  onClick={handleFillFromAmbervision}
                  style={{
                    padding: '12px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    whiteSpace: 'nowrap'
                  }}
                  title="Fill product name from Ambervision database"
                >
                  📋 Fill from Ambervision
                </button>
              )}
              <button
                onClick={handleAutoClassify}
                disabled={isClassifying}
                style={{
                  padding: '12px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: isClassifying ? 'var(--bg-primary)' : 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: isClassifying ? 'wait' : 'pointer',
                  opacity: isClassifying ? 0.7 : 1,
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  whiteSpace: 'nowrap'
                }}
              >
                {isClassifying ? '⏳ Classifying...' : '🤖 Auto-Classify'}
              </button>
            </div>
          </div>
          {classificationResult && classificationResult.explanation && (
            <div style={{
              marginTop: '15px',
              padding: '12px',
              background: 'var(--bg-primary)',
              borderRadius: '8px',
              fontSize: '13px',
              color: 'var(--text-secondary)',
              borderLeft: '4px solid var(--accent-color)'
            }}>
              <strong>Explanation:</strong> {classificationResult.explanation}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {/* Basic Information */}
          <div style={formGroupStyle}>
            <label style={labelStyle}>Security Name</label>
            <input
              type="text"
              value={formData.securityName}
              onChange={(e) => handleChange('securityName', e.target.value)}
              style={inputStyle}
              placeholder="Enter security name"
            />
          </div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Asset Class *</label>
            <select
              value={formData.assetClass}
              onChange={(e) => handleChange('assetClass', e.target.value)}
              style={inputStyle}
            >
              {ASSET_CLASSES.map(ac => (
                <option key={ac.value} value={ac.value}>
                  {ac.label}
                </option>
              ))}
            </select>
          </div>

          {/* Structured Product Classification */}
          {formData.assetClass === 'structured_product' && (
            <>
              <div style={sectionTitleStyle}>Structured Product Classification</div>
              <div style={gridStyle}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Product Type</label>
                  <select
                    value={formData.structuredProductType}
                    onChange={(e) => handleChange('structuredProductType', e.target.value)}
                    style={inputStyle}
                  >
                    {STRUCTURED_PRODUCT_TYPES.map(pt => (
                      <option key={pt.value} value={pt.value}>
                        {pt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={formGroupStyle}>
                  <label style={labelStyle}>Protection Type</label>
                  <select
                    value={formData.structuredProductProtectionType}
                    onChange={(e) => handleChange('structuredProductProtectionType', e.target.value)}
                    style={inputStyle}
                  >
                    {STRUCTURED_PRODUCT_PROTECTION_TYPES.map(pt => (
                      <option key={pt.value} value={pt.value}>
                        {pt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={formGroupStyle}>
                  <label style={labelStyle}>Underlying Type</label>
                  <select
                    value={formData.structuredProductUnderlyingType}
                    onChange={(e) => handleChange('structuredProductUnderlyingType', e.target.value)}
                    style={inputStyle}
                  >
                    {STRUCTURED_PRODUCT_UNDERLYING_TYPES.map(ut => (
                      <option key={ut.value} value={ut.value}>
                        {ut.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Market Data Section */}
          <div style={sectionTitleStyle}>Market Data</div>

          <div style={gridStyle}>
            <div style={formGroupStyle}>
              <label style={labelStyle}>Currency</label>
              <input
                type="text"
                value={formData.currency}
                onChange={(e) => handleChange('currency', e.target.value)}
                style={inputStyle}
                placeholder="e.g., USD, EUR, CHF"
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>Listing Exchange</label>
              <select
                value={formData.listingExchange}
                onChange={(e) => handleChange('listingExchange', e.target.value)}
                style={inputStyle}
              >
                {EXCHANGES.map(ex => (
                  <option key={ex.value} value={ex.value}>
                    {ex.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>Listing Country</label>
              <input
                type="text"
                value={formData.listingCountry}
                onChange={(e) => handleChange('listingCountry', e.target.value)}
                style={inputStyle}
                placeholder="e.g., Switzerland, USA"
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>Sector</label>
              <select
                value={formData.sector}
                onChange={(e) => handleChange('sector', e.target.value)}
                style={inputStyle}
              >
                {SECTORS.map(s => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>Industry</label>
              <input
                type="text"
                value={formData.industry}
                onChange={(e) => handleChange('industry', e.target.value)}
                style={inputStyle}
                placeholder="e.g., Software, Banking"
              />
            </div>

            <div style={formGroupStyle}>
              <label style={labelStyle}>Issuer</label>
              <input
                type="text"
                value={formData.issuer}
                onChange={(e) => handleChange('issuer', e.target.value)}
                style={inputStyle}
                placeholder="Issuer name"
              />
            </div>
          </div>

          {/* Structured Product Details */}
          {formData.assetClass === 'structured_product' && (
            <>
              <div style={sectionTitleStyle}>Structured Product Details</div>

              <div style={gridStyle}>
                <div style={formGroupStyle}>
                  <label style={labelStyle}>Product Type</label>
                  <input
                    type="text"
                    value={formData.productType}
                    onChange={(e) => handleChange('productType', e.target.value)}
                    style={inputStyle}
                    placeholder="e.g., Reverse Convertible, Autocallable"
                  />
                </div>

                <div style={formGroupStyle}>
                  <label style={labelStyle}>Maturity Date</label>
                  <input
                    type="date"
                    value={formData.maturityDate}
                    onChange={(e) => handleChange('maturityDate', e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div style={formGroupStyle}>
                  <label style={labelStyle}>Coupon Rate (%)</label>
                  <input
                    type="number"
                    value={formData.couponRate}
                    onChange={(e) => handleChange('couponRate', e.target.value)}
                    style={inputStyle}
                    placeholder="e.g., 5.5"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          <div style={sectionTitleStyle}>Additional Notes</div>

          <div style={formGroupStyle}>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }}
              placeholder="Add any additional notes or comments about this security..."
            />
          </div>
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <button
            onClick={onClose}
            style={secondaryButtonStyle}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={primaryButtonStyle}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Classification'}
          </button>
        </div>
      </div>
    </div>
  );
}
