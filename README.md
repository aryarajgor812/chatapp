# Nexus - Next Gen Chat & Video Spaces

Nexus is a beautiful, dark-themed, glassmorphic real-time communication platform inspired by Discord. It features instant text group messaging across channels, real-time voice chat, and video conferencing with camera feeds using peer-to-peer WebRTC mesh networking.

---

## Features
- **Accents & Theme:** High-fidelity glassmorphism with glowing dark mode backdrops, using the Outfit and Inter fonts.
- **Identity Selection:** Custom username selection screen with interactive background color pickers.
- **Text Chat (GC):** Support for multiple text channels (`#general`, `#gaming-chat`, `#music-lounge`) with full room switching and inline emoji selector.
- **Voice/Video Chat (VC):**
  - Instant join/leave indicators.
  - Interactive grid panel showing video panels of all participants.
  - Controls to toggle Microphone mute and Camera on/off.
  - Dynamic user status indicators (active speaker, muted, camera active) in the grid and sidebar.
  - System sound chimes for joins/leaves.

---

## Local Run Instructions

1. Ensure you have **Node.js** (version 16 or newer) installed.
2. In your terminal, go to the folder:
   ```bash
   cd "C:\Users\Aarya\Desktop\chat app"
   ```
3. Install dependencies (if not already done):
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open your browser and navigate to:
   - **`http://localhost:3000`**
6. *Testing multi-user calls locally:* Open another tab or window at the same address, choose a different username, and join the same voice channel!

---

## Deployment on Render (onrender.com)

Render makes it incredibly simple to host Node.js applications for free. Our app is configured to deploy with zero extra modifications.

### Step-by-Step Render Deployment Guide

#### 1. Push code to GitHub
Create a new Git repository on GitHub (public or private) and push your files:
```bash
git init
git add .
git commit -m "Initial commit of Nexus chat app"
# Follow GitHub instructions to link and push your repository
```

#### 2. Create Web Service on Render
1. Go to [Render Dashboard](https://dashboard.render.com/) and log in.
2. Click **New** (top right) and select **Web Service**.
3. Connect your GitHub account and select your `chat app` repository.

#### 3. Configure Service Details
Render will ask for the following settings. Enter them as shown below:
- **Name:** `nexus-chat-spaces` (or any unique name you prefer)
- **Region:** Choose the region closest to you (e.g., `Singapore` or `Oregon`)
- **Branch:** `main` (or the branch you pushed your code to)
- **Root Directory:** (Leave blank, as package.json is in the root directory)
- **Runtime:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `node server.js`
- **Instance Type:** `Free`

#### 4. Click Deploy Web Service!
Render will now pull the code, install dependencies (`npm install`), and start the application server using `node server.js`. Once building is complete, it will provide a live public URL (e.g., `https://nexus-chat-spaces.onrender.com`).

---

## How it works (Under the Hood)
- **Socket.io:** Coordinates instant text communication and handles the WebRTC signaling layer.
- **WebRTC Mesh Network:** When you join a voice channel, a direct peer-to-peer data connection (`RTCPeerConnection`) is established between your browser and every other participant. This relays high-quality voice and video streams directly with minimum latency.
- **Responsive Layout:** Automatically scales from full-size desktop screen layouts to vertically scrollable mobile panels.
