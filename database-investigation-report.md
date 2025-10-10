# Database Investigation Report
## Analysis of Multiple Databases on Ambervision2 Cluster

**Investigation Date:** August 6, 2025
**Investigator:** Claude Code
**Reason:** Confusion about which database is authoritative and why multiple databases exist

## Executive Summary

🚨 **CRITICAL FINDING:** There is a **major configuration mismatch** causing the application to use the wrong database!

- **Application Configuration:** Points to `ambervision2` database
- **Documentation & MCP Tools:** Point to `ambervisiondb` database  
- **Most Complete Data:** Exists in `ambervision2` database
- **Claude Code Interface:** Connected to `ambervisiondb` database

## Databases Found on Cluster

| Database | Size (MB) | Status | Document Count | Collections |
|----------|-----------|--------|----------------|-------------|
| `ambervision2` | 1.65 | **ACTIVE** | 120 docs | 13 collections |
| `ambervisiondb` | 0.52 | **PARTIAL** | 78 docs | 9 collections |  
| `ambervision` | N/A | **EMPTY** | 0 docs | 0 collections |
| `local` | 29,775 | System | N/A | N/A |
| `admin` | 0.35 | System | N/A | N/A |

## Configuration Analysis

### Current Application Settings (settings.json)
```json
{
  "private": {
    "MONGO_URL": "mongodb+srv://username:password@cluster.mongodb.net/ambervision2?retryWrites=true&w=majority",
    "MONGO_OPLOG_URL": "mongodb+srv://username:password@cluster.mongodb.net/local?authSource=admin&retryWrites=true&w=majority"
  }
}
```

### Claude Desktop MCP Configuration (claude_desktop_config.json)
```json
{
  "mcpServers": {
    "mongodb": {
      "env": {
        "MONGODB_URI": "mongodb+srv://username:password@cluster.mongodb.net/ambervisiondb?retryWrites=true&w=majority"
      }
    }
  }
}
```

### Documentation (CLAUDE.md)
```
Database name: ambervisiondb
Connection string: Stored in settings.json (excluded from version control)
```

## Detailed Data Comparison

### Collection-by-Collection Analysis

| Collection | ambervision2 | ambervisiondb | Winner |
|------------|--------------|---------------|--------|
| **customUsers** | 7 docs | 5 docs | ambervision2 ✅ |
| **sessions** | 3 docs | 2 docs | ambervision2 ✅ |
| **templates** | 1 doc | 1 doc | Tied 🤝 |
| **links** | 8 docs | 4 docs | ambervision2 ✅ |
| **bankAccounts** | 19 docs | 14 docs | ambervision2 ✅ |
| **banks** | 24 docs | 16 docs | ambervision2 ✅ |
| **issuers** | 45 docs | 30 docs | ambervision2 ✅ |
| **currencyRateCache** | 12 docs | 6 docs | ambervision2 ✅ |
| **equityHoldings** | 0 docs | 0 docs | Tied 🤝 |
| **products** | 0 docs | N/A | N/A |
| **tickerPriceCache** | 0 docs | N/A | N/A |
| **underlyingPrices** | 0 docs | N/A | N/A |
| **healthcheck** | 1 doc | N/A | ambervision2 ✅ |

### Recent Activity
- **Last 7 Days Activity:** Both databases show recent activity from Aug 5-6, 2025
- **Last Hour Activity:** No recent writes detected in either database
- **User Overlap:** Both databases contain similar users (admin@example.com, client@example.com, etc.) but `ambervision2` has more complete user data

## Migration History Analysis

Based on the migration scripts found:

1. **migrate-equity-holdings.js:** Attempted to migrate FROM ambervision2 TO ambervision (never completed)
2. **consolidate-databases.js:** Attempted to consolidate data FROM ambervision2 TO ambervision (never completed)
3. **migrate-to-ambervisiondb.js:** Successfully migrated FROM ambervision TO ambervisiondb (partially completed)

## Root Cause Analysis

### The Problem Chain:
1. **Original Setup:** Data was in `ambervision` database
2. **First Migration:** Data was moved to `ambervision2` for some reason
3. **Documentation Update:** Someone updated documentation to point to `ambervisiondb`
4. **Partial Migration:** Data was partially moved from `ambervision` to `ambervisiondb`
5. **Configuration Confusion:** App stayed on `ambervision2`, but MCP tools point to `ambervisiondb`

### Why Multiple Databases Exist:
- **ambervision:** Original database (now empty after migrations)
- **ambervision2:** Current production database (where app writes data)
- **ambervisiondb:** Target database for Claude Code MCP tools (partially populated)

## Current State Problems

🚨 **CRITICAL ISSUES:**

1. **Data Fragmentation:** Application data is being written to `ambervision2` but Claude Code tools read from `ambervisiondb`
2. **Inconsistent Documentation:** CLAUDE.md says to use `ambervisiondb` but settings.json uses `ambervision2`  
3. **Incomplete Migration:** The migration to `ambervisiondb` was never completed properly
4. **MCP Configuration Mismatch:** Claude Desktop is configured for `ambervisiondb` while app uses `ambervision2`

## Recommendations

### IMMEDIATE ACTIONS REQUIRED:

#### Option 1: Consolidate to ambervision2 (RECOMMENDED)
Since `ambervision2` has the most complete and recent data:

1. **Update MCP Configuration:**
   ```json
   "MONGODB_URI": "mongodb+srv://username:password@cluster.mongodb.net/ambervision2?retryWrites=true&w=majority"
   ```

2. **Update Documentation (CLAUDE.md):**
   ```
   Database name: ambervision2
   Connection string: Stored in settings.json (excluded from version control)
   ```

3. **Migrate Missing Data:** Move any unique data from `ambervisiondb` to `ambervision2`

4. **Delete Old Databases:** After verification, delete `ambervision` and `ambervisiondb`

#### Option 2: Complete Migration to ambervisiondb
If you prefer the `ambervisiondb` naming:

1. **Complete Data Migration:** Move all data from `ambervision2` to `ambervisiondb`
2. **Update Application Configuration:** Change settings.json to use `ambervisiondb`
3. **Delete Old Databases:** Clean up `ambervision` and `ambervision2`

### VERIFICATION STEPS:

1. ✅ Stop the Meteor application
2. ✅ Implement chosen consolidation approach
3. ✅ Test database connectivity with both app and MCP tools
4. ✅ Verify all user accounts and data are accessible
5. ✅ Start application and confirm everything works
6. ✅ Clean up unused databases

## Risk Assessment

**HIGH RISK:** Continuing with current configuration
- Data inconsistency between app and Claude Code tools
- Potential data loss if wrong database gets updated
- Confusion for developers and users

**LOW RISK:** Following recommended consolidation
- All data preserved and consolidated
- Single source of truth established
- Clear configuration and documentation

## Conclusion

The database confusion stems from incomplete migrations and inconsistent configuration updates. The **immediate priority** is to consolidate to a single database (`ambervision2` recommended) and update all configurations to match.

**Next Steps:**
1. Choose consolidation approach (recommend Option 1)
2. Backup current data
3. Execute consolidation plan
4. Update all configurations
5. Test thoroughly
6. Delete unused databases

---

*Report generated by automated database investigation - August 6, 2025*