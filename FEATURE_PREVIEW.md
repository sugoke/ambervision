# Product Allocation Enhancement - Feature Preview

## What You'll See

### Before (Original)
```
┌─────────────────────────────────────────────────────┐
│ Allocate Product: Product Name                     │
│ ISIN: CH1234567890                                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Add New Allocation                                 │
│ ┌─────────────────────────────────────────────┐   │
│ │ Client: [dropdown]   Bank: [dropdown]       │   │
│ │ Nominal: [100000]    Price: [100]%          │   │
│ │ [+ Add to Batch]                            │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│ Allocation Batch (2 items)                        │
│ ┌─────────────────────────────────────────────┐   │
│ │ Client      │ Bank      │ Amount │ Remove   │   │
│ │ John Doe    │ UBS       │ 100000 │ [Remove] │   │
│ │ Jane Smith  │ CS        │ 50000  │ [Remove] │   │
│ └─────────────────────────────────────────────┘   │
│                                                     │
│                          [Cancel] [Validate Batch] │
└─────────────────────────────────────────────────────┘
```

### After (Enhanced)
```
┌────────────────────────────────────────────────────────────────┐
│ Allocate Product: Product Name                                │
│ ISIN: CH1234567890                                            │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ ✨ Current Positions (3)                                      │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Client      │ Bank Acct   │ Nominal    │ Price   │ Acts │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ John Doe    │ UBS - 12345 │ 100,000.50 │ 98.50%  │ 🔧📋 │ │
│ │ john@...    │ CHF         │            │         │      │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Jane Smith  │ CS - 67890  │ 50,000.00  │ 100.00% │ 🔧📋 │ │
│ │ jane@...    │ USD         │            │         │      │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │ Bob Jones   │ UBS - 54321 │ 75,250.25  │ 99.75%  │ 🔧📋 │ │
│ │ bob@...     │ EUR         │            │         │      │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ Add New Allocation                                            │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Client: [dropdown]   Bank: [dropdown]                    │ │
│ │ Nominal: [100000.50] Price: [100.00]%                    │ │
│ │ [+ Add to Batch]                                         │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                │
│ Allocation Batch (1 items)                                   │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Client      │ Bank      │ Amount     │ Price   │ Remove │ │
│ │ Alice Lee   │ UBS       │ 25,000.00  │ 98.50%  │ [X]   │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                                │
│                             [Close] [Validate Batch (1 item)] │
└────────────────────────────────────────────────────────────────┘
```

## Interactive Features

### 1. Viewing Current Positions
- **What**: Table showing all active allocations for the product
- **Where**: Top of the modal, before "Add New Allocation"
- **Displays**:
  - Client name and email
  - Bank name and account number
  - Currency
  - Nominal invested (formatted: `100,000.50`)
  - Purchase price (formatted: `98.50%`)
  - Edit and Delete buttons

### 2. Editing an Allocation
**Click "Edit" button**
```
Before Edit:
┌────────────────────────────────────────────────────┐
│ John Doe    │ UBS - 12345 │ 100,000.50 │ 98.50% │
│ john@...    │ CHF         │            │  [Edit] [Delete] │
└────────────────────────────────────────────────────┘

After Click Edit:
┌────────────────────────────────────────────────────┐
│ [John Doe ▼]│ [UBS-12345▼]│ [100000.50]│ [98.50]│
│             │              │            │  [Save] [Cancel] │
└────────────────────────────────────────────────────┘
```

**Editable Fields**:
- Client (dropdown)
- Bank Account (dropdown - filtered by selected client)
- Nominal Invested (number input with decimals)
- Purchase Price (number input with decimals)

**Actions**:
- **Save**: Updates the allocation in database
- **Cancel**: Discards changes

### 3. Deleting an Allocation
**Click "Delete" button**
```
Before Delete:
┌────────────────────────────────────────────────────┐
│ John Doe    │ UBS - 12345 │ 100,000.50 │ 98.50% │
│ john@...    │ CHF         │            │  [Edit] [Delete] │
└────────────────────────────────────────────────────┘

After Click Delete:
┌────────────────────────────────────────────────────┐
│ John Doe    │ UBS - 12345 │ 100,000.50 │ 98.50% │
│ john@...    │ CHF         │  Confirm? [Yes] [No] │
└────────────────────────────────────────────────────┘
```

