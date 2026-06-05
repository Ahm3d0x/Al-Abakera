# Mind Race — Full Implementation Plan

> Phased, step-by-step task breakdown based on the Game Design Document

---

## Overview

Mind Race is a multi-mode knowledge competition platform supporting solo training, team battles, tournaments, classroom use, and live streaming. This document breaks the full build into **6 phases**, each delivering a shippable milestone.

---

## Phase 1 — Foundation & Infrastructure

**Goal:** Establish the technical backbone before any game logic is built.
**Estimated Duration:**

### 1.1 Project Setup

- [ ] Choose and initialize the tech stack (e.g., React/Next.js frontend, Node.js/NestJS backend, supabase + supabase realtime + Redis)
- [ ] Set up monorepo structure (apps/web, apps/api, packages/shared)
- [ ] Configure CI/CD pipeline (GitHub Actions or similar)
- [ ] Set up staging and production environments
- [ ] Configure environment variable management

### 1.2 Database Design

- [ ] Design user schema (id, username, email, rank, coins, creator_tokens, stats)
- [ ] Design question schema (id, type, category, body, options, correct_answer, difficulty, rating)
- [ ] Design room schema (id, type, config, host_id, status, participants)
- [ ] Design match/session schema (id, room_id, rounds, scores, timestamps)
- [ ] Design tournament schema (id, format, teams, bracket, status)
- [ ] Design badge and achievement schema
- [ ] Design season schema
- [ ] Run initial migrations

### 1.3 Authentication & User Accounts

- [ ] Implement email/password registration and login
- [ ] Add OAuth (Google, Apple) sign-in
- [ ] Implement JWT access + refresh token flow
- [ ] Build email verification flow
- [ ] Build password reset flow
- [ ] Implement session management

### 1.4 Core API Structure

- [ ] Set up RESTful API with versioning (`/api/v1/`)
- [ ] Set up WebSocket server (Socket.io or similar) for real-time game events
- [ ] Implement API rate limiting
- [ ] Set up error handling and logging (e.g., Sentry)
- [ ] Write API documentation (Swagger/OpenAPI)

### 1.5 Anti-Cheat Foundation

- [ ] Implement device fingerprinting on registration
- [ ] Log all user actions server-side (timestamps, IP, device)
- [ ] Set up duplicate account detection logic
- [ ] Build repeated-answer pattern detection flag system

---

## Phase 2 — Core Game Engine

**Goal:** Make a functional single-player game loop with questions, scoring, and basic UI.
**Estimated Duration:**

### 2.1 Question System

- [ ] Build question CRUD API (create, read, update, delete)
- [ ] Implement all question types:
  - [ ] Multiple Choice
  - [ ] True / False
  - [ ] Image Question (with image upload + CDN storage)
  - [ ] Ordering Question
  - [ ] Matching Question
  - [ ] Fill in the Blank
  - [ ] Multi-Select
  - [ ] Calculation Question
  - [ ] Circuit Question
  - [ ] Coding Question
- [ ] Build automatic grading logic for each type
- [ ] Build 5-star question rating system
- [ ] Build question category tagging system
- [ ] Build category weighting configuration (e.g., 50% Science, 20% Math)

### 2.2 Room System

- [ ] Implement room creation with configuration options
- [ ] Implement room types: Public, Private (code), Invite Only, Spectator
- [ ] Build room join / leave logic
- [ ] Build room state machine (waiting → active → ended)
- [ ] Implement room code generation for private rooms
- [ ] Build spectator view (read-only connection)

### 2.3 Solo Training Modes

- [ ] **Practice Mode:** No timer, no point loss, show explanation after each answer
- [ ] **Timed Challenge:** Fixed question count, countdown timer, global leaderboard
- [ ] **Survival Mode:** 3 lives, lose a life per wrong answer, record last level reached
- [ ] **Daily Challenge:** Same questions for all users per day, special rewards, reset at midnight

### 2.4 Scoring Engine

- [ ] Implement base point calculation per question
- [ ] Implement time-bonus scoring (faster = more points)
- [ ] Implement Buzzer scoring formulas:
  - Bonus = 20% of question value
  - Penalty = 20% of question value
- [ ] Build score ledger (real-time per session)

### 2.5 Basic UI — Solo Play

- [ ] Build lobby/home screen
- [ ] Build question display component (supporting all question types)
- [ ] Build countdown timer component
- [ ] Build answer selection UI
- [ ] Build score display
- [ ] Build end-of-game summary screen (MVP, stats, coins earned, rank progress)

---

## Phase 3 — Multiplayer & Real-Time Systems

