# PWA Setup Guide

## Overview

iPrep is now a Progressive Web App (PWA) with:

- ✅ Installable on mobile and desktop
- ✅ Offline support via service worker
- ✅ Push notifications for study reminders
- ✅ App-like experience

## What's Included

### 1. **Web App Manifest** (`/public/manifest.json`)

- Defines app metadata, icons, and display mode
- Enables "Add to Home Screen" functionality

### 2. **Service Worker** (`/public/sw.js`)

- Caches essential pages for offline access
- Handles push notifications
- Manages notification clicks

### 3. **PWA Installer Component**

- Shows install prompt when available
- Detects if app is already installed
- Appears as a banner when app can be installed

### 4. **Notification Settings Component**

- Enable/disable daily study reminders
- Set custom reminder time
- Request notification permissions
- Schedule daily notifications

## Required Icons

You need to create PWA icons:

1. **Create `/public/icon-192.png`** (192x192px)
2. **Create `/public/icon-512.png`** (512x512px)

### Quick Icon Generation

You can:

1. Use a tool like [PWA Asset Generator](https://github.com/onderceylan/pwa-asset-generator)
2. Create simple icons using any image editor
3. Use a logo/icon representing iPrep

**Minimum requirements:**

- PNG format
- 192x192px and 512x512px
- Square icons (will be masked automatically)

## Features

### Install Prompt

- Automatically appears when app is installable
- Users can install to home screen (mobile) or desktop (Chrome/Edge)
- One-click install

### Daily Study Reminders

- Users can enable daily notifications
- Set custom reminder time (default: 9:00 AM)
- Notifications include:
  - "Time to Practice! 📚"
  - Action buttons: "Start Practice" and "Dismiss"
  - Clicking opens the practice page

### Offline Support

- Basic pages cached for offline access
- Service worker handles network requests

## Usage

### For Users

1. **Install the App:**

   - Visit the site on mobile or desktop
   - Look for install banner or browser prompt
   - Click "Install" or "Add to Home Screen"

2. **Enable Notifications:**

   - Go to Analytics page
   - Find "Study Reminders" section
   - Toggle on and set reminder time
   - Grant notification permission when prompted

3. **Receive Reminders:**
   - Get daily notifications at your set time
   - Click notification to open practice page
   - Or dismiss if not ready to practice

### For Developers

**Service Worker Registration:**

- Automatically registered on page load
- Located in `app/layout.tsx`

**Notification Scheduling:**

- Handled in `components/NotificationSettings.tsx`
- Uses localStorage for persistence
- Schedules using setTimeout/setInterval

**Testing:**

- Use Chrome DevTools → Application → Service Workers
- Test notifications in DevTools → Application → Notifications
- Check manifest in DevTools → Application → Manifest

## Browser Support

- ✅ Chrome/Edge (Android, Desktop)
- ✅ Safari (iOS 11.3+, macOS)
- ✅ Firefox (Android, Desktop)
- ⚠️ Limited support on older browsers

## Production Checklist

- [ ] Create `/public/icon-192.png` (192x192px)
- [ ] Create `/public/icon-512.png` (512x512px)
- [ ] Test install prompt on mobile
- [ ] Test notifications on different devices
- [ ] Verify service worker registration
- [ ] Test offline functionality

## Future Enhancements

Potential improvements:

- Background sync for practice sessions
- Push notifications from server
- Advanced caching strategies
- Offline-first architecture
- Periodic background sync
