// Socket connection (will automatically connect to the hosting server context)
const socket = io();

// Application State
let localUserId = null;
let username = '';
let userColor = '#5865F2';
let currentTC = 'general';
let currentVC = null;

let localStream = null;
let micActive = true;
let camActive = false;

// Screen Share State
let screenStream = null;
let screenActive = false;

// Private Chat State
let activeChatType = 'channel'; // 'channel' or 'dm'
let activeChatTarget = 'general'; // channelId or recipientSocketId
const privateChats = {}; // socketId -> messageArray
const channelChats = {}; // channelId -> messageArray

// Peer Connections Map: socketId -> RTCPeerConnection
const peers = {};

// Google STUN Servers for WebRTC NAT traversal
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// DOM Cache
const dom = {
  loginOverlay: document.getElementById('login-overlay'),
  loginForm: document.getElementById('login-form'),
  usernameInput: document.getElementById('username-input'),
  colorOptions: document.querySelectorAll('.color-option'),
  
  appContainer: document.getElementById('app-container'),
  activeChannelName: document.getElementById('active-channel-name'),
  activeChannelDesc: document.getElementById('active-channel-desc'),
  welcomeChannelName: document.getElementById('welcome-channel-name'),
  welcomeChannelDescSpan: document.getElementById('welcome-channel-desc-span'),
  
  channelItems: document.querySelectorAll('.channel-item'),
  onlineMembersList: document.getElementById('online-members'),
  onlineCount: document.getElementById('online-count'),
  vcUsersList: document.getElementById('vc-users-list'),
  
  userFooterAvatar: document.getElementById('user-footer-avatar'),
  userFooterName: document.getElementById('user-footer-name'),
  btnToggleMic: document.getElementById('btn-toggle-mic'),
  btnToggleCam: document.getElementById('btn-toggle-cam'),
  btnToggleScreen: document.getElementById('btn-toggle-screen'),
  btnLeaveVc: document.getElementById('btn-leave-vc'),
  
  btnLargeMic: document.getElementById('btn-large-mic'),
  btnLargeCam: document.getElementById('btn-large-cam'),
  btnLargeScreen: document.getElementById('btn-large-screen'),
  btnLargeLeave: document.getElementById('btn-large-leave'),
  
  fileInput: document.getElementById('file-input'),
  fileTrigger: document.getElementById('file-trigger'),
  
  videoWorkspace: document.getElementById('video-workspace'),
  videoGrid: document.getElementById('video-grid'),
  
  messagesContainer: document.getElementById('messages-container'),
  messageFeed: document.getElementById('message-feed'),
  messageForm: document.getElementById('message-form'),
  messageInput: document.getElementById('message-input'),
  
  emojiTrigger: document.getElementById('emoji-trigger'),
  emojiPicker: document.getElementById('emoji-picker'),
  
  chimeJoin: document.getElementById('chime-join'),
  chimeLeave: document.getElementById('chime-leave')
};

// Channel Definitions
const channelMetadata = {
  'general': { name: 'general', desc: 'Primary hub for server announcements and chill text chat.' },
  'gaming': { name: 'gaming-chat', desc: 'For coordination, matching up, and gaming conversations.' },
  'music': { name: 'music-lounge', desc: 'Chill beats, song recommendations, and chat.' }
};

// Audio notification wrapper
function playSound(audioEl) {
  if (audioEl) {
    audioEl.currentTime = 0;
    audioEl.play().catch(err => console.log('Audio autoplay prevented by browser permissions.'));
  }
}

/* ==========================================================================
   1. USER SETUP & LOGIN HANDLERS
   ========================================================================== */

// Handle accent color selection
dom.colorOptions.forEach(opt => {
  opt.addEventListener('click', () => {
    dom.colorOptions.forEach(c => c.classList.remove('active'));
    opt.classList.add('active');
    userColor = opt.getAttribute('data-color');
  });
});

// Handle login submit
dom.loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const inputVal = dom.usernameInput.value.trim();
  if (!inputVal) return;
  
  username = inputVal;
  
  // Connect user socket to backend
  socket.emit('join-server', { username, color: userColor });
});