**Goal:** Enable live multiplayer: 1v1 through 5v5, Free For All, and Team Battle modes.

### 3.1 Real-Time Game Sync

- [ ] Implement WebSocket room channels (one channel per room)
- [ ] Sync question delivery to all players simultaneously
- [ ] Sync timer across all clients
- [ ] Sync score updates in real time
- [ ] Handle disconnection and reconnection gracefully
- [ ] Implement server-side answer validation (no client-side trust)

### 3.2 Team Battle Mode

- [ ] Implement team assignment (1v1, 2v2, 3v3, 4v4, 5v5)
- [ ] Build team score aggregation
- [ ] Implement team chat (text & fast emoji)

### 3.3 Free For All Mode

- [ ] Support 2–20 players in the same room
- [ ] Each player competes independently
- [ ] Real-time leaderboard during the match

### 3.4 Buzzer System

- [ ] Build core buzzer logic (first-press detection, server-side)
- [ ] Implement all buzzer types:
  - [ ] Standard Buzzer (bonus/penalty by question value)
  - [ ] Risk Buzzer (correct = full value + bonus; wrong = full value deducted)
  - [ ] Safe Buzzer (correct = full value; wrong = 0, no penalty)
  - [ ] Competitive Buzzer (wrong = penalty + question passes to opponent)
  - [ ] Sudden Death Buzzer (wrong = eliminated from round)
  - [ ] Team Relay Buzzer (alternating players, no repeat answerers)
  - [ ] Captain Buzzer (captain only can press)
  - [ ] Hidden Buzzer (presses hidden until timer ends)
  - [ ] Auction Buzzer (teams bid points before question)
  - [ ] Team Consultation (10-second team vote after buzz)
  - [ ] Open Discussion (full team voice discussion allowed)
- [ ] Allow room host to select buzzer type in room configuration

### 3.5 Power-Ups System

