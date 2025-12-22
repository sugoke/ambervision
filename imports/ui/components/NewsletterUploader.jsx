import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import ReactDOM from 'react-dom';

const NewsletterUploader = ({ onClose, user }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('market-update');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');

  const categories = [
    { id: 'market-update', label: 'Market Update', icon: '📊' },
    { id: 'research', label: 'Research', icon: '🔬' },
    { id: 'news', label: 'News', icon: '📢' }
  ];

  // Handle file selection
  const handleFileSelect = (file) => {
    setError('');

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are allowed');
      return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
  };

  // Handle drag events
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Handle file input change
  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Convert file to base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handle upload
  const handleUpload = async () => {
    if (!title.trim()) {
      setError('Please enter a title');
      return;
    }

    if (!description.trim()) {
      setError('Please enter a description');
      return;
    }

    if (!selectedFile) {
      setError('Please select a file');
      return;
    }

    setIsUploading(true);
    setUploadProgress(20);
    setError('');

    try {
      // Convert file to base64
      setUploadProgress(40);
      const base64Data = await fileToBase64(selectedFile);

      setUploadProgress(60);

      // Upload to server
      const sessionId = localStorage.getItem('sessionId');
      const result = await Meteor.callAsync('newsletters.upload', {
        title: title.trim(),
        description: description.trim(),
        category: category,
        filename: selectedFile.name,
        fileData: base64Data,
        fileSize: selectedFile.size,
        visibleToRoles: ['client', 'rm', 'admin', 'superadmin']
      }, sessionId);

      setUploadProgress(100);

      console.log('Newsletter uploaded successfully:', result);

      // Close modal after short delay
      setTimeout(() => {
        onClose();
      }, 500);

    } catch (err) {
      console.error('Upload error:', err);
      setError(err.reason || err.message || 'Failed to upload newsletter');
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        backdropFilter: 'blur(4px)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          borderRadius: '16px',
          padding: '2rem',
          width: '90%',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          border: '1px solid var(--border-color)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.5rem'
        }}>
          <h2 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: '700',
            color: 'var(--text-primary)'
          }}>
            📤 Upload Newsletter
          </h2>
          <button
            onClick={onClose}
            disabled={isUploading}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              cursor: isUploading ? 'not-allowed' : 'pointer',
              color: 'var(--text-secondary)',
              opacity: isUploading ? 0.5 : 1
            }}
          >
            ✕
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            padding: '1rem',
            background: 'rgba(220, 53, 69, 0.1)',
            border: '1px solid rgba(220, 53, 69, 0.3)',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            color: '#dc3545',
            fontSize: '0.9rem'
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Title Input */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isUploading}
              placeholder="e.g., Monthly Market Review - January 2025"
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                fontSize: '1rem',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)'
              }}
            />
          </div>

          {/* Description Input */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Description *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isUploading}
              placeholder="Brief description of the newsletter content..."
              rows={3}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                fontSize: '1rem',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                resize: 'vertical'
              }}
            />
          </div>

          {/* Category Selection */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Category *
            </label>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  disabled={isUploading}
                  style={{
                    padding: '0.75rem 1.25rem',
                    border: category === cat.id ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                    borderRadius: '8px',
                    background: category === cat.id ? 'var(--accent-color)' : 'var(--bg-primary)',
                    color: category === cat.id ? 'white' : 'var(--text-primary)',
                    fontSize: '0.9rem',
                    fontWeight: '500',
                    cursor: isUploading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    opacity: isUploading ? 0.5 : 1
                  }}
                >
                  <span>{cat.icon}</span>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* File Upload Area */}
          <div>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '0.9rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              PDF File * (Max 10MB)
            </label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                border: isDragging
                  ? '2px dashed var(--accent-color)'
                  : '2px dashed var(--border-color)',
                borderRadius: '12px',
                padding: '2rem',
                textAlign: 'center',
                background: isDragging
                  ? 'rgba(0, 123, 255, 0.05)'
                  : 'var(--bg-primary)',
                transition: 'all 0.2s ease',
                cursor: isUploading ? 'not-allowed' : 'pointer',
                opacity: isUploading ? 0.5 : 1
              }}
              onClick={() => {
                if (!isUploading) {
                  document.getElementById('file-input').click();
                }
              }}
            >
              {selectedFile ? (
                <div>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📄</div>
                  <div style={{
                    fontSize: '1rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    marginBottom: '0.25rem'
                  }}>
                    {selectedFile.name}
                  </div>
                  <div style={{
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)'
                  }}>
                    {formatFileSize(selectedFile.size)}
                  </div>
                  {!isUploading && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                      style={{
                        marginTop: '0.75rem',
                        padding: '0.5rem 1rem',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        color: 'var(--text-secondary)'
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📁</div>
                  <p style={{
                    margin: '0 0 0.5rem 0',
                    fontSize: '1rem',
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    Drop PDF file here
                  </p>
                  <p style={{
                    margin: 0,
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)'
                  }}>
                    or click to browse
                  </p>
                </div>
              )}
            </div>
            <input
              id="file-input"
              type="file"
              accept=".pdf"
              onChange={handleFileInputChange}
              disabled={isUploading}
              style={{ display: 'none' }}
            />
          </div>

          {/* Upload Progress */}
          {isUploading && (
            <div>
              <div style={{
                height: '8px',
                background: 'var(--bg-tertiary)',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--accent-color), #4da6ff)',
                  width: `${uploadProgress}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <p style={{
                margin: '0.5rem 0 0 0',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                textAlign: 'center'
              }}>
                Uploading... {uploadProgress}%
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{
            display: 'flex',
            gap: '1rem',
            marginTop: '0.5rem'
          }}>
            <button
              onClick={onClose}
              disabled={isUploading}
              style={{
                flex: 1,
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: isUploading ? 'not-allowed' : 'pointer',
                color: 'var(--text-secondary)',
                opacity: isUploading ? 0.5 : 1
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={isUploading || !title.trim() || !description.trim() || !selectedFile}
              style={{
                flex: 1,
                padding: '0.75rem',
                background: isUploading || !title.trim() || !description.trim() || !selectedFile
                  ? 'var(--bg-tertiary)'
                  : 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: isUploading || !title.trim() || !description.trim() || !selectedFile
                  ? 'not-allowed'
                  : 'pointer',
                color: isUploading || !title.trim() || !description.trim() || !selectedFile
                  ? 'var(--text-muted)'
                  : 'white',
                transition: 'all 0.2s ease'
              }}
            >
              {isUploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modalContent, document.body);
};

export default NewsletterUploader;
