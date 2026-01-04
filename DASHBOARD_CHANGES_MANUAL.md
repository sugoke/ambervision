# Dashboard Changes - Manual Application Guide

## Change 1: Currency Persistence (Line 43)

**Find (line 43):**
```javascript
  const [referenceCurrency, setReferenceCurrency] = useState(getDefaultCurrency()); // Set based on user role and preferences
```

**Replace with:**
```javascript
  const [referenceCurrency, setReferenceCurrency] = useState(() => {
    // Load saved currency from localStorage, fallback to default
    const saved = localStorage.getItem('dashboardCurrency');
    return saved || getDefaultCurrency();
  }); // Set based on user role and preferences
```

## Change 2: Update Currency UseEffect (Lines 49-55)

**Find (lines 49-55):**
```javascript
  // Update currency when user changes
  useEffect(() => {
    if (user) {
      const defaultCurrency = getDefaultCurrency();
      setReferenceCurrency(defaultCurrency);
    }
  }, [user]);
```

**Replace with:**
```javascript
  // Update currency when user changes
  useEffect(() => {
    if (user) {
      const defaultCurrency = getDefaultCurrency();
      const savedCurrency = localStorage.getItem('dashboardCurrency');
      // Only reset to default if no saved preference exists
      if (!savedCurrency) {
        setReferenceCurrency(defaultCurrency);
      }
    }
  }, [user]);

  // Save currency preference to localStorage when it changes
  useEffect(() => {
    if (referenceCurrency) {
      localStorage.setItem('dashboardCurrency', referenceCurrency);
    }
  }, [referenceCurrency]);
```

## Change 3: Add RM Toggle Component (After line 823, before line 827)

**Find (around line 823-827):**
```javascript
            </select>
          </div>
        </div>
      </div>

      {/* Statistics Cards */}
```

**Insert BETWEEN these (after `</div>` before `{/* Statistics Cards */}`):**
```javascript
            </select>
          </div>

          {/* Relationship Manager Toggle - Show All Products */}
          {isRelationshipManager && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: isMobile ? '0 4px' : '0',
              marginLeft: isMobile ? '0' : '20px'
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                userSelect: 'none'
              }}>
                <input
                  type="checkbox"
                  checked={showAllProducts}
                  onChange={(e) => setShowAllProducts(e.target.checked)}
                  style={{
                    width: '18px',
                    height: '18px',
                    cursor: 'pointer',
                    accentColor: 'var(--accent-color)'
                  }}
                />
                <span style={{
                  color: 'var(--text-primary)',
                  fontSize: isMobile ? '1rem' : '0.95rem',
                  fontWeight: '500'
                }}>
                  {isMobile ? 'All Products' : 'Show All Products'}
                </span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Statistics Cards */}
```

## Change 4: Hide Stats Cards When Toggle is ON (Line 828)

**Find (line 828):**
```javascript
      {/* Statistics Cards */}
      <div style={{
```

**Replace with:**
```javascript
      {/* Statistics Cards */}
      {!(isRelationshipManager && showAllProducts) && (
      <div style={{
```

**And find the closing `</div>` for this section (around line 975-980) and add the closing bracket:**

**Find (around line 975):**
```javascript
        </LiquidGlassCard>
      </div>
```

**Replace with:**
```javascript
        </LiquidGlassCard>
      </div>
      )}
```

## Summary of Changes

1. **Currency Persistence**: Load from localStorage on init, save on change
2. **RM Toggle**: Add checkbox to toggle between "My Clients' Products" and "All Products"
3. **Hide Stats**: Hide statistics cards when RM is viewing all products

## Testing Checklist

- [ ] Select a currency → refresh page → currency persists
- [ ] Login as RM → see toggle checkbox
- [ ] Toggle ON → stats cards disappear, see all products
- [ ] Toggle OFF → stats cards reappear, see only client products
- [ ] Login as client → no toggle visible
- [ ] Login as superadmin → no toggle visible (or should see all by default)
