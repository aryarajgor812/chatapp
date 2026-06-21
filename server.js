const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA behavior
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// App State
const users = {}; // socket.id -> { username, color, currentVC, micActive, camActive }
const DEFAULT_TEXT_CHANNEL = 'general';

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Join Server (User initialization)
  socket.on('join-server', ({ username, color }) => {
    // Sanitize user inputs
    const sanitizedUsername = username ? username.trim().substring(0, 20) : `User_${socket.id.substring(0, 5)}`;
    const sanitizedColor = color || '#5865F2';

    users[socket.id] = {
      username: sanitizedUsername,
      color: sanitizedColor,
      currentVC: null,
      micActive: true,
      camActive: false
    };

    // Join default text channel
    socket.join(DEFAULT_TEXT_CHANNEL);

    // Notify client about success
    socket.emit('server-joined', {
      id: socket.id,
      users: users,
      defaultChannel: DEFAULT_TEXT_CHANNEL
    });

    // Broadcast user joined to other clients
    socket.to(DEFAULT_TEXT_CHANNEL).emit('user-status-changed', {
      id: socket.id,
      user: users[socket.id],
      status: 'online'
    });

    console.log(`${sanitizedUsername} joined the server.`);
  });

  // 2. Text Messaging & Channels
  socket.on('join-text-channel', (channelId) => {
    const user = users[socket.id];
    if (!user) return;

    // Leave previous text channel
    const oldTC = user.currentTC || DEFAULT_TEXT_CHANNEL;
    socket.leave(oldTC);

    // Join new text channel
    user.currentTC = channelId;
    socket.join(channelId);

    console.log(`${user.username} switched to text channel: ${channelId}`);
  });

  socket.on('send-message', ({ text, channel }) => {
    const user = users[socket.id];
    if (!user) return;

    const targetChannel = channel || DEFAULT_TEXT_CHANNEL;
    const messageData = {
      id: `${socket.id}-${Date.now()}`,
      senderId: socket.id,
      senderName: user.username,
      senderColor: user.color,
      text: text.substring(0, 1000), // Limit message size
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.to(targetChannel).emit('receive-message', {
      channel: targetChannel,
      message: messageData
    });
  });

  socket.on('request-user-list', () => {
    socket.emit('user-list-response', users);
  });

  // 3. Voice Channel (VC) Management
  socket.on('join-vc', (vcName) => {
    const user = users[socket.id];
    if (!user) return;

    // Leave previous VC if any
    const oldVC = user.currentVC;
    if (oldVC) {
      socket.leave(`vc-${oldVC}`);
      socket.to(`vc-${oldVC}`).emit('user-left-vc', { socketId: socket.id, username: user.username });
    }

    // Join new VC
    user.currentVC = vcName;
    socket.join(`vc-${vcName}`);

    // Get list of other users in this new voice channel
    const otherUsersInVC = [];
    Object.keys(users).forEach((id) => {
      if (id !== socket.id && users[id].currentVC === vcName) {
        otherUsersInVC.push({
          socketId: id,
          user: users[id]
        });
      }
    });

    // Send the list of existing VC users to the new joiner
    socket.emit('vc-joined', {
      vcName: vcName,
      users: otherUsersInVC
    });

    // Broadcast to other users in this VC that someone new joined
    socket.to(`vc-${vcName}`).emit('user-joined-vc', {
      socketId: socket.id,
      user: user
    });

    // Update global state for everyone (sidebar user lists)
    io.emit('global-user-state-update', { id: socket.id, user: user });

    console.log(`${user.username} joined VC: ${vcName}`);
  });

  socket.on('leave-vc', () => {
    const user = users[socket.id];
    if (!user || !user.currentVC) return;

    const oldVC = user.currentVC;
    user.currentVC = null;
    socket.leave(`vc-${oldVC}`);

    socket.to(`vc-${oldVC}`).emit('user-left-vc', { socketId: socket.id, username: user.username });
    
    // Update global list
    io.emit('global-user-state-update', { id: socket.id, user: user });

    console.log(`${user.username} left VC: ${oldVC}`);
  });

  // 4. Client State Toggles (Mute/Camera Off)
  socket.on('toggle-media-status', ({ micActive, camActive }) => {
    const user = users[socket.id];
    if (!user) return;

    user.micActive = micActive;
    user.camActive = camActive;

    // Broadcast to user's VC if in one
    if (user.currentVC) {
      socket.to(`vc-${user.currentVC}`).emit('peer-media-status-updated', {
        socketId: socket.id,
        micActive: micActive,
        camActive: camActive
      });
    }

    // Update global list (for status icons)
    io.emit('global-user-state-update', { id: socket.id, user: user });
  });

  // 5. WebRTC Signaling Relays
  socket.on('webrtc-offer', ({ targetSocketId, offer }) => {
    const sender = users[socket.id];
    if (!sender) return;
    
    io.to(targetSocketId).emit('webrtc-offer', {
      senderSocketId: socket.id,
      offer: offer
    });
  });

  socket.on('webrtc-answer', ({ targetSocketId, answer }) => {
    const sender = users[socket.id];
    if (!sender) return;

    io.to(targetSocketId).emit('webrtc-answer', {
      senderSocketId: socket.id,
      answer: answer
    });
  });

  socket.on('webrtc-ice-candidate', ({ targetSocketId, candidate }) => {
    const sender = users[socket.id];
    if (!sender) return;

    io.to(targetSocketId).emit('webrtc-ice-candidate', {
      senderSocketId: socket.id,
      candidate: candidate
    });
  });

  // 6. Disconnect
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      const oldVC = user.currentVC;
      if (oldVC) {
        socket.to(`vc-${oldVC}`).emit('user-left-vc', { socketId: socket.id, username: user.username });
      }

      socket.to(DEFAULT_TEXT_CHANNEL).emit('user-status-changed', {
        id: socket.id,
        user: user,
        status: 'offline'
      });

      console.log(`${user.username} disconnected.`);
      delete users[socket.id];
    }
    
    // Notify everyone of cleanup
    io.emit('user-disconnected', { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