**Actions**:
- **Yes**: Permanently deletes the allocation
- **No**: Cancels the deletion

### 4. Number Formatting Examples

**Input**: User types in forms
```
Nominal Invested: 100000.5
Purchase Price: 98.5
```

**Display**: Formatted in tables
```
Nominal Invested: 100,000.50
Purchase Price: 98.50%
```

**All Formats**:
- `100000.5` → `100,000.50`
- `50000` → `50,000.00`
- `1234.567` → `1,234.57` (rounded)
- `98.5` → `98.50%`
- `100` → `100.00%`

## User Flows

### Flow 1: View and Edit Existing Position
1. Open allocation modal for a product
2. See "Current Positions" table at top
3. Click "Edit" on a position
4. Modify nominal amount from `100,000.00` to `125,500.50`
5. Click "Save"
6. See success message
7. Position updated in table

### Flow 2: Delete a Position (with safety)
1. Open allocation modal
2. Click "Delete" on a position
3. See "Confirm? Yes / No"
4. Click "No" → cancelled
5. Click "Delete" again
6. Click "Yes" → position removed
7. See success message
8. Position disappears from table

### Flow 3: Add New Allocation with Decimal Precision
1. Open allocation modal
2. Select client from dropdown
3. Select bank account
4. Enter nominal: `50000.75`
5. Enter price: `99.25`
6. Click "+ Add to Batch"
7. See batch table with formatted values:
   - Amount: `50,000.75`
   - Price: `99.25%`
8. Click "Validate Batch"
9. New allocation created

### Flow 4: Mixed Operations
1. Edit existing position (change amount)
2. Delete another position
3. Add new position to batch
4. Submit batch
5. All operations complete successfully

## Visual Indicators

### State Indicators
- **Normal row**: Default background
- **Editing row**: Light blue background (`rgba(59, 130, 246, 0.05)`)
- **Delete confirm**: Warning buttons (red "Yes", gray "No")

### Button States
- **Enabled**: Full color, pointer cursor
- **Disabled**: Grayed out, not-allowed cursor
- **Loading**: Shows "Validating Batch..." text

### Feedback Messages
- **Success**: Green background, green border
  ```
  ✅ Allocation updated successfully!
  ✅ Allocation deleted successfully!
  ✅ Allocations saved successfully!
  ```
- **Error**: Red background, red border
  ```
  ❌ Nominal invested must be greater than 0
  ❌ Failed to update allocation: [reason]
  ```

## Keyboard Support
- `Tab`: Navigate between fields when editing
- `Enter`: Submit form when in input field
- `Escape`: Could be added to cancel edit (future enhancement)

## Mobile Responsiveness
- Table scrolls horizontally on small screens
- Modal width: 1100px max (was 900px)
- All buttons remain accessible
- Touch-friendly button sizes

## Data Validation

### Client-Side
- ✓ Nominal invested must be > 0
- ✓ Purchase price must be > 0
- ✓ Client must be selected
- ✓ Bank account must belong to client

### Server-Side
- ✓ Session validation
- ✓ Admin/SuperAdmin role check
- ✓ Allocation exists check
- ✓ Client is valid and has CLIENT role
- ✓ Bank account belongs to client
- ✓ Bank account is active
- ✓ All numbers are positive

## Error Handling

Common errors and their messages:
```
❌ "You must be logged in to update allocations"
   → Session expired, user needs to log in again

❌ "Only administrators can update allocations"
   → User doesn't have permission

❌ "Allocation not found"
   → Allocation was already deleted

❌ "Invalid client ID"
   → Client doesn't exist or isn't a CLIENT role

❌ "Invalid bank account for client"
   → Account doesn't belong to selected client

❌ "Nominal invested must be greater than 0"
   → Invalid input value
```

## Performance Notes
- Existing allocations loaded via `productAllocations` subscription
- Updates happen in real-time (reactive)
- No page refresh needed
- Optimistic UI updates (immediate feedback)
