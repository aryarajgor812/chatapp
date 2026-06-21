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
  btnLeaveVc: document.getElementById('btn-leave-vc'),
  
  btnLargeMic: document.getElementById('btn-large-mic'),
  btnLargeCam: document.getElementById('btn-large-cam'),
  btnLargeLeave: document.getElementById('btn-large-leave'),
  
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
  if (currentTC === channelId) return;
  
  // UI active class swap
  document.querySelectorAll('.channel-item[data-type="text"]').forEach(el => {
    if (el.getAttribute('data-channel') === channelId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  
  // Update headers
  const meta = channelMetadata[channelId] || { name: channelId, desc: '' };
  currentTC = channelId;
  
  dom.activeChannelName.textContent = meta.name;
  dom.activeChannelDesc.textContent = meta.desc;
  dom.welcomeChannelName.textContent = meta.name;
  dom.welcomeChannelDescSpan.textContent = meta.desc;
  
  // Clear feed and input
  dom.messageFeed.innerHTML = '';
  dom.messageInput.placeholder = `Message #${meta.name}...`;
  
  // Emit text channel join request
  socket.emit('join-text-channel', channelId);
}

// Send Text Message
dom.messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = dom.messageInput.value.trim();
  if (!text) return;
  
  socket.emit('send-message', { text, channel: currentTC });
  dom.messageInput.value = '';
});

// Receive Text Message
socket.on('receive-message', ({ channel, message }) => {
  if (channel !== currentTC) return; // Ignore if user isn't in this channel
  
  appendMessage(message);
});

function appendMessage(msg) {
  const isSystem = msg.isSystem;
  let html = '';
  
  if (isSystem) {
    html = `<div class="system-msg-card">${msg.text}</div>`;
  } else {
    const initial = msg.senderName.charAt(0).toUpperCase();
    html = `
      <div class="message-card">
        <div class="msg-avatar" style="background-color: ${msg.senderColor}">${initial}</div>
        <div class="msg-content-wrapper">
          <div class="msg-header">
            <span class="msg-sender" style="color: ${msg.senderColor}">${msg.senderName}</span>
            <span class="msg-timestamp">${msg.timestamp}</span>
          </div>
          <p class="msg-text">${escapeHTML(msg.text)}</p>
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
    
    // Establish connection as the offer initiator
    await makePeerConnection(targetSocketId, remoteUser, true);
  }
  
  // Share media status
  socket.emit('toggle-media-status', { micActive, camActive });
});

// A new peer joined the VC after us
socket.on('user-joined-vc', async ({ socketId, user }) => {
  console.log(`Peer joined VC: ${user.username} (${socketId})`);
  
  // Wait to receive offer from them (they are the initiator)
  await makePeerConnection(socketId, user, false);
});

// Peer left VC
socket.on('user-left-vc', ({ socketId, username }) => {
  console.log(`Peer left VC: ${username} (${socketId})`);
  closePeerConnection(socketId);
});

// WebRTC WebRTC peer connection maker
async function makePeerConnection(targetSocketId, remoteUser, isInitiator) {
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
}

// Receive offer from peer
socket.on('webrtc-offer', async ({ senderSocketId, offer }) => {
  const pc = peers[senderSocketId];
  if (!pc) return;
  
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
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
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
  // Remove if already exists to prevent duplicate UI elements
  const existing = document.getElementById(`video-card-${socketId}`);
  if (existing) existing.remove();
  
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
  
  const videoEl = document.getElementById(`video-${socketId}`);
  videoEl.srcObject = remoteStream;
  
  // Set initial placeholders based on remote state
  const placeholder = document.getElementById(`placeholder-${socketId}`);
  if (remoteUser.camActive) {
    placeholder.classList.add('hidden');
  } else {
    placeholder.classList.remove('hidden');
  }
}

// Media toggle buttons inside profile panel & large video controls
dom.btnToggleMic.addEventListener('click', toggleMic);
dom.btnLargeMic.addEventListener('click', toggleMic);
dom.btnToggleCam.addEventListener('click', toggleCam);
dom.btnLargeCam.addEventListener('click', toggleCam);
dom.btnLeaveVc.addEventListener('click', leaveVoiceChannel);
dom.btnLargeLeave.addEventListener('click', leaveVoiceChannel);

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
  
  socket.emit('toggle-media-status', { micActive, camActive });
  updateMediaButtonStates();
  toggleLocalVideoUI();
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
  
  // Clear any existing VC user panels
  dom.vcUsersList.innerHTML = '';
  
  let count = 0;
  
  // Categorize users in VC vs simple list
  const vcGroups = {};
  
  Object.keys(usersMap).forEach(id => {
    count++;
    const user = usersMap[id];
    const initial = user.username.charAt(0).toUpperCase();
    
    // Add to General Online member panel
    const memberHtml = `
      <li class="member-item">
        <div class="member-avatar-wrapper">
          <div class="member-avatar" style="background-color: ${user.color}">${initial}</div>
          <span class="online-indicator"></span>
        </div>
        <span class="member-name">${user.username}</span>
      </li>
    `;
    dom.onlineMembersList.insertAdjacentHTML('beforeend', memberHtml);
    
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
  // Rather than managing incremental user lists, fetch absolute list from server
  socket.emit('request-user-list');
});

socket.on('user-status-changed', () => {
  socket.emit('request-user-list');
});

socket.on('user-disconnected', ({ socketId }) => {
  // If the disconnected user was in a call with us, close connection
  closePeerConnection(socketId);
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
