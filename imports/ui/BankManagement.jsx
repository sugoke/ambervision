import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useFind, useSubscribe, useTracker } from 'meteor/react-meteor-data';
import { BanksCollection } from '/imports/api/banks';
import { Meteor } from 'meteor/meteor';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';

const BankManagement = React.memo(({ user }) => {
  const [newBank, setNewBank] = useState({
    name: '',
    city: '',
    country: '',
    countryCode: ''
  });
  
  
  const bankNameInputRef = useRef(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  
  const { dialogState, showConfirm, hideDialog } = useDialog();
  
  // Memoize subscription to prevent re-initialization
  const subscription = useMemo(() => Meteor.subscribe('banks'), []);

  // Set up a timeout for loading state
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoadingTimeout(true);
    }, 10000); // 10 second timeout

    return () => clearTimeout(timer);
  }, []);

  const { banks, banksLoading } = useTracker(() => {
    const isLoading = !subscription.ready();
    
    // Debug logging
    console.log('BankManagement: Subscription ready:', subscription.ready());
    console.log('BankManagement: Is loading:', isLoading);
    
    let banksQuery;
    if (searchTerm) {
      const regex = new RegExp(searchTerm, 'i');
      banksQuery = BanksCollection.find({
        isActive: true,
        $or: [
          { name: regex },
          { city: regex },
          { country: regex },
          { countryCode: regex }
        ]
      }, { sort: { name: 1 } });
    } else {
      banksQuery = BanksCollection.find({ isActive: true }, { sort: { name: 1 } });
    }

    const banksResult = banksQuery.fetch();
    console.log('BankManagement: Found banks:', banksResult.length);

    return {
      banks: banksResult,
      banksLoading: isLoading
    };
  }, [searchTerm, subscription.ready()]);

  // Function to get bank logo emoji based on bank name
  const getBankLogo = (bankName) => {
    const name = bankName.toLowerCase();
    if (name.includes('ubs')) return '🟦'; // UBS blue square
    if (name.includes('credit suisse') || name.includes('cs')) return '🔷'; // Credit Suisse blue diamond
    if (name.includes('goldman sachs') || name.includes('gs')) return '💰'; // Goldman Sachs gold
    if (name.includes('morgan stanley') || name.includes('ms')) return '📊'; // Morgan Stanley chart
    if (name.includes('jp morgan') || name.includes('jpmorgan') || name.includes('chase')) return '🏦'; // JPMorgan Chase
    if (name.includes('bank of america') || name.includes('boa')) return '🇺🇸'; // Bank of America US flag
    if (name.includes('wells fargo')) return '🐎'; // Wells Fargo stagecoach
    if (name.includes('citigroup') || name.includes('citi')) return '🌐'; // Citi global
    if (name.includes('hsbc')) return '🔺'; // HSBC triangle
    if (name.includes('barclays')) return '🦅'; // Barclays eagle
    if (name.includes('deutsche bank') || name.includes('db')) return '🇩🇪'; // Deutsche Bank German flag
    if (name.includes('bnp paribas')) return '🇫🇷'; // BNP Paribas French flag
    if (name.includes('santander')) return '🔴'; // Santander red circle
    if (name.includes('ing')) return '🧡'; // ING orange
    if (name.includes('unicredit')) return '🇮🇹'; // UniCredit Italian flag
    if (name.includes('societe generale') || name.includes('sg')) return '⚪'; // Societe Generale white circle
    if (name.includes('commerzbank')) return '💛'; // Commerzbank yellow
    if (name.includes('raiffeisen')) return '🟡'; // Raiffeisen yellow circle
    if (name.includes('nordea')) return '🔵'; // Nordea blue circle
    if (name.includes('seb')) return '🟢'; // SEB green circle
    if (name.includes('handelsbanken')) return '🔶'; // Handelsbanken orange diamond
    return '🏛️'; // Default bank icon
  };

  // Common country codes and names
  const countries = [
    { code: 'AD', name: 'Andorra' },
    { code: 'AE', name: 'United Arab Emirates' },
    { code: 'AF', name: 'Afghanistan' },
    { code: 'AG', name: 'Antigua and Barbuda' },
    { code: 'AI', name: 'Anguilla' },
    { code: 'AL', name: 'Albania' },
    { code: 'AM', name: 'Armenia' },
    { code: 'AO', name: 'Angola' },
    { code: 'AQ', name: 'Antarctica' },
    { code: 'AR', name: 'Argentina' },
    { code: 'AS', name: 'American Samoa' },
    { code: 'AT', name: 'Austria' },
    { code: 'AU', name: 'Australia' },
    { code: 'AW', name: 'Aruba' },
    { code: 'AX', name: 'Åland Islands' },
    { code: 'AZ', name: 'Azerbaijan' },
    { code: 'BA', name: 'Bosnia and Herzegovina' },
    { code: 'BB', name: 'Barbados' },
    { code: 'BD', name: 'Bangladesh' },
    { code: 'BE', name: 'Belgium' },
    { code: 'BF', name: 'Burkina Faso' },
    { code: 'BG', name: 'Bulgaria' },
    { code: 'BH', name: 'Bahrain' },
    { code: 'BI', name: 'Burundi' },
    { code: 'BJ', name: 'Benin' },
    { code: 'BL', name: 'Saint Barthélemy' },
    { code: 'BM', name: 'Bermuda' },
    { code: 'BN', name: 'Brunei' },
    { code: 'BO', name: 'Bolivia' },
    { code: 'BQ', name: 'Caribbean Netherlands' },
    { code: 'BR', name: 'Brazil' },
    { code: 'BS', name: 'Bahamas' },
    { code: 'BT', name: 'Bhutan' },
    { code: 'BV', name: 'Bouvet Island' },
    { code: 'BW', name: 'Botswana' },
    { code: 'BY', name: 'Belarus' },
    { code: 'BZ', name: 'Belize' },
    { code: 'CA', name: 'Canada' },
    { code: 'CH', name: 'Switzerland' },
    { code: 'CN', name: 'China' },
    { code: 'DE', name: 'Germany' },
    { code: 'DK', name: 'Denmark' },
    { code: 'ES', name: 'Spain' },
    { code: 'FI', name: 'Finland' },
    { code: 'FR', name: 'France' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'HK', name: 'Hong Kong' },
    { code: 'IE', name: 'Ireland' },
    { code: 'IT', name: 'Italy' },
    { code: 'JP', name: 'Japan' },
    { code: 'LU', name: 'Luxembourg' },
    { code: 'MC', name: 'Monaco' },
    { code: 'NL', name: 'Netherlands' },
    { code: 'NO', name: 'Norway' },
    { code: 'SE', name: 'Sweden' },
    { code: 'SG', name: 'Singapore' },
    { code: 'US', name: 'United States' },
  ];

  const handleAddBank = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    Meteor.call('banks.add', {
      name: newBank.name.trim(),
      city: newBank.city.trim(),
      country: newBank.country.trim(),
      countryCode: newBank.countryCode.trim()
    }, (err) => {
      setIsLoading(false);
      if (err) {
        setError(err.reason || 'Failed to add bank');
      } else {
        setSuccess('Bank added successfully!');
        setNewBank({ name: '', city: '', country: '', countryCode: '' });
      }
    });
  };

  const handleDeactivateBank = async (bankId) => {
    const confirmed = await showConfirm('Are you sure you want to remove this bank?');
    if (confirmed) {
      Meteor.call('banks.deactivate', bankId, (err) => {
        if (err) {
          setError(err.reason || 'Failed to remove bank');
        } else {
          setSuccess('Bank removed successfully!');
        }
      });
    }
  };


  return (
    <div>
      {/* Create New Bank Form */}
      <section style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        background: 'var(--bg-primary)'
      }}>
        <h3 style={{
          margin: '0 0 1.5rem 0',
          fontSize: '1.2rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Add New Bank
        </h3>

        <form onSubmit={handleAddBank}>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
            gap: '1.25rem',
            marginBottom: '1.5rem'
          }}>
            <div>
              <label htmlFor="bank-name" style={{ 
                display: 'block', 
                marginBottom: '8px', 
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Bank Name:
              </label>
              <input
                id="bank-name"
                name="bankName"
                ref={bankNameInputRef}
                type="text"
                value={newBank.name}
                onChange={(e) => setNewBank({ ...newBank, name: e.target.value })}
                required
                placeholder="e.g., UBS, Credit Suisse"
                style={{ 
                  width: '100%', 
                  padding: '12px 16px', 
                  border: '2px solid var(--border-color)', 
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
            
            <div>
              <label htmlFor="bank-city" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                City:
              </label>
              <input
                id="bank-city"
                name="bankCity"
                type="text"
                value={newBank.city}
                onChange={(e) => setNewBank({ ...newBank, city: e.target.value })}
                required
                placeholder="e.g., Zurich, London"
                style={{ 
                  width: '100%', 
                  padding: '12px 16px', 
                  border: '2px solid var(--border-color)', 
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div>
              <label htmlFor="bank-country" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Country:
              </label>
              <select
                id="bank-country"
                name="bankCountry"
                value={newBank.countryCode}
                onChange={(e) => {
                  const selectedCountry = countries.find(c => c.code === e.target.value);
                  if (selectedCountry) {
                    setNewBank({
                      ...newBank,
                      countryCode: selectedCountry.code,
                      country: selectedCountry.name
                    });
                  }
                }}
                required
                style={{ 
                  width: '100%', 
                  padding: '12px 16px', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '8px',
                  fontSize: '1rem',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  boxSizing: 'border-box'
                }}
              >
                <option value="">Select Country</option>
                {countries.map(country => (
                  <option key={country.code} value={country.code}>
                    {country.name} ({country.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" disabled={isLoading} style={{ 
            padding: '12px 24px', 
            background: isLoading 
              ? 'var(--text-muted)' 
              : 'var(--success-color)',
            color: 'white', 
            border: 'none', 
            borderRadius: '8px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            transition: 'all 0.2s ease',
            boxShadow: isLoading ? 'none' : '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            {isLoading ? 'Adding...' : 'Add Bank'}
          </button>
        </form>
      </section>

      {/* Messages */}
      {error && (
        <div style={{ 
          color: 'var(--danger-color)', 
          marginBottom: '1rem',
          padding: '12px 16px',
          backgroundColor: 'rgba(220, 53, 69, 0.1)',
          border: '1px solid rgba(220, 53, 69, 0.3)',
          borderRadius: '8px',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ 
          color: 'var(--success-color)', 
          marginBottom: '1rem',
          padding: '12px 16px',
          backgroundColor: 'rgba(40, 167, 69, 0.1)',
          border: '1px solid rgba(40, 167, 69, 0.3)',
          borderRadius: '8px',
          fontSize: '0.875rem'
        }}>
          {success}
        </div>
      )}

      {/* Banks List */}
      <section style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '1.5rem'
      }}>
        <h3 style={{
          margin: '0 0 1.5rem 0',
          fontSize: '1.2rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          All Banks ({banks.length})
        </h3>
        
        {/* Search */}
        <div style={{
          marginBottom: '1.5rem'
        }}>
          
          {/* Search Bar */}
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-secondary)',
              fontSize: '0.9rem'
            }}>🔍</span>
            <input
              id="bank-search"
              name="bankSearch"
              type="text"
              placeholder="Search banks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: '8px 12px 8px 36px',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                width: '250px',
                transition: 'all 0.2s ease'
              }}
            />
          </div>
        </div>

        {/* Banks Table */}
        {banksLoading && !loadingTimeout ? (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px dashed var(--border-color)'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}>⏳</div>
            <h3 style={{
              margin: '0 0 0.5rem 0',
              color: 'var(--text-secondary)',
              fontSize: '1.1rem',
              fontWeight: '500'
            }}>
              Loading banks...
            </h3>
            <p style={{
              margin: 0,
              color: 'var(--text-muted)',
              fontSize: '0.85rem'
            }}>
              Please wait while we fetch the bank data
            </p>
          </div>
        ) : loadingTimeout && banksLoading ? (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px dashed var(--border-color)'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}>⚠️</div>
            <h3 style={{
              margin: '0 0 0.5rem 0',
              color: 'var(--warning-color)',
              fontSize: '1.1rem',
              fontWeight: '500'
            }}>
              Connection timeout
            </h3>
            <p style={{
              margin: 0,
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
              marginBottom: '1rem'
            }}>
              Unable to connect to the database. Please check your connection.
            </p>
            <button
              onClick={() => {
                setLoadingTimeout(false);
                window.location.reload();
              }}
              style={{
                padding: '8px 16px',
                background: 'var(--accent-color)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.9rem'
              }}
            >
              Retry
            </button>
          </div>
        ) : banks.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px dashed var(--border-color)'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}>🏛️</div>
            <h3 style={{
              margin: '0 0 0.5rem 0',
              color: 'var(--text-secondary)',
              fontSize: '1.1rem',
              fontWeight: '500'
            }}>
              No banks found
            </h3>
            <p style={{
              margin: 0,
              color: 'var(--text-muted)',
              fontSize: '0.85rem'
            }}>
              {searchTerm ? `No results for "${searchTerm}"` : 'Add your first bank using the form above'}
            </p>
          </div>
        ) : (
          <div style={{
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid var(--border-color)'
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse'
            }}>
              <thead>
                <tr style={{
                  background: 'var(--bg-tertiary)',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  <th style={{
                    padding: '14px 16px',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.75px'
                  }}>
                    Bank Name
                  </th>
                  <th style={{
                    padding: '14px 16px',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.75px'
                  }}>
                    City
                  </th>
                  <th style={{
                    padding: '14px 16px',
                    textAlign: 'left',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.75px'
                  }}>
                    Country
                  </th>
                  <th style={{
                    padding: '14px 16px',
                    textAlign: 'center',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.75px',
                    width: '100px'
                  }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {banks.map((bank, index) => (
                  <tr 
                    key={bank._id}
                    style={{
                      borderBottom: index === banks.length - 1 ? 'none' : '1px solid var(--border-color)',
                      transition: 'background-color 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <td style={{
                      padding: '14px 16px',
                      fontSize: '0.9rem',
                      color: 'var(--text-primary)',
                      fontWeight: '500'
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.2rem' }}>{getBankLogo(bank.name)}</span>
                        {bank.name}
                      </span>
                    </td>
                    <td style={{
                      padding: '14px 16px',
                      fontSize: '0.9rem',
                      color: 'var(--text-primary)'
                    }}>
                      {bank.city}
                    </td>
                    <td style={{
                      padding: '14px 16px',
                      fontSize: '0.9rem',
                      color: 'var(--text-primary)'
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1.1rem' }}>
                          {bank.countryCode === 'CH' && '🇨🇭'}
                          {bank.countryCode === 'US' && '🇺🇸'}
                          {bank.countryCode === 'GB' && '🇬🇧'}
                          {bank.countryCode === 'DE' && '🇩🇪'}
                          {bank.countryCode === 'FR' && '🇫🇷'}
                          {bank.countryCode === 'IT' && '🇮🇹'}
                          {bank.countryCode === 'ES' && '🇪🇸'}
                          {bank.countryCode === 'NL' && '🇳🇱'}
                          {bank.countryCode === 'BE' && '🇧🇪'}
                          {bank.countryCode === 'AT' && '🇦🇹'}
                          {bank.countryCode === 'SE' && '🇸🇪'}
                          {bank.countryCode === 'NO' && '🇳🇴'}
                          {bank.countryCode === 'DK' && '🇩🇰'}
                          {bank.countryCode === 'FI' && '🇫🇮'}
                          {bank.countryCode === 'JP' && '🇯🇵'}
                          {bank.countryCode === 'CN' && '🇨🇳'}
                          {bank.countryCode === 'HK' && '🇭🇰'}
                          {bank.countryCode === 'SG' && '🇸🇬'}
                          {bank.countryCode === 'AU' && '🇦🇺'}
                          {bank.countryCode === 'CA' && '🇨🇦'}
                          {!['CH','US','GB','DE','FR','IT','ES','NL','BE','AT','SE','NO','DK','FI','JP','CN','HK','SG','AU','CA'].includes(bank.countryCode) && '🏳️'}
                        </span>
                        {bank.country} ({bank.countryCode})
                      </span>
                    </td>
                    <td style={{
                      padding: '14px 16px',
                      textAlign: 'center'
                    }}>
                      <button
                        onClick={() => handleDeactivateBank(bank._id)}
                        style={{
                          padding: '6px 12px',
                          background: 'transparent',
                          color: 'var(--danger-color)',
                          border: '1px solid var(--danger-color)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: '500',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.background = 'var(--danger-color)';
                          e.target.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.background = 'transparent';
                          e.target.style.color = 'var(--danger-color)';
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Dialog */}
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
});

export default BankManagement;