#!/bin/bash
# Product Allocation Enhancement - Quick Apply Script
# Run this from the project root: bash APPLY_CHANGES.sh

echo "🚀 Applying Product Allocation Enhancements..."
echo ""

# Step 1: Backup existing files
echo "📦 Creating backups..."
cp imports/api/allocations.js imports/api/allocations.js.backup
cp imports/ui/ProductAllocation.jsx imports/ui/ProductAllocation.jsx.backup
echo "✅ Backups created"
echo ""

# Step 2: Apply allocations.js changes
echo "📝 Updating allocations.js..."
cp imports/api/allocations_UPDATED.js imports/api/allocations.js
echo "✅ allocations.js updated"
echo ""

# Step 3: Apply ProductAllocation.jsx changes
echo "📝 Updating ProductAllocation.jsx..."
cp imports/ui/ProductAllocation_UPDATED.jsx imports/ui/ProductAllocation.jsx
echo "✅ ProductAllocation.jsx updated"
echo ""

# Step 4: Remind about server/main.js
echo "⚠️  MANUAL STEP REQUIRED:"
echo "   Please add the methods from SERVER_METHODS_TO_ADD.js to server/main.js"
echo "   Location: After line 3656 (after allocations.create method)"
echo "   Methods: allocations.update and allocations.delete"
echo ""

# Step 5: Clean up temp files
echo "🧹 Cleaning up temporary files..."
rm -f imports/api/allocations_UPDATED.js
rm -f imports/ui/ProductAllocation_UPDATED.jsx
echo "✅ Cleanup complete"
echo ""

echo "✨ Done! Remember to:"
echo "   1. Add server methods from SERVER_METHODS_TO_ADD.js to server/main.js"
echo "   2. Restart Meteor server if running"
echo "   3. Test the new allocation features"
echo ""
echo "📚 See IMPLEMENTATION_SUMMARY.md for detailed documentation"
