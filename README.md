1. Screen Overlap & Navigation Issues
Problem: Multiple screens are overlapping, causing UI collision and navigation confusion.
Requirements:

Implement proper z-index layering for modals and overlays
Ensure navigation stack correctly pushes/pops screens
Add proper screen transitions (slide, fade) to prevent visual overlap
Test navigation flow: Login → Home → Detail → Back (no screen remnants)
Implement proper safe area handling for notched devices


2. Location Services - CRITICAL
Problem: Expo maps not displaying real user location; photographers showing locations in America instead of South Africa.
Requirements:

Must use real device GPS, not mock/static coordinates
Request and handle location permissions properly
Implement real-time location updates (location tracking every 10-30 seconds)
Geofence to South Africa only - validate all coordinates are within:

Latitude: -35° to -22°
Longitude: 16° to 33°


Calculate and display distance from user to each photographer in kilometers
Show "X km away" on each photographer card
Sort photographers by proximity (nearest first)
Display user's blue dot on map with accuracy radius
Show photographer pins with custom markers
Handle location errors gracefully:

GPS disabled → prompt user to enable
Permission denied → show manual location selector
Location unavailable → fallback to last known location



Acceptance Criteria:

User opens app → sees real location on map within 10 seconds
Photographers appear only if within South Africa
Distance calculations are accurate within 100m
Map centers on user's actual position


3. Database Feed Function Error
Problem: App falls back to local feed due to missing public.recommend_posts(limit_count, offset_count) function.
Requirements:

Create or remove reference to recommend_posts() function
Implement proper pagination using offset/limit queries
No fallback to cached/local data - all feed data must be live
Handle empty states when no posts exist
Implement infinite scroll with proper loading states


🎯 Core Functional Requirements
Authentication & Access Control
Zero-tolerance policy for unauthorized access.
Requirements:

Login/Signup screens are the only entry points
Unauthenticated users cannot access any app screens
No route hijacking or deep link bypasses
Implement proper session management:

JWT tokens with expiration
Refresh token flow
Auto-logout after 30 days


Role-based access control:

Clients → Browse photographers, create bookings, view feed
Photographers → Manage bookings, post content, set availability
Admin → User management, dispute resolution


Separate navigation flows per role (similar to Uber rider vs driver)
Photographer verification:

Require portfolio upload before activation
Manual approval process (pending verification screen)
Badge/checkmark for verified photographers



Acceptance Criteria:

Attempt to access /bookings without login → redirect to login
Client account cannot access photographer-only features
Session persists across app restarts (remember me)


Location & Maps (Uber-Level Standards)
Requirements:

Real GPS tracking, not simulated data
Location updates must be:

Accurate within 50 meters
Updated every 10-30 seconds when app is active
Smooth (no jumping pins)


Map features:

User location (blue pulsing dot)
Photographer pins (custom camera icon)
Tap pin → show photographer preview card
Clustering for multiple photographers in same area
Smooth zoom/pan animations


Distance intelligence:

Calculate straight-line distance (Haversine formula)
Display "2.3 km away" on each photographer card
Sort lists by proximity
Filter by radius (within 5km, 10km, 25km, 50km)


Photographer heatmap (optional but recommended):

Show areas with high booking demand
Help photographers position themselves strategically


South African context:

All locations validated to be within SA borders
Display province/city names (Cape Town, Johannesburg, Durban, etc.)
Use South African landmarks as reference points



Acceptance Criteria:

Open app → map loads within 3 seconds
User location displays within 5 seconds
Photographers within 50km radius are visible
Tapping a photographer pin opens their profile
Distance calculations match Google Maps within 5% accuracy


Feed & Infinite Scroll
Requirements:

True infinite scroll with database-backed pagination
Load 20 posts initially, then 10 posts per subsequent scroll
Implement proper loading indicators:

Initial load: skeleton screens
Infinite scroll: spinner at bottom


No references to missing database functions
Performance targets:

First load: < 2 seconds
Subsequent loads: < 1 second
Smooth 60fps scrolling (no jank)


Instagram-quality visuals:

Square or 4:5 aspect ratio images
High-resolution thumbnails
Lazy loading of images outside viewport
Progressive image loading (blur-up effect)


Feed algorithm (simple):

Sort by recency (newest first)
OR weighted by engagement (likes + comments)
Filter out blocked users



Acceptance Criteria:

Scroll to bottom → new posts load automatically
No "could not find function" errors
Feed never shows duplicate posts
Works with 1,000+ posts without performance degradation


Chat System (Instagram DM Quality)
Requirements:

Realtime messaging using Supabase Realtime or Firebase Firestore
Message features:

Text messages (max 1000 characters)
Image sharing
Read receipts (seen/delivered)
Typing indicators
Timestamps (formatted as "10:45 AM" or "2h ago")


Conversation list:

Show all chats sorted by most recent message
Display last message preview
Unread badge count
User avatar and name
Time of last message


Individual chat thread:

Bubble style messages (sender right, receiver left)
Message grouping by time (Today, Yesterday, Jan 5)
Smooth scrolling to bottom on new messages
Auto-scroll to newest message on open


Performance:

Messages appear within 500ms of sending
No message duplication
Handle offline queue (send when reconnected)
Sync across devices instantly


Visual polish:

Smooth animations
Haptic feedback on send
Message delivery animations
Clean, modern design



Acceptance Criteria:

Send message → recipient sees it within 1 second
Messages persist after app restart
Offline messages queue and send when online
Chat UI feels as polished as Instagram DMs


Booking & Scheduling
Requirements:

Photographer availability:

Set working hours (9 AM - 5 PM)
Block specific dates (holidays, days off)
Set hourly rate
Minimum booking duration (1-2 hours)


Client booking flow:

Select photographer
Choose date from calendar
Select available time slot
Enter location (with map picker)
Confirm booking details
Proceed to payment


Conflict prevention:

Real-time availability checking
Lock time slot during booking process (5-minute hold)
Show "Unavailable" for booked slots
Prevent double-booking


Booking states:

Pending → Awaiting photographer acceptance
Accepted → Confirmed, awaiting session
In Progress → Session happening now
Completed → Session finished
Reviewed → Client left review
Cancelled → Cancelled by either party


Notifications:

Push notification on booking request
SMS confirmation on acceptance
Reminder 24 hours before session
Follow-up for review after completion



Acceptance Criteria:

Cannot book past dates
Cannot double-book a time slot
Booking confirmation received within 2 seconds
Calendar shows real-time availability


Payments (End-to-End Testing Required)
Requirements:

Integration: PayFast (South African payment gateway)
Supported methods:

Credit/Debit cards
Instant EFT
SnapScan


Payment flow:

Calculate total (hourly rate × duration)
Display breakdown (subtotal, platform fee 10%, total)
Redirect to PayFast hosted page (WebView)
Handle payment callback
Update booking status on success
Send confirmation email/SMS