- [ ] Implement all 11 power-ups:
  - [ ] Joker (double question value)
  - [ ] Freeze (freeze opponent's timer)
  - [ ] Shield (cancel incoming penalty)
  - [ ] Reveal Hint (show a hint)
  - [ ] Double Chance (one extra attempt)
  - [ ] Steal (steal opponent's question)
  - [ ] Time Boost (add time to own timer)
  - [ ] Point Multiplier (multiply round points)
  - [ ] Category Swap (swap question category)
  - [ ] Skip Question (skip current question)
  - [ ] Block Power-Up (prevent opponent from using a power-up)
- [ ] Build power-up inventory UI
- [ ] Enforce power-up rules per game mode

### 3.6 Judge System

- [ ] **Automatic Judge:** Auto-grade closed question types
- [ ] **Human Judge Panel:**
  - [ ] Judge dashboard (approve / reject answer)
  - [ ] Grant or deduct points manually
  - [ ] End round manually
  - [ ] Support for open-text answers
- [ ] Assign judge role within room settings

---

## Phase 4 — Tournaments, Classroom & Creator Tools

**Goal:** Enable organized competitions, educational use, and user-generated content.

### 4.1 Tournament Mode

- [ ] Support bracket sizes: 8, 16, 32, 64 teams
- [ ] Implement tournament formats:
  - [ ] Knockout (single elimination)
  - [ ] Double Elimination
  - [ ] League (round-robin)
  - [ ] Swiss System
- [ ] Build automated bracket generation and advancement
- [ ] Build tournament dashboard (bracket view, match schedule)
- [ ] Implement tournament-specific rooms (auto-created per match)
- [ ] Award Creator Tokens for tournament completion

### 4.2 Streamer Mode

- [ ] Build audience participation system (viewers answer alongside the stream)
- [ ] Generate a unique join link for live stream audiences
- [ ] Display audience leaderboard separately from main players
- [ ] Support large spectator counts (optimize WebSocket fan-out)

### 4.3 Question Packs

- [ ] Build question pack creation UI
- [ ] Support packs: Science, Math, Electronics, Programming (and custom)
- [ ] Allow sharing packs publicly or privately
- [ ] Implement pack rating and review system
- [ ] Gate pack publishing behind Creator Tokens

### 4.4 Voting System

- [ ] Implement post-match voting:
  - [ ] Best Player (individual matches)
  - [ ] Best Team / Best Answer (team matches)
- [ ] Display voting results on end screen

---

## Phase 5 — Progression, Economy & Seasons

**Goal:** Add long-term engagement through ranks, rewards, currencies, and seasonal content.
**Estimated Duration:**

### 5.1 Ranking System

- [ ] Implement 10-tier ranking ladder:
      Bronze → Silver → Gold → Platinum → Diamond → Master → Grand Master → Legend → Mythic → Titan
- [ ] Define rank point thresholds and decay rules
- [ ] Animate rank-up moments in UI
- [ ] Show rank badge on player profile

### 5.2 Badge System

- [ ] Implement all badges:
  - [ ] Speed Demon (fastest player)
  - [ ] Scientist (1,000 science questions answered)
  - [ ] Historian (1,000 history questions answered)
  - [ ] Undefeated (50 consecutive wins)
  - [ ] Team Leader (100 wins as captain)
  - [ ] Tournament King (full tournament without a loss)
- [ ] Build badge display on profile
- [ ] Animate badge unlock notification

### 5.3 Currency System

- [ ] **Coins (common currency):**
  - Earned from: practice, wins, daily missions
  - Spent on: cosmetics, effects, avatars
- [ ] **Creator Tokens (rare currency):**
  - Earned from: tournaments, achievements, purchases
  - Spent on: creating tournaments, publishing question banks, uploading packs
- [ ] Build in-app store for cosmetic purchases
- [ ] Build mission/quest system (daily + weekly tasks)

### 5.4 Player Statistics

- [ ] Track and display per-player stats:
  - [ ] Win rate
  - [ ] Correct answer rate
  - [ ] Best category / Worst category
  - [ ] Average answer time
  - [ ] Fastest answer on record
  - [ ] Tournament count
- [ ] Build statistics dashboard on player profile
- [ ] Build global and category-specific leaderboards

### 5.5 Seasons

- [ ] Implement season framework (start date, end date, theme)
- [ ] Introduce new questions each season
- [ ] Award season-exclusive badges and cosmetics
- [ ] Archive previous season rankings and rewards
- [ ] Build season progress tracker UI

---

## Phase 6 — Polish, Audio, Animations & Launch Readiness

**Goal:** Deliver a complete, polished product ready for public launch.
**Estimated Duration:**

### 6.1 Animations

- [ ] Animated countdown timer
- [ ] Screen shake on wrong answer
- [ ] Glow/flash effect on correct answer
- [ ] Points explosion animation
- [ ] Round transition animation
- [ ] Live progress bar
- [ ] Rank-up animation
- [ ] Win celebration animation
- [ ] Badge unlock animation
- [ ] Power-up activation animation

### 6.2 Sound Effects

- [ ] Buzzer press sound
- [ ] Countdown tick / final beep
- [ ] Correct answer chime
- [ ] Wrong answer buzz
- [ ] Round start fanfare
- [ ] Round end sound
- [ ] Victory music
- [ ] Defeat sound
- [ ] Power-up activation sound
- [ ] Tournament final intro music
- [ ] Audience cheer (Streamer Mode)
- [ ] Sudden Death alarm
- [ ] Implement global sound settings (on/off, volume slider)

### 6.3 End Game Screen

- [ ] Display MVP
- [ ] Show full match statistics
- [ ] Show final rankings
- [ ] Show achievements unlocked
- [ ] Show coins and tokens earned
- [ ] Show rank progression bar
- [ ] Include match replay / highlight reel (top moments)
- [ ] Share result to social media button

### 6.4 Anti-Cheat Hardening

- [ ] Finalize fake account detection (pattern analysis)
- [ ] Detect and flag repeated identical answer patterns
- [ ] Enforce one-account-per-device policy with appeal process
- [ ] Full event logging (every action, timestamp, IP, device)
- [ ] Judge activity audit log
- [ ] Admin moderation dashboard

### 6.5 Performance & Scalability

- [ ] Load test WebSocket server (target: 10,000+ concurrent users)
- [ ] Implement Redis pub/sub for multi-instance WebSocket scaling
- [ ] Optimize database queries and add indexes
- [ ] Set up CDN for images, sounds, and static assets
- [ ] Implement server-side caching for leaderboards and question banks

### 6.6 QA & Launch

- [ ] Write unit tests for scoring engine and buzzer logic
- [ ] Write integration tests for all game modes
- [ ] Conduct full end-to-end playtest sessions for each mode
- [ ] Fix critical and high-severity bugs
- [ ] Write user onboarding flow (tutorial / first match guide)
- [ ] Prepare app store listings (iOS / Android) if applicable
- [ ] Set up production monitoring and alerts
- [ ] Soft launch with limited users → gather feedback → full launch

---

## Key Dependencies

- Phase 2 must complete before Phase 3 (game engine before multiplayer)
- Phase 3 must complete before Phase 4 (real-time before tournaments)
- Phase 5 can begin in parallel with Phase 4
- Phase 6 runs in parallel with final testing of Phase 5
