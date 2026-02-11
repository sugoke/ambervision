import React, { useState, useMemo, useRef } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { IssuersCollection } from '/imports/api/issuers';
import Dialog from './Dialog.jsx';
import { useDialog } from './useDialog.js';

const IssuerManagementComponent = ({ user: currentUser }) => {
  const [newIssuerName, setNewIssuerName] = useState('');
  const [newIssuerCode, setNewIssuerCode] = useState('');
  const [editingIssuer, setEditingIssuer] = useState(null);
  const { dialogState, showConfirm, hideDialog } = useDialog();
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingLogoFor, setUploadingLogoFor] = useState(null);
  const fileInputRef = useRef(null);

  const handleLogoUpload = (issuerId) => {
    setUploadingLogoFor(issuerId);
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const handleFileSelected = (e) => {
    const file = e.target.files[0];
    if (!file || !uploadingLogoFor) return;

    if (file.size > 500 * 1024) {
      setError('Logo must be smaller than 500KB');
      setUploadingLogoFor(null);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      setUploadingLogoFor(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const logoData = event.target.result;
      const sessionId = localStorage.getItem('sessionId');
      Meteor.call('issuers.uploadLogo', { issuerId: uploadingLogoFor, logoData, sessionId }, (err) => {
        setUploadingLogoFor(null);
        if (err) {
          setError(err.reason);
        } else {
          setSuccess('Logo uploaded successfully!');
        }
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = (issuerId) => {
    clearMessages();
    const sessionId = localStorage.getItem('sessionId');
    Meteor.call('issuers.removeLogo', { issuerId, sessionId }, (err) => {
      if (err) {
        setError(err.reason);
      } else {
        setSuccess('Logo removed successfully!');
      }
    });
  };

  // Function to get issuer logo emoji based on issuer name
  const getIssuerLogo = (issuerName) => {
    const name = issuerName.toLowerCase();
    if (name.includes('goldman sachs') || name.includes('gs')) return '💰'; // Goldman Sachs gold
    if (name.includes('morgan stanley') || name.includes('ms')) return '📊'; // Morgan Stanley chart
    if (name.includes('jp morgan') || name.includes('jpmorgan')) return '🏦'; // JPMorgan
    if (name.includes('citigroup') || name.includes('citi')) return '🌐'; // Citi global
    if (name.includes('bank of america') || name.includes('boa') || name.includes('merrill lynch')) return '🇺🇸'; // BofA
    if (name.includes('wells fargo')) return '🐎'; // Wells Fargo
    if (name.includes('deutsche bank') || name.includes('db')) return '🇩🇪'; // Deutsche Bank
    if (name.includes('ubs')) return '🟦'; // UBS blue square
    if (name.includes('credit suisse') || name.includes('cs')) return '🔷'; // Credit Suisse blue diamond
    if (name.includes('barclays')) return '🦅'; // Barclays eagle
    if (name.includes('hsbc')) return '🔺'; // HSBC triangle
    if (name.includes('bnp paribas')) return '🇫🇷'; // BNP Paribas
    if (name.includes('societe generale') || name.includes('sg')) return '⚪'; // Societe Generale
    if (name.includes('unicredit')) return '🇮🇹'; // UniCredit
    if (name.includes('santander')) return '🔴'; // Santander red
    if (name.includes('ing')) return '🧡'; // ING orange
    if (name.includes('commerzbank')) return '💛'; // Commerzbank yellow
    if (name.includes('nomura')) return '🇯🇵'; // Nomura Japanese
    if (name.includes('mizuho')) return '🌸'; // Mizuho cherry blossom
    if (name.includes('daiwa')) return '🗾'; // Daiwa Japan
    return '🏢'; // Default issuer icon
  };

  // Memoize subscription to prevent re-initialization
  const subscription = useMemo(() => Meteor.subscribe('issuers'), []);

  const { issuers, isLoadingIssuers } = useTracker(() => {
    return {
      issuers: IssuersCollection.find({}, { sort: { name: 1 } }).fetch(),
      isLoadingIssuers: !subscription.ready()
    };
  }, [subscription.ready()]);


  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const handleCreateIssuer = (e) => {
    e.preventDefault();
    clearMessages();

    if (!newIssuerName.trim() || !newIssuerCode.trim()) {
      setError('Both name and code are required');
      return;
    }

    setIsSubmitting(true);
    const sessionId = localStorage.getItem('sessionId');
    Meteor.call('issuers.create', {
      name: newIssuerName.trim(),
      code: newIssuerCode.trim(),
      sessionId
    }, (err) => {
      setIsSubmitting(false);
      if (err) {
        setError(err.reason);
      } else {
        setSuccess('Issuer created successfully!');
        setNewIssuerName('');
        setNewIssuerCode('');
      }
    });
  };

  const handleEditIssuer = (issuer) => {
    setEditingIssuer(issuer._id);
    setEditName(issuer.name);
    setEditCode(issuer.code);
    clearMessages();
  };

  const handleSaveEdit = () => {
    clearMessages();

    if (!editName.trim() || !editCode.trim()) {
      setError('Both name and code are required');
      return;
    }

    const sessionId = localStorage.getItem('sessionId');
    Meteor.call('issuers.update', editingIssuer, {
      name: editName.trim(),
      code: editCode.trim(),
      sessionId
    }, (err) => {
      if (err) {
        setError(err.reason);
      } else {
        setSuccess('Issuer updated successfully!');
        setEditingIssuer(null);
        setEditName('');
        setEditCode('');
      }
    });
  };

  const handleCancelEdit = () => {
    setEditingIssuer(null);
    setEditName('');
    setEditCode('');
    clearMessages();
  };

  const handleToggleActive = (issuerId, currentActive) => {
    clearMessages();
    
    const sessionId = localStorage.getItem('sessionId');
    Meteor.call('issuers.toggleActive', issuerId, !currentActive, sessionId, (err) => {
      if (err) {
        setError(err.reason);
      } else {
        setSuccess(`Issuer ${!currentActive ? 'activated' : 'deactivated'} successfully!`);
      }
    });
  };

  const handleDeleteIssuer = async (issuerId, issuerName) => {
    const confirmed = await showConfirm(`Are you sure you want to delete "${issuerName}"? This action cannot be undone.`);
    if (confirmed) {
      clearMessages();
      
      const sessionId = localStorage.getItem('sessionId');
      Meteor.call('issuers.remove', issuerId, sessionId, (err) => {
        if (err) {
          setError(err.reason);
        } else {
          setSuccess('Issuer deleted successfully!');
        }
      });
    }
  };

  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <h3>Access Denied</h3>
        <p>You need admin privileges to manage issuers.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Create New Issuer Form */}
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
          Create New Issuer
        </h3>
        <form onSubmit={handleCreateIssuer}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <div>
              <label htmlFor="issuer-name" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Issuer Name:
              </label>
              <input
                id="issuer-name"
                name="issuerName"
                type="text"
                value={newIssuerName}
                onChange={(e) => setNewIssuerName(e.target.value)}
                required
                placeholder="e.g., Goldman Sachs"
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
              <label htmlFor="issuer-code" style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Issuer Code:
              </label>
              <input
                id="issuer-code"
                name="issuerCode"
                type="text"
                value={newIssuerCode}
                onChange={(e) => setNewIssuerCode(e.target.value.toUpperCase())}
                required
                placeholder="e.g., GS"
                maxLength="10"
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
          </div>

          <button type="submit" disabled={isSubmitting} style={{ 
            padding: '12px 24px', 
            background: isSubmitting 
              ? 'var(--text-muted)' 
              : 'var(--success-color)',
            color: 'white', 
            border: 'none', 
            borderRadius: '8px',
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            fontSize: '1rem',
            fontWeight: '600',
            transition: 'all 0.2s ease',
            boxShadow: isSubmitting ? 'none' : '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            {isSubmitting ? 'Creating...' : 'Create Issuer'}
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

      {/* Issuers List */}
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
          All Issuers ({issuers.length})
        </h3>

        {isLoadingIssuers ? (
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
              Loading issuers...
            </h3>
            <p style={{
              margin: 0,
              color: 'var(--text-muted)',
              fontSize: '0.85rem'
            }}>
              Please wait while we fetch the issuer data
            </p>
          </div>
        ) : issuers.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '3rem 2rem',
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            border: '1px dashed var(--border-color)'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.3 }}>🏢</div>
            <h3 style={{
              margin: '0 0 0.5rem 0',
              color: 'var(--text-secondary)',
              fontSize: '1.1rem',
              fontWeight: '500'
            }}>
              No issuers found
            </h3>
            <p style={{
              margin: 0,
              color: 'var(--text-muted)',
              fontSize: '0.85rem'
            }}>
              Add your first issuer using the form above
            </p>
          </div>
        ) : (
          <div style={{ 
            overflowX: 'auto',
            position: 'relative',
            zIndex: 1
          }}>
            <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse',
              border: '1px solid var(--border-color)',
              position: 'relative'
            }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center', width: '80px' }}>Logo</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>Name</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>Code</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'left' }}>Created</th>
                <th style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {issuers.map((issuer) => (
                <tr key={issuer._id} style={{ 
                  backgroundColor: issuer.active ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                  opacity: issuer.active ? 1 : 0.7
                }}>
                  <td style={{ padding: '8px 12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                      {issuer.logo ? (
                        <div style={{ position: 'relative', display: 'inline-block' }}>
                          <img
                            src={issuer.logo}
                            alt={issuer.name}
                            style={{
                              width: '32px',
                              height: '32px',
                              objectFit: 'contain',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              cursor: 'pointer'
                            }}
                            onClick={() => handleLogoUpload(issuer._id)}
                            title="Click to replace logo"
                          />
                          <button
                            onClick={() => handleRemoveLogo(issuer._id)}
                            title="Remove logo"
                            style={{
                              position: 'absolute',
                              top: '-6px',
                              right: '-6px',
                              width: '16px',
                              height: '16px',
                              borderRadius: '50%',
                              border: 'none',
                              background: 'var(--danger-color)',
                              color: 'white',
                              fontSize: '0.6rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              lineHeight: 1,
                              padding: 0
                            }}
                          >
                            x
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleLogoUpload(issuer._id)}
                          disabled={uploadingLogoFor === issuer._id}
                          title="Upload logo"
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '4px',
                            border: '2px dashed var(--border-color)',
                            background: 'var(--bg-secondary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.9rem',
                            color: 'var(--text-muted)',
                            padding: 0
                          }}
                        >
                          {uploadingLogoFor === issuer._id ? '...' : '+'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                    {editingIssuer === issuer._id ? (
                      <input
                        id={`edit-issuer-name-${issuer._id}`}
                        name={`editIssuerName-${issuer._id}`}
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{ 
                          width: '100%', 
                          padding: '4px', 
                          border: '1px solid var(--border-color)', 
                          borderRadius: '3px',
                          backgroundColor: 'var(--bg-primary)',
                          color: 'var(--text-primary)'
                        }}
                      />
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1.2rem' }}>{getIssuerLogo(issuer.name)}</span>
                        {issuer.name}
                      </span>
                    )}
                  </td>
                  
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                    {editingIssuer === issuer._id ? (
                      <input
                        id={`edit-issuer-code-${issuer._id}`}
                        name={`editIssuerCode-${issuer._id}`}
                        type="text"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                        maxLength="10"
                        style={{ 
                          width: '100%', 
                          padding: '4px', 
                          border: '1px solid var(--border-color)', 
                          borderRadius: '3px',
                          backgroundColor: 'var(--bg-primary)',
                          color: 'var(--text-primary)'
                        }}
                      />
                    ) : (
                      <code style={{ 
                        backgroundColor: 'var(--bg-tertiary)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '0.9em'
                      }}>
                        {issuer.code}
                      </code>
                    )}
                  </td>
                  
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <span style={{
                      padding: '4px 8px',
                      backgroundColor: issuer.active ? 'var(--success-color)' : 'var(--danger-color)',
                      color: 'white',
                      borderRadius: '3px',
                      fontSize: '0.8em'
                    }}>
                      {issuer.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)' }}>
                    {issuer.createdAt ? new Date(issuer.createdAt).toLocaleDateString() : 'Unknown'}
                  </td>
                  
                  <td style={{ padding: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    {editingIssuer === issuer._id ? (
                      <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                        <button
                          onClick={handleSaveEdit}
                          style={{ 
                            padding: '4px 8px', 
                            backgroundColor: 'var(--success-color)', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '0.8em'
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          style={{ 
                            padding: '4px 8px', 
                            backgroundColor: 'var(--text-muted)', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '0.8em'
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '5px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => handleEditIssuer(issuer)}
                          style={{ 
                            padding: '4px 8px', 
                            backgroundColor: 'var(--accent-color)', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '0.8em'
                          }}
                        >
                          Edit
                        </button>
                        
                        <button
                          onClick={() => handleToggleActive(issuer._id, issuer.active)}
                          style={{ 
                            padding: '4px 8px', 
                            backgroundColor: issuer.active ? '#ff9800' : 'var(--success-color)', 
                            color: 'white',
                            border: 'none', 
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontSize: '0.8em'
                          }}
                        >
                          {issuer.active ? 'Deactivate' : 'Activate'}
                        </button>
                        
                        {currentUser.role === 'superadmin' && (
                          <button
                            onClick={() => handleDeleteIssuer(issuer._id, issuer.name)}
                            style={{ 
                              padding: '4px 8px', 
                              backgroundColor: 'var(--danger-color)', 
                              color: 'white', 
                              border: 'none', 
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontSize: '0.8em'
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
      
      {/* Hidden file input for logo uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {/* Global Dialog Component */}
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
      >
        {dialogState.children}
      </Dialog>
    </div>
  );
};

export default IssuerManagementComponent;