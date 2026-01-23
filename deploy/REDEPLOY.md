# Quick Redeploy Instructions

## Issue Fixed
The black screen after login was caused by `ROOT_URL` not including port 3000, which caused dynamic import fetch failures.

## What Was Changed
- **ROOT_URL**: Changed from `http://95.217.233.6` to `http://95.217.233.6:3000`
- **DDP_DEFAULT_CONNECTION_URL**: Added to ensure WebSocket connections work properly

## Redeploy to Hetzner

### Step 1: Navigate to deployment folder
```bash
cd .deploy
```

### Step 2: Deploy the updated configuration
```bash
mup deploy
```

This will:
1. Build your Meteor application
2. Upload it to your Hetzner server
3. Restart the Docker container with the new ROOT_URL configuration
4. Dynamic imports will now fetch from the correct URL with port 3000

### Step 3: Verify the deployment
After deployment completes (usually 2-5 minutes), test your application:

1. Open browser to: `http://95.217.233.6:3000`
2. Login with your credentials
3. Dashboard should now load properly (no black screen)

### Expected Result
- Login page works ✓
- Dashboard loads correctly ✓
- No "Failed to fetch" errors in console ✓
- Dynamic imports successfully fetched ✓

## Useful Mup Commands

```bash
# Check server logs
mup logs -f

# Check deployment status
mup status

# Restart the app (without redeploying)
mup restart

# Stop the app
mup stop

# Start the app
mup start

# SSH into the server
mup ssh
```

## Database Configuration
Your deployment is configured to use the **amberlake** database on MongoDB Atlas:
```
mongodb+srv://<USER>:<PASSWORD>@cluster0.ixanxcb.mongodb.net/amberlake
```

This is consistent across all configuration files (mup.js and settings-production.json).

## Troubleshooting

### If deployment fails:
```bash
# Check Meteor Up logs
mup logs

# Verify server is accessible
ping 95.217.233.6

# Check Docker status on server
mup ssh
docker ps
```

### If black screen persists:
1. Clear browser cache and hard refresh (Ctrl+Shift+R)
2. Check browser console for errors
3. Verify port 3000 is accessible: `curl http://95.217.233.6:3000`

### If you want to access without port in URL:
You'll need to set up a reverse proxy (nginx) on your Hetzner server to forward port 80 → 3000. See DEPLOYMENT.md for nginx configuration instructions.

## Security Reminder
The `.deploy/` folder is now in `.gitignore` because it contains:
- Server passwords
- Database connection strings
- Other sensitive credentials

Never commit this folder to git!