// Handle successful server login
socket.on('server-joined', ({ id, users, defaultChannel }) => {
  localUserId = id;
  
  // Hide login screen and display app
  dom.loginOverlay.style.opacity = 0;
  setTimeout(() => {
    dom.loginOverlay.classList.add('hidden');
    dom.appContainer.classList.remove('hidden');
    dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
  }, 500);
  
  // Update footer profile
  dom.userFooterName.textContent = username;
  dom.userFooterAvatar.textContent = username.charAt(0).toUpperCase();
  dom.userFooterAvatar.style.backgroundColor = userColor;
  
  // Render current user lists
  updateGlobalUsersList(users);
});

/* ==========================================================================
   2. TEXT CHANNEL & TEXT CHAT LOGIC
   ========================================================================== */

// Switch active text channel
dom.channelItems.forEach(item => {
  item.addEventListener('click', () => {
    const channelName = item.getAttribute('data-channel');
    const type = item.getAttribute('data-type');
    
    if (type === 'text') {
      switchTextChannel(channelName);
    } else if (type === 'voice') {
      joinVoiceChannel(channelName);
    }
  });
});

function switchTextChannel(channelId) {
  activeChatType = 'channel';
  activeChatTarget = channelId;
  currentTC = channelId;
  
  // UI active class swap
  document.querySelectorAll('.channel-item[data-type="text"]').forEach(el => {
    if (el.getAttribute('data-channel') === channelId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  
  // Remove highlights from DMs
  document.querySelectorAll('.member-item').forEach(el => el.classList.remove('active'));
  
  // Update headers
  const meta = channelMetadata[channelId] || { name: channelId, desc: '' };
  
  dom.activeChannelName.textContent = meta.name;
  dom.activeChannelDesc.textContent = meta.desc;
  dom.welcomeChannelName.textContent = meta.name;
  dom.welcomeChannelDescSpan.textContent = meta.desc;
  
  // Clear feed and load history
  dom.messageFeed.innerHTML = '';
  dom.messageInput.placeholder = `Message #${meta.name}...`;
  
  const history = channelChats[channelId] || [];
  history.forEach(msg => {
    appendMessage(msg);
  });
  
  // Emit text channel join request
  socket.emit('join-text-channel', channelId);
}

// Send Text Message (or Private Message)
dom.messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = dom.messageInput.value.trim();
  if (!text) return;
  
  if (activeChatType === 'dm') {
    sendPrivateMessage(text, 'text');
  } else {
    socket.emit('send-message', { text, channel: currentTC, type: 'text' });
  }
  dom.messageInput.value = '';
});

function sendPrivateMessage(text, type) {
  const messageData = {
    id: `${localUserId}-${Date.now()}`,
    senderId: localUserId,
    senderName: username,
    senderColor: userColor,
    text: text,
    type: type,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  
  privateChats[activeChatTarget] = privateChats[activeChatTarget] || [];
  privateChats[activeChatTarget].push(messageData);
  
  appendMessage(messageData);
  socket.emit('send-private-message', { recipientId: activeChatTarget, text: text, type: type });
}

// Receive Text Message
socket.on('receive-message', ({ channel, message }) => {
  channelChats[channel] = channelChats[channel] || [];
  channelChats[channel].push(message);
  
  if (activeChatType === 'channel' && channel === activeChatTarget) {
    appendMessage(message);
  }
});

// Receive Private Message
socket.on('receive-private-message', ({ senderId, senderName, senderColor, text, type, timestamp }) => {
  const messageData = {
    id: `${senderId}-${Date.now()}`,
    senderId: senderId,
    senderName: senderName,
    senderColor: senderColor,
    text: text,
    type: type,
    timestamp: timestamp
  };
  
  privateChats[senderId] = privateChats[senderId] || [];
  privateChats[senderId].push(messageData);
  
  if (activeChatType === 'dm' && activeChatTarget === senderId) {
    appendMessage(messageData);
  } else {
    // Show unread indicator in online list
    const memberItem = document.querySelector(`.member-item[data-socket-id="${senderId}"]`);
    if (memberItem) {
      memberItem.classList.add('unread');
    }
  }
});

function appendMessage(msg) {
  const isSystem = msg.isSystem;
  let html = '';
  
  if (isSystem) {
    html = `<div class="system-msg-card">${msg.text}</div>`;
  } else {
    const initial = msg.senderName.charAt(0).toUpperCase();
    let bodyHtml = '';
    
    if (msg.type === 'image') {
      bodyHtml = `<img src="${msg.text}" class="chat-shared-image" alt="Shared Image">`;
    } else if (msg.type === 'audio') {
      bodyHtml = `<audio src="${msg.text}" controls class="chat-shared-audio"></audio>`;
    } else {
      bodyHtml = `<p class="msg-text">${escapeHTML(msg.text)}</p>`;
    }
    
    html = `
      <div class="message-card">
        <div class="msg-avatar" style="background-color: ${msg.senderColor}">${initial}</div>
        <div class="msg-content-wrapper">
          <div class="msg-header">
            <span class="msg-sender" style="color: ${msg.senderColor}">${msg.senderName}</span>
            <span class="msg-timestamp">${msg.timestamp}</span>
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;
  }
  
  dom.messageFeed.insertAdjacentHTML('beforeend', html);
  dom.messagesContainer.scrollTop = dom.messagesContainer.scrollHeight;
}

// Emoji panel functionality
dom.emojiTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  dom.emojiPicker.classList.toggle('hidden');
});

// Close emoji picker when clicking outside
document.addEventListener('click', () => {
  dom.emojiPicker.classList.add('hidden');
});

// Insert selected emoji
dom.emojiPicker.addEventListener('click', (e) => {
  if (e.target.classList.contains('emoji-item')) {
    dom.messageInput.value += e.target.textContent;
    dom.messageInput.focus();
  }
});

/* ==========================================================================
   3. VOICE & VIDEO CALL LOGIC (WebRTC + Socket.io Relay)
   ========================================================================== */

async function joinVoiceChannel(vcName) {
  if (currentVC === vcName) return;
  
  // If already in a VC, leave it first
  if (currentVC) {
    leaveVoiceChannel();
  }
  
  currentVC = vcName;
  playSound(dom.chimeJoin);
  
  // Highlight active VC channel item
  document.querySelectorAll('.channel-item[data-type="voice"]').forEach(el => {
    if (el.getAttribute('data-channel') === vcName) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });

  // Display call components
  dom.videoWorkspace.classList.remove('hidden');
  dom.btnLeaveVc.classList.remove('hidden');
  
  // Initialize Local Media Stream
  try {
    localStream = await acquireMedia();
    
    // Add local stream card to grid
    addLocalVideoCard();
  } catch (err) {
    console.error('Failed to access user media devices:', err);
    alert('Failed to access microphone and/or camera. Please ensure permissions are granted.');
  }

  // Join the voice room on server
  socket.emit('join-vc', vcName);
}

async function acquireMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('WebRTC requires a secure context (HTTPS or localhost). Camera and microphone access are blocked by your browser on non-secure connections.');
  }
  const constraints = {
    audio: true,
    video: true
  };
  
  try {
    // Attempt standard webcam + audio capture
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream;
  } catch (err) {
    console.warn('Camera failed, fallback to audio-only capture:', err);
    camActive = false;
    updateMediaButtonStates();
    // Fallback constraints
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
}

function leaveVoiceChannel() {
  if (!currentVC) return;
  
  playSound(dom.chimeLeave);
  
  // Leave room on server
  socket.emit('leave-vc');
  
  // Clear channel highlights
  document.querySelectorAll('.channel-item[data-type="voice"]').forEach(el => {
    el.classList.remove('active');
  });

  // Hide call workspaces
  dom.videoWorkspace.classList.add('hidden');
  dom.btnLeaveVc.classList.add('hidden');
  
  // Reset states
  currentVC = null;
  
  // Close and clean all WebRTC connections
  Object.keys(peers).forEach(id => {
    closePeerConnection(id);
  });
  
  // Stop local media tracks
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  dom.videoGrid.innerHTML = '';
}

// Server confirmed VC Join: lists all other users already present in this VC
socket.on('vc-joined', async ({ vcName, users }) => {
  console.log(`Joined VC room ${vcName}. Present peers:`, users);
  
  // Create offering RTCPeerConnection to every client currently in VC
  for (const peerInfo of users) {
    const targetSocketId = peerInfo.socketId;
    const remoteUser = peerInfo.user;
    
    // Establish connection as the offer initiator (if not already established)
    if (!peers[targetSocketId]) {
      await makePeerConnection(targetSocketId, remoteUser, true);
    }
  }
  
  // Share media status
  socket.emit('toggle-media-status', { micActive, camActive });
});

// A new peer joined the VC after us
socket.on('user-joined-vc', async ({ socketId, user }) => {
  console.log(`Peer joined VC: ${user.username} (${socketId})`);
  
  // Create peer connection (if not already established by an incoming offer)
  if (!peers[socketId]) {
    await makePeerConnection(socketId, user, false);
  }
});

// Peer left VC
socket.on('user-left-vc', ({ socketId, username }) => {
  console.log(`Peer left VC: ${username} (${socketId})`);
  closePeerConnection(socketId);
});

// WebRTC peer connection maker
async function makePeerConnection(targetSocketId, remoteUser, isInitiator) {
  if (peers[targetSocketId]) {
    console.warn(`RTCPeerConnection to ${targetSocketId} already exists. Skipping recreation.`);
    return peers[targetSocketId];
  }

  const pc = new RTCPeerConnection(rtcConfig);
  peers[targetSocketId] = pc;
  
  // 1. Send ICE candidates to target peer via server signaling
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        targetSocketId: targetSocketId,
        candidate: event.candidate
      });
    }
  };
  
  // 2. Render remote stream when remote tracks arrive
  pc.ontrack = (event) => {
    const remoteStream = event.streams[0];
    console.log(`Received remote track from ${remoteUser.username}`, remoteStream);
    addRemoteVideoCard(targetSocketId, remoteUser, remoteStream);
  };
  
  // 3. Bind local tracks to connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }
  
  // 4. Negotiate connection
  if (isInitiator) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit('webrtc-offer', {
        targetSocketId: targetSocketId,
        offer: offer
      });
    } catch (err) {
      console.error('Failed to create local WebRTC offer:', err);
    }
  }

  return pc;
}

// Receive offer from peer
socket.on('webrtc-offer', async ({ senderSocketId, senderUser, offer }) => {
  let pc = peers[senderSocketId];
  if (!pc) {
    console.log(`Offer received from unknown peer ${senderUser.username}. Initializing connection.`);
    await makePeerConnection(senderSocketId, senderUser, false);
    pc = peers[senderSocketId];
  }
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit('webrtc-answer', {
      targetSocketId: senderSocketId,
      answer: answer
    });
  } catch (err) {
    console.error('Failed to process offering session description:', err);
  }
});

// Receive answer from peer
socket.on('webrtc-answer', async ({ senderSocketId, answer }) => {
  const pc = peers[senderSocketId];
  if (pc) {
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error('Failed to set remote answer description:', err);
    }
  }
});

// Receive ICE candidate from peer
socket.on('webrtc-ice-candidate', async ({ senderSocketId, candidate }) => {
  const pc = peers[senderSocketId];
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Failed to add remote ICE candidate:', err);
    }
  }
});

// Close a connection
function closePeerConnection(socketId) {
  const pc = peers[socketId];
  if (pc) {
    pc.close();
    delete peers[socketId];
  }
  
  // Delete user video card from grid
  const card = document.getElementById(`video-card-${socketId}`);
  if (card) card.remove();
}

/* ==========================================================================
   4. VIDEO GRID UI RENDERING
   ========================================================================== */

function addLocalVideoCard() {
  // Remove if exists
  const existing = document.getElementById('video-card-local');
  if (existing) existing.remove();
  
  const initial = username.charAt(0).toUpperCase();
  const html = `
    <div class="video-card" id="video-card-local">
      <div class="video-placeholder" id="placeholder-local">
        <div class="video-avatar-pulse" style="background-color: ${userColor}">${initial}</div>
      </div>
      <video id="video-local" autoplay playsinline muted></video>
      <div class="video-tag">
        <span class="video-username">${username} (You)</span>
        <div class="video-tag-status">
          <svg class="icon-mic-muted-badge ${micActive ? 'hidden' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ed4245" stroke-width="2.5"><line x1="2" y1="2" x2="22" y2="22"></line><path d="M18.89 13.23A7.12 7.12 0 0 1 12 17a7.12 7.12 0 0 1-6.89-3.77"></path><path d="M9 9h0a3 3 0 0 0 3 3"></path><path d="M10.07 4.39A3 3 0 0 1 12 4a3 3 0 0 1 3 3v3.58"></path></svg>
        </div>
      </div>
    </div>
  `;
  
  dom.videoGrid.insertAdjacentHTML('beforeend', html);
  
  const videoEl = document.getElementById('video-local');
  videoEl.srcObject = localStream;
  
  toggleLocalVideoUI();
}

function addRemoteVideoCard(socketId, remoteUser, remoteStream) {
  let card = document.getElementById(`video-card-${socketId}`);
  
  // If card doesn't exist, create it once
  if (!card) {
    const initial = remoteUser.username.charAt(0).toUpperCase();
    const html = `
      <div class="video-card remote-video" id="video-card-${socketId}">
        <div class="video-placeholder" id="placeholder-${socketId}">
          <div class="video-avatar-pulse" style="background-color: ${remoteUser.color}">${initial}</div>
        </div>
        <video id="video-${socketId}" autoplay playsinline></video>
        <div class="video-tag">
          <span class="video-username">${remoteUser.username}</span>
          <div class="video-tag-status">
            <svg class="icon-mic-muted-badge ${remoteUser.micActive ? 'hidden' : ''}" id="badge-mute-${socketId}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ed4245" stroke-width="2.5"><line x1="2" y1="2" x2="22" y2="22"></line><path d="M18.89 13.23A7.12 7.12 0 0 1 12 17a7.12 7.12 0 0 1-6.89-3.77"></path><path d="M9 9h0a3 3 0 0 0 3 3"></path><path d="M10.07 4.39A3 3 0 0 1 12 4a3 3 0 0 1 3 3v3.58"></path></svg>
          </div>
        </div>
      </div>
    `;
    dom.videoGrid.insertAdjacentHTML('beforeend', html);
    card = document.getElementById(`video-card-${socketId}`);
  }
  
  // Bind stream if not already bound
  const videoEl = document.getElementById(`video-${socketId}`);
  if (videoEl && videoEl.srcObject !== remoteStream) {
    videoEl.srcObject = remoteStream;
  }
  
  // Set placeholders based on remote state
  const placeholder = document.getElementById(`placeholder-${socketId}`);
  if (placeholder) {
    if (remoteUser.camActive) {
      placeholder.classList.add('hidden');
    } else {
      placeholder.classList.remove('hidden');
    }
  }
}

// Media toggle buttons inside profile panel & large video controls
dom.btnToggleMic.addEventListener('click', toggleMic);
dom.btnLargeMic.addEventListener('click', toggleMic);
dom.btnToggleCam.addEventListener('click', toggleCam);
dom.btnLargeCam.addEventListener('click', toggleCam);
dom.btnToggleScreen.addEventListener('click', toggleScreenShare);
dom.btnLargeScreen.addEventListener('click', toggleScreenShare);
dom.btnLeaveVc.addEventListener('click', leaveVoiceChannel);
dom.btnLargeLeave.addEventListener('click', leaveVoiceChannel);

// File attachment trigger & change handlers
dom.fileTrigger.addEventListener('click', () => {
  dom.fileInput.click();
});

dom.fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  if (file.size > 3 * 1024 * 1024) { // 3MB limit
    alert('File size too large. Please select a file under 3MB.');
    e.target.value = '';
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const base64Data = event.target.result;
    const isImage = file.type.startsWith('image/');
    const isAudio = file.type.startsWith('audio/');
    const type = isImage ? 'image' : (isAudio ? 'audio' : null);
    
    if (!type) {
      alert('Only images and audio files are supported for sharing.');
      return;
    }
    
    if (activeChatType === 'dm') {
      sendPrivateMessage(base64Data, type);
    } else {
      socket.emit('send-message', { text: base64Data, channel: currentTC, type: type });
    }
    e.target.value = ''; // Reset input
  };
  reader.readAsDataURL(file);
});

// Direct message trigger click listener (event delegation)
dom.onlineMembersList.addEventListener('click', (e) => {
  const item = e.target.closest('.member-item');
  if (!item) return;
  
  const targetSocketId = item.getAttribute('data-socket-id');
  const targetUsername = item.getAttribute('data-username');
  
  if (targetSocketId === localUserId) {
    return; // Can't DM yourself
  }
  
  openPrivateChat(targetSocketId, targetUsername);
});

function openPrivateChat(targetSocketId, targetUsername) {
  activeChatType = 'dm';
  activeChatTarget = targetSocketId;
  
  // UI active class swap for members list
  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.member-item').forEach(el => {
    if (el.getAttribute('data-socket-id') === targetSocketId) {
      el.classList.add('active');
      el.classList.remove('unread'); // Clear unread dot
    } else {
      el.classList.remove('active');
    }
  });
  
  // Update headers
  dom.activeChannelName.textContent = `@${targetUsername}`;
  dom.activeChannelDesc.textContent = `Private conversation with @${targetUsername}`;
  dom.welcomeChannelName.textContent = `@${targetUsername}`;
  dom.welcomeChannelDescSpan.textContent = `This is the start of your direct message history with @${targetUsername}.`;
  
  // Clear feed and load history
  dom.messageFeed.innerHTML = '';
  dom.messageInput.placeholder = `Message @${targetUsername}...`;
  
  const history = privateChats[targetSocketId] || [];
  history.forEach(msg => {
    appendMessage(msg);
  });
}

function toggleMic() {
  micActive = !micActive;
  
  if (localStream) {
    localStream.getAudioTracks().forEach(track => {
      track.enabled = micActive;
    });
  }
  
  socket.emit('toggle-media-status', { micActive, camActive });
  updateMediaButtonStates();
  
  // Update local mic badge
  const localMuteBadge = document.querySelector('#video-card-local .icon-mic-muted-badge');
  if (localMuteBadge) {
    localMuteBadge.classList.toggle('hidden', micActive);
  }
}

function toggleCam() {
  camActive = !camActive;
  
  if (localStream) {
    localStream.getVideoTracks().forEach(track => {
      track.enabled = camActive;
    });
  }
  
  // If screen sharing is active, stop it first to prevent webcam conflicts
  if (screenActive) {
    stopScreenShare();
  }
  
  socket.emit('toggle-media-status', { micActive, camActive });
  updateMediaButtonStates();
  toggleLocalVideoUI();
}

async function toggleScreenShare() {
  if (!screenActive) {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert('Screen sharing is not supported in this browser or requires a secure context (HTTPS/localhost).');
        return;
      }
      
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenActive = true;
      
      const screenTrack = screenStream.getVideoTracks()[0];
      screenTrack.onended = () => {
        stopScreenShare();
      };
      
      // Replace camera video track in all active RTCPeerConnections
      Object.keys(peers).forEach(socketId => {
        const pc = peers[socketId];
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(screenTrack);
        }
      });
      
      // Update local video element view
      const localVideo = document.getElementById('video-local');
      if (localVideo) {
        localVideo.srcObject = screenStream;
        const localPlaceholder = document.getElementById('placeholder-local');
        if (localPlaceholder) localPlaceholder.classList.add('hidden');
      }
      
      updateScreenButtonStates();
      
      // Notify server screen video is now sending (similar to camera active)
      socket.emit('toggle-media-status', { micActive, camActive: true });
    } catch (err) {
      console.error('Failed to acquire screen capture:', err);
      screenActive = false;
    }
  } else {
    stopScreenShare();
  }
}

function stopScreenShare() {
  if (!screenActive) return;
  
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  
  screenActive = false;
  
  // Revert video track in all active RTCPeerConnections back to camera stream (or null)
  const cameraTrack = (localStream && camActive) ? localStream.getVideoTracks()[0] : null;
  
  Object.keys(peers).forEach(socketId => {
    const pc = peers[socketId];
    const senders = pc.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      videoSender.replaceTrack(cameraTrack);
    }
  });
  
  // Restore local video element view
  const localVideo = document.getElementById('video-local');
  if (localVideo) {
    localVideo.srcObject = localStream;
    toggleLocalVideoUI();
  }
  
  updateScreenButtonStates();
  socket.emit('toggle-media-status', { micActive, camActive });
}

function toggleLocalVideoUI() {
  const placeholder = document.getElementById('placeholder-local');
  if (placeholder) {
    placeholder.classList.toggle('hidden', camActive);
  }
}

function updateMediaButtonStates() {
  // Mic Button Updates
  if (micActive) {
    dom.btnToggleMic.classList.add('active');
    dom.btnToggleMic.querySelector('.icon-mic-on').classList.remove('hidden');
    dom.btnToggleMic.querySelector('.icon-mic-off').classList.add('hidden');
    
    dom.btnLargeMic.classList.add('active');
  } else {
    dom.btnToggleMic.classList.remove('active');
    dom.btnToggleMic.querySelector('.icon-mic-on').classList.add('hidden');
    dom.btnToggleMic.querySelector('.icon-mic-off').classList.remove('hidden');
    
    dom.btnLargeMic.classList.remove('active');
  }

  // Camera Button Updates
  if (camActive) {
    dom.btnToggleCam.classList.add('active');
    dom.btnToggleCam.querySelector('.icon-cam-on').classList.remove('hidden');
    dom.btnToggleCam.querySelector('.icon-cam-off').classList.add('hidden');
    
    dom.btnLargeCam.classList.add('active');
  } else {
    dom.btnToggleCam.classList.remove('active');
    dom.btnToggleCam.querySelector('.icon-cam-on').classList.add('hidden');
    dom.btnToggleCam.querySelector('.icon-cam-off').classList.remove('hidden');
    
    dom.btnLargeCam.classList.remove('active');
  }
}

function updateScreenButtonStates() {
  if (screenActive) {
    dom.btnToggleScreen.classList.add('active');
    dom.btnToggleScreen.querySelector('.icon-screen-on').classList.remove('hidden');
    dom.btnToggleScreen.querySelector('.icon-screen-off').classList.add('hidden');
    
    dom.btnLargeScreen.classList.add('active');
  } else {
    dom.btnToggleScreen.classList.remove('active');
    dom.btnToggleScreen.querySelector('.icon-screen-on').classList.add('hidden');
    dom.btnToggleScreen.querySelector('.icon-screen-off').classList.remove('hidden');
    
    dom.btnLargeScreen.classList.remove('active');
  }
}

// Receive other user media toggles
socket.on('peer-media-status-updated', ({ socketId, micActive, camActive }) => {
  const placeholder = document.getElementById(`placeholder-${socketId}`);
  if (placeholder) {
    placeholder.classList.toggle('hidden', camActive);
  }
  
  const muteBadge = document.getElementById(`badge-mute-${socketId}`);
  if (muteBadge) {
    muteBadge.classList.toggle('hidden', micActive);
  }
});

/* ==========================================================================
   5. ONLINE MEMBER LISTS & STATE MANAGEMENT
   ========================================================================== */

function updateGlobalUsersList(usersMap) {
  dom.onlineMembersList.innerHTML = '';
  
  // Clear any existing VC user panels from the sidebar to prevent duplication
  document.querySelectorAll('.vc-member-item').forEach(el => el.remove());
  dom.vcUsersList.innerHTML = '';
  
  let count = 0;
  
  // Categorize users in VC vs simple list
  const vcGroups = {};
  
  Object.keys(usersMap).forEach(id => {
    count++;
    const user = usersMap[id];
    const initial = user.username.charAt(0).toUpperCase();
    
    // Add to General Online member panel with data attributes for DM listeners
    const memberHtml = `
      <li class="member-item" data-socket-id="${id}" data-username="${user.username}">
        <div class="member-avatar-wrapper">
          <div class="member-avatar" style="background-color: ${user.color}">${initial}</div>
          <span class="online-indicator"></span>
        </div>
        <span class="member-name">${user.username}</span>
      </li>
    `;
    dom.onlineMembersList.insertAdjacentHTML('beforeend', memberHtml);
    
    // Maintain active highlight state if currently in a DM with them
    if (activeChatType === 'dm' && activeChatTarget === id) {
      const activeItem = document.querySelector(`.member-item[data-socket-id="${id}"]`);
      if (activeItem) activeItem.classList.add('active');
    }
    
    // Check if user is inside a Voice Channel
    if (user.currentVC) {
      if (!vcGroups[user.currentVC]) {
        vcGroups[user.currentVC] = [];
      }
      vcGroups[user.currentVC].push({ id, ...user });
    }
  });
  
  dom.onlineCount.textContent = count;
  
  // Render VC member sub-headers under appropriate channels in sidebar
  Object.keys(vcGroups).forEach(vcName => {
    vcGroups[vcName].forEach(member => {
      const initial = member.username.charAt(0).toUpperCase();
      const vcUserHtml = `
        <div class="vc-member-item" data-vc-member="${member.id}">
          <div class="vc-member-left">
            <div class="vc-member-avatar" style="background-color: ${member.color}">${initial}</div>
            <span class="vc-member-name">${member.username}</span>
          </div>
          <div class="vc-member-right">
            ${!member.micActive ? `
              <span class="status-badge-icon muted" title="Muted">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="2" x2="22" y2="22"></line><path d="M18.89 13.23A7.12 7.12 0 0 1 12 17a7.12 7.12 0 0 1-6.89-3.77"></path><path d="M9 9h0a3 3 0 0 0 3 3"></path><path d="M10.07 4.39A3 3 0 0 1 12 4a3 3 0 0 1 3 3v3.58"></path></svg>
              </span>
            ` : ''}
            ${member.camActive ? `
              <span class="status-badge-icon camera" title="Video active">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m22 8-6 4 6 4V8Z"></path><rect width="14" height="12" x="2" y="6" rx="2" ry="2"></rect></svg>
              </span>
            ` : ''}
          </div>
        </div>
      `;
      
      // Find the corresponding voice channel item to append user indicator
      const vcChannelItem = document.querySelector(`.channel-item[data-channel="${vcName}"][data-type="voice"]`);
      if (vcChannelItem) {
        vcChannelItem.insertAdjacentHTML('afterend', vcUserHtml);
      }
    });
  });
}

// Receive continuous updates of server state
socket.on('global-user-state-update', () => {
  socket.emit('request-user-list');
});

socket.on('user-status-changed', () => {
  socket.emit('request-user-list');
});

socket.on('user-disconnected', ({ socketId }) => {
  // If the disconnected user was in a call with us, close connection
  closePeerConnection(socketId);
  
  // Clean up direct message local storage
  if (privateChats[socketId]) {
    delete privateChats[socketId];
  }
  
  // If currently chatting privately with them, kick back to general
  if (activeChatType === 'dm' && activeChatTarget === socketId) {
    alert('The user you were chatting with has left. Direct chat history has been cleared.');
    switchTextChannel('general');
  }
  
  socket.emit('request-user-list');
});

// Server list relay responses
socket.on('user-list-response', (usersMap) => {
  updateGlobalUsersList(usersMap);
});

// Periodic keepalive / status pulls
socket.on('connect', () => {
  if (username) {
    // Re-verify login if server restarted or connection dropped
    socket.emit('join-server', { username, color: userColor });
  }
});

/* ==========================================================================
   6. UTILITIES & SECURITY
   ========================================================================== */

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
