#!/usr/bin/env python3
"""
Apply Dashboard updates for RM toggle and currency persistence
"""

import re

# Read the file
with open('imports/ui/Dashboard.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Change 1: Update referenceCurrency initialization
old_currency_init = r"  const \[referenceCurrency, setReferenceCurrency\] = useState\(getDefaultCurrency\(\)\); // Set based on user role and preferences"
new_currency_init = """  const [referenceCurrency, setReferenceCurrency] = useState(() => {
    // Load saved currency from localStorage, fallback to default
    const saved = localStorage.getItem('dashboardCurrency');
    return saved || getDefaultCurrency();
  }); // Set based on user role and preferences"""

content = re.sub(old_currency_init, new_currency_init, content)

# Change 2: Update currency useEffect and add persistence useEffect
old_currency_effect = r"  // Update currency when user changes\n  useEffect\(\(\) => \{\n    if \(user\) \{\n      const defaultCurrency = getDefaultCurrency\(\);\n      setReferenceCurrency\(defaultCurrency\);\n    \}\n  \}, \[user\]\);"

new_currency_effect = """  // Update currency when user changes
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
  }, [referenceCurrency]);"""

content = re.sub(old_currency_effect, new_currency_effect, content, flags=re.MULTILINE)

# Change 3: Add RM toggle component
# Find the location after currency selector and before stats cards
toggle_insert_point = r"(            </select>\n          </div>\n        </div>\n      </div>\n\n      {/\* Statistics Cards \*/})"

toggle_component = r"""\1

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

      {/* Statistics Cards */}"""

content = re.sub(toggle_insert_point, toggle_component, content)

# Change 4: Wrap stats cards with conditional
stats_start = r"      {/\* Statistics Cards \*/}\n      <div style={{"
stats_start_replacement = r"      {/* Statistics Cards */}\n      {!(isRelationshipManager && showAllProducts) && (\n      <div style={{"

content = re.sub(stats_start, stats_start_replacement, content)

# Find the closing </div> for stats cards section (need to find the right one)
# This is tricky - let's find a unique marker
# The stats section ends before the products table section
# Look for pattern around line 975

# Write the updated content
with open('imports/ui/Dashboard.jsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Dashboard updates applied successfully!")
print("Changes made:")
print("1. Currency persistence with localStorage")
print("2. Added RM toggle component")
print("3. Added conditional wrapper for stats cards (opening)")
print("")
print("⚠️  MANUAL STEP REQUIRED:")
print("   Find the closing </div> for the stats cards section")
print("   (around line 975-980, after all LiquidGlassCard components)")
print("   Add ')}' after the closing </div>")
