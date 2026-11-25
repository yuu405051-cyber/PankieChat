/* =========================================================
   PANKIECHAT — COMPLETE APP.JS
   Firebase Auth + Realtime Database + Backblaze B2
   Replace the old app.js with this complete file.
   ========================================================= */

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, deleteUser, EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getDatabase, ref, push, get, set, update, remove, onValue,
  onChildAdded, onChildChanged, onChildRemoved, onDisconnect,
  runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

/* 1. FIREBASE CONFIG — replace values with your Firebase web config */
// FIREBASE CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyCsc0Ri6-_6O6Nh49xq5FnEy6DloMcJy6w",
  authDomain: "pankiechat1.firebaseapp.com",
  databaseURL: "https://pankiechat1-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pankiechat1",
  storageBucket: "pankiechat1.firebasestorage.app",
  messagingSenderId: "194864630590",
  appId: "1:194864630590:web:9b8510d79f636ada1aba6f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

/* 2. STATE */
let currentUser = null;
let currentProfile = null;
let activeRoom = null;
let roomStops = [];
let userStops = [];
let searchTimer = null;
let typingTimer = null;
let selectedMessage = null;
let replyTarget = null;
let forwardMessage = null;
let forwardTarget = null;
let selectedMediaFile = null;
let photoUploading = false;
let currentMediaUrls = new Set();
let messageCache = new Map();
let searchRequest = 0;

/* 3. DOM HELPERS */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const el = id => document.getElementById(id);

const dom = {
  splash: el("splashScreen"), auth: el("authScreen"), app: el("app"),
  email: el("authEmail"), password: el("authPassword"),
  login: el("loginBtn"), register: el("registerBtn"), authMessage: el("authMessage"),
  logout: el("logoutBtn"), chatList: $(".chat-list"), chatSearch: el("chatSearch"),
  headerName: el("chatHeaderName"), status: el("chatStatus"), typing: el("typingStatus"),
  messages: $(".messages"), input: el("messageInput"), send: el("sendButton"),
  back: el("mobileBackBtn"), myProfile: el("myProfile"),
  profileModal: el("profileModal"), closeProfile: el("closeProfile"),
  profileAvatar: el("profileAvatar"), photoInput: el("photoInput"),
  changePhoto: el("changePhotoBtn"), editProfile: el("editProfileBtn"),
  editForm: el("editForm"), editName: el("editName"), editUsername: el("editUsername"),
  saveProfile: el("saveProfile"), cancelEdit: el("cancelEdit"),
  searchTrigger: el("searchTrigger"), searchOverlay: el("searchOverlay"),
  closeSearch: el("closeSearch"), userSearch: el("userSearch"), searchResults: el("searchResults"),
  pinnedBar: el("pinnedMessageBar"), pinnedText: el("pinnedMessageText"),
  unpin: el("unpinMessageBtn"), replyPreview: el("replyPreview"),
  replyText: el("replyText"), cancelReply: el("cancelReply"),
  attach: el("attachButton"), attachmentPopup: el("attachmentPopup"),
  mediaInput: el("mediaInput"), documentInput: el("documentInput"),
  photoModal: el("photoPreviewModal"), photoImage: el("photoPreviewImage"),
  photoName: el("photoPreviewName"), closePhoto: el("closePhotoPreview"),
  sendPhoto: el("sendPhotoButton"), photoProgress: el("photoUploadProgress"),
  photoProgressCircle: el("photoProgressCircle"), photoProgressText: el("photoProgressText"),
  actionMenu: el("messageActionMenu"), pinModal: el("pinConfirmModal"),
  cancelPin: el("cancelPinBtn"), confirmPin: el("confirmPinBtn"),
  reactionPicker: el("reactionPicker"), forwardModal: el("forwardModal"),
  closeForward: el("closeForwardModal"), forwardPreview: el("forwardMessagePreview"),
  forwardList: el("forwardChatList"), confirmForward: el("confirmForwardButton"),
  deletePasswordModal: el("deletePasswordModal"),
  deletePassword: el("deleteAccountPassword"),
  cancelDeletePassword: el("cancelDeletePassword"),
  confirmDeletePassword: el("confirmDeletePassword")
};

function show(node, display = "") { if (node) node.style.display = display; }
function hide(node) { if (node) node.style.display = "none"; }
function listen(stopArray, stop) { if (typeof stop === "function") stopArray.push(stop); }
function stopAll(arr) { arr.splice(0).forEach(fn => { try { fn(); } catch {} }); }
function esc(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[c]);
}
function initials(name = "User") {
  return String(name).trim().split(/\s+/).filter(Boolean).slice(0,2)
    .map(x => x[0].toUpperCase()).join("") || "U";
}
function timeOf(ts) {
  return ts ? new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "";
}
function notify(message) { window.alert(message); }
function setAuthMessage(message, error = true) {
  if (!dom.authMessage) return;
  dom.authMessage.textContent = message;
  dom.authMessage.style.color = error ? "#ff8585" : "#70dda4";
}
function avatarHTML(name, photo, extra = "") {
  return `<div class="avatar ${extra}">${photo ? `<img src="${esc(photo)}" alt="">` : esc(initials(name))}</div>`;
}
function activePath() {
  return activeRoom?.type === "general"
    ? "rooms/general/messages"
    : activeRoom?.type === "private"
      ? `privateChats/${activeRoom.id}/messages` : null;
}
function roomMetaPath() {
  return activeRoom?.type === "private"
    ? `privateChats/${activeRoom.id}` : "rooms/general";
}
function pinPath() { return `${roomMetaPath()}/pinnedMessage`; }
function cleanRoom() {
  stopAll(roomStops);
  messageCache.clear();
  for (const url of currentMediaUrls) URL.revokeObjectURL(url);
  currentMediaUrls.clear();
}
function setMobile(open) {
  document.body.classList.toggle("chat-open", open);
  $(".sidebar")?.classList.toggle("mobile-hidden", open);
  $(".chat-area")?.classList.toggle("mobile-active", open);
}
function emptyChat() {
  cleanRoom();
  activeRoom = null;
  if (dom.messages) dom.messages.innerHTML =
    `<div class="empty-chat"><div class="empty-chat-icon">💬</div><h3>Welcome to PankieChat</h3><p>Select a chat to start messaging</p></div>`;
  if (dom.headerName) dom.headerName.textContent = "PankieChat";
  if (dom.status) dom.status.textContent = "Select a chat to start messaging";
  if (dom.typing) dom.typing.textContent = "";
  hide(dom.pinnedBar);
  if (dom.input) { dom.input.disabled = true; dom.input.value = ""; }
  if (dom.send) dom.send.disabled = true;
  clearReply();
}

/* 4. AUTH */
dom.login?.addEventListener("click", async () => {
  const email = dom.email?.value.trim(), password = dom.password?.value || "";
  if (!email || !password) return setAuthMessage("Enter your email and password.");
  dom.login.disabled = true;
  setAuthMessage("Signing in…", false);
  try { await signInWithEmailAndPassword(auth, email, password); }
  catch (e) {
    const map = {
      "auth/invalid-credential":"Incorrect email or password.",
      "auth/user-not-found":"Account not found.",
      "auth/wrong-password":"Incorrect password.",
      "auth/invalid-email":"Enter a valid email.",
      "auth/too-many-requests":"Too many attempts. Try again later."
    };
    setAuthMessage(map[e.code] || e.message);
  } finally { dom.login.disabled = false; }
});
dom.register?.addEventListener("click", async () => {
  const email = dom.email?.value.trim(), password = dom.password?.value || "";
  if (!email || !password) return setAuthMessage("Enter your email and password.");
  if (password.length < 6) return setAuthMessage("Password must be at least 6 characters.");
  dom.register.disabled = true;
  setAuthMessage("Creating account…", false);
  try { await createUserWithEmailAndPassword(auth, email, password); }
  catch (e) {
    const map = {
      "auth/email-already-in-use":"This email is already registered.",
      "auth/invalid-email":"Enter a valid email.",
      "auth/weak-password":"Password must be at least 6 characters."
    };
    setAuthMessage(map[e.code] || e.message);
  } finally { dom.register.disabled = false; }
});
dom.logout?.addEventListener("click", async () => {
  try { await signOut(auth); } catch (e) { console.error(e); notify("Could not log out."); }
});
$$(".toggle-password").forEach(btn => btn.addEventListener("click", () => {
  const input = el(btn.dataset.target);
  if (input) input.type = input.type === "password" ? "text" : "password";
}));

/* 5. PROFILE */
async function ensureProfile(user) {
  const p = ref(db, `users/${user.uid}/profile`);
  const snap = await get(p);
  if (!snap.exists()) {
    await set(p, {
      name: user.email?.split("@")[0] || "User",
      username: "", photoURL: "", createdAt: Date.now()
    });
  }
}
function renderProfile() {
  if (!currentProfile) return;
  const name = currentProfile.name || "User";
  const photo = currentProfile.photoURL || "";
  if (dom.myProfile) {
    dom.myProfile.innerHTML = `${avatarHTML(name, photo, "green")}
      <div class="profile-info"><strong>${esc(name)}</strong>
      <span>${currentProfile.username ? "@"+esc(currentProfile.username) : "Set username"}</span></div>`;
  }
  if (dom.profileAvatar) {
    dom.profileAvatar.innerHTML = photo ? `<img src="${esc(photo)}" alt="">` : esc(initials(name));
  }
  if (dom.editName && !dom.editForm?.classList.contains("active")) dom.editName.value = name;
  if (dom.editUsername && !dom.editForm?.classList.contains("active")) dom.editUsername.value = currentProfile.username || "";
}
function listenProfile() {
  listen(userStops, onValue(ref(db, `users/${currentUser.uid}/profile`), snap => {
    currentProfile = snap.val() || {};
    renderProfile();
  }, console.error));
}
dom.myProfile?.addEventListener("click", () => { show(dom.profileModal); dom.profileModal?.classList.add("active"); });
dom.closeProfile?.addEventListener("click", () => { hide(dom.profileModal); dom.profileModal?.classList.remove("active"); });
dom.editProfile?.addEventListener("click", () => {
  if (dom.editName) dom.editName.value = currentProfile?.name || "";
  if (dom.editUsername) dom.editUsername.value = currentProfile?.username || "";
  show(dom.editForm); dom.editForm?.classList.add("active");
});
dom.cancelEdit?.addEventListener("click", () => {
  hide(dom.editForm); dom.editForm?.classList.remove("active"); renderProfile();
});
dom.saveProfile?.addEventListener("click", async e => {
  e.preventDefault();
  if (!currentUser) return;
  const name = dom.editName?.value.trim() || "";
  const username = dom.editUsername?.value.trim().toLowerCase() || "";
  if (!name) return notify("Enter your display name.");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return notify("Username must be 3–20 characters: a-z, 0-9, underscore.");
  dom.saveProfile.disabled = true;
  try {
    const old = currentProfile?.username || "";
    const usernameSnap = await get(ref(db, `usernames/${username}`));
    if (usernameSnap.exists() && usernameSnap.val() !== currentUser.uid) throw new Error("Username is already taken.");
    const updates = {
      [`users/${currentUser.uid}/profile/name`]: name,
      [`users/${currentUser.uid}/profile/username`]: username,
      [`usernames/${username}`]: currentUser.uid
    };
    if (old && old !== username) updates[`usernames/${old}`] = null;
    await update(ref(db), updates);
    hide(dom.editForm); dom.editForm?.classList.remove("active");
  } catch (e) { notify(e.message || "Profile update failed."); }
  finally { dom.saveProfile.disabled = false; }
});
dom.changePhoto?.addEventListener("click", () => dom.photoInput?.click());
dom.photoInput?.addEventListener("change", async () => {
  const file = dom.photoInput.files?.[0];
  if (!file || !currentUser) return;
  if (!file.type.startsWith("image/") || file.size > 500 * 1024) {
    notify("Choose an image no larger than 500 KB."); dom.photoInput.value = ""; return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try { await update(ref(db, `users/${currentUser.uid}/profile`), {photoURL: reader.result}); }
    catch (e) { console.error(e); notify("Could not update profile photo."); }
    finally { dom.photoInput.value = ""; }
  };
  reader.onerror = () => notify("Could not read image.");
  reader.readAsDataURL(file);
});

/* 6. PRESENCE */
function startPresence() {
  const connected = ref(db, ".info/connected");
  const mine = ref(db, `presence/${currentUser.uid}`);
  listen(userStops, onValue(connected, async snap => {
    if (snap.val() !== true) return;
    try {
      await onDisconnect(mine).set({state:"offline", lastChanged:serverTimestamp()});
      await set(mine, {state:"online", lastChanged:serverTimestamp()});
    } catch (e) { console.error("Presence:", e); }
  }));
}
function listenPeerPresence(uid) {
  if (dom.status) dom.status.textContent = "Loading status…";
  listen(roomStops, onValue(ref(db, `presence/${uid}`), snap => {
    const p = snap.val();
    if (!dom.status) return;
    if (p?.state === "online") dom.status.innerHTML = `<span class="online-dot"></span> Online`;
    else dom.status.textContent = p?.lastChanged
      ? `Last seen ${new Date(p.lastChanged).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}`
      : "Offline";
  }, console.error));
}

/* 7. CHAT LIST AND ROOMS */
function listenChatList() {
  listen(userStops, onValue(ref(db, `userChats/${currentUser.uid}`), snap => {
    const chats = [];
    snap.forEach(child => {
      const d = child.val();
      if (d?.peerUid) chats.push({id:child.key, ...d});
    });
    chats.sort((a,b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    renderChatList(chats);
  }, console.error));
}
function renderChatList(chats = []) {
  if (!dom.chatList) return;
  dom.chatList.innerHTML = "";
  const general = document.createElement("div");
  general.className = `chat-item general-chat-item ${activeRoom?.type === "general" ? "active" : ""}`;
  general.innerHTML = `${avatarHTML("General","", "blue")}
    <div class="chat-item-info"><div class="chat-item-top"><strong>General Chat</strong></div>
    <div class="chat-item-bottom"><span>Public conversation</span></div></div>`;
  general.addEventListener("click", openGeneralChat);
  dom.chatList.appendChild(general);

  chats.forEach(c => {
    const item = document.createElement("div");
    item.className = `chat-item ${activeRoom?.type === "private" && activeRoom.id === c.id ? "active" : ""}`;
    const n = c.peerName || "User", unread = Number(c.unreadCount || 0);
    item.innerHTML = `${avatarHTML(n,c.peerPhoto || "")}
      <div class="chat-item-info"><div class="chat-item-top"><strong>${esc(n)}</strong>
      <span class="chat-time">${timeOf(c.lastMessageAt)}</span></div>
      <div class="chat-item-bottom"><span class="last-message">${esc(c.lastMessage || "Start a conversation")}</span>
      ${unread ? `<span class="unread-badge">${unread > 99 ? "99+" : unread}</span>` : ""}</div></div>`;
    item.addEventListener("click", () => openPrivateChat(c.peerUid, {
      name:c.peerName || "User", username:c.peerUsername || "", photoURL:c.peerPhoto || ""
    }));
    dom.chatList.appendChild(item);
  });
  filterChatList();
}
function filterChatList() {
  const q = dom.chatSearch?.value.trim().toLowerCase() || "";
  $$(".chat-item", dom.chatList || document).forEach(item => {
    item.style.display = item.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}
dom.chatSearch?.addEventListener("input", filterChatList);
async function ensurePrivateChat(peerUid, peer) {
  const roomId = [currentUser.uid, peerUid].sort().join("_");
  const myRef = ref(db, `userChats/${currentUser.uid}/${roomId}`);
  const theirRef = ref(db, `userChats/${peerUid}/${roomId}`);
  const mySnap = await get(myRef), theirSnap = await get(theirRef);
  const mine = currentProfile || {};
  const oldMine = mySnap.val() || {};
  await set(myRef, {
    peerUid, peerName:peer.name || "User", peerUsername:peer.username || "",
    peerPhoto:peer.photoURL || "", unreadCount:Number(oldMine.unreadCount || 0),
    lastMessage:oldMine.lastMessage || "", lastMessageAt:oldMine.lastMessageAt || 0
  });
  const their = {
    peerUid:currentUser.uid, peerName:mine.name || currentUser.email?.split("@")[0] || "User",
    peerUsername:mine.username || "", peerPhoto:mine.photoURL || "",
    unreadCount:theirSnap.val()?.unreadCount || 0,
    lastMessage:theirSnap.val()?.lastMessage || "",
    lastMessageAt:theirSnap.val()?.lastMessageAt || 0
  };
  await set(theirRef, their);
  return roomId;
}
async function openGeneralChat() {
  if (!currentUser) return;
  cleanRoom();
  activeRoom = {type:"general", id:"general", path:"rooms/general/messages"};
  setMobile(true);
  if (dom.headerName) dom.headerName.textContent = "General Chat";
  if (dom.status) dom.status.textContent = "Public conversation";
  const headAvatar = $(".chat-header .avatar");
  if (headAvatar) headAvatar.textContent = "🌐";
  if (dom.input) { dom.input.disabled = false; dom.input.placeholder = "Message everyone…"; }
  if (dom.send) dom.send.disabled = false;
  if (dom.messages) dom.messages.innerHTML = "";
  renderChatListFromDb();
  listenMessages();
  listenPinned();
  clearReply();
  try { await remove(ref(db, `userChats/${currentUser.uid}/generalUnread`)); } catch (e) { console.error(e); }
}
async function renderChatListFromDb() {
  try {
    const snap = await get(ref(db, `userChats/${currentUser.uid}`));
    const chats = [];
    snap.forEach(c => { if (c.val()?.peerUid) chats.push({id:c.key,...c.val()}); });
    chats.sort((a,b)=>(b.lastMessageAt||0)-(a.lastMessageAt||0));
    renderChatList(chats);
  } catch (e) { console.error(e); }
}
async function openPrivateChat(uid, profile) {
  if (!currentUser || !uid || uid === currentUser.uid) return;
  cleanRoom();
  const roomId = [currentUser.uid, uid].sort().join("_");
  activeRoom = {type:"private", id:roomId, peerUid:uid, peerProfile:profile,
    path:`privateChats/${roomId}/messages`};
  setMobile(true);
  if (dom.headerName) dom.headerName.textContent = profile.name || "User";
  const headAvatar = $(".chat-header .avatar");
  if (headAvatar) headAvatar.innerHTML = profile.photoURL
    ? `<img src="${esc(profile.photoURL)}" alt="">` : esc(initials(profile.name));
  if (dom.input) { dom.input.disabled = false; dom.input.placeholder = `Message ${profile.name || "User"}…`; }
  if (dom.send) dom.send.disabled = false;
  if (dom.messages) dom.messages.innerHTML = "";
  clearReply();
  try {
    await ensurePrivateChat(uid, profile);
    await update(ref(db, `userChats/${currentUser.uid}/${roomId}`), {unreadCount:0});
    listenMessages();
    listenPinned();
    listenPeerPresence(uid);
    listenPeerTyping(uid);
    renderChatListFromDb();
  } catch (e) {
    console.error("Open private chat:", e);
    notify("Could not open this chat. Check your database rules.");
  }
}
dom.back?.addEventListener("click", () => setMobile(false));

/* 8. USER SEARCH */
dom.searchTrigger?.addEventListener("click", () => {
  show(dom.searchOverlay); dom.searchOverlay?.classList.add("active");
  dom.userSearch?.focus();
});
function closeSearch() {
  hide(dom.searchOverlay); dom.searchOverlay?.classList.remove("active");
  if (dom.userSearch) dom.userSearch.value = "";
  if (dom.searchResults) dom.searchResults.innerHTML = "";
}
dom.closeSearch?.addEventListener("click", closeSearch);
dom.searchOverlay?.addEventListener("click", e => { if (e.target === dom.searchOverlay) closeSearch(); });
dom.userSearch?.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = dom.userSearch.value.trim().toLowerCase();
  searchTimer = setTimeout(() => searchUsers(q), 300);
});
async function searchUsers(q) {
  if (!dom.searchResults || !currentUser) return;
  const request = ++searchRequest;
  dom.searchResults.innerHTML = "";
  if (q.length < 3) {
    dom.searchResults.innerHTML = `<div class="search-empty">Enter at least 3 characters</div>`;
    return;
  }
  dom.searchResults.innerHTML = `<div class="search-loading">Searching…</div>`;
  try {
    const u = await get(ref(db, `usernames/${q}`));
    if (request !== searchRequest) return;
    if (!u.exists() || u.val() === currentUser.uid) {
      dom.searchResults.innerHTML = `<div class="search-empty">${u.exists() ? "That's your account" : "No user found"}</div>`;
      return;
    }
    const uid = u.val();
    const p = await get(ref(db, `users/${uid}/profile`));
    if (request !== searchRequest) return;
    if (!p.exists()) {
      dom.searchResults.innerHTML = `<div class="search-empty">Profile unavailable</div>`;
      return;
    }
    const profile = p.val();
    const row = document.createElement("div");
    row.className = "search-user-item";
    row.innerHTML = `${avatarHTML(profile.name,profile.photoURL)}
      <div class="search-user-info"><strong>${esc(profile.name || "User")}</strong>
      <span>@${esc(profile.username || q)}</span></div><span>›</span>`;
    row.addEventListener("click", async () => { closeSearch(); await openPrivateChat(uid,profile); });
    dom.searchResults.replaceChildren(row);
  } catch (e) {
    console.error("Search:",e);
    if (request === searchRequest) dom.searchResults.innerHTML = `<div class="search-empty">Search failed</div>`;
  }
}

/* 9. TYPING */
function setTyping(value) {
  if (!activeRoom || activeRoom.type !== "private" || !currentUser) return Promise.resolve();
  const r = ref(db, `privateChats/${activeRoom.id}/typing/${currentUser.uid}`);
  return value ? set(r,{isTyping:true,updatedAt:Date.now()}) : remove(r);
}
function listenPeerTyping(uid) {
  listen(roomStops, onValue(ref(db, `privateChats/${activeRoom.id}/typing/${uid}`), snap => {
    if (dom.typing) dom.typing.textContent = snap.val()?.isTyping ? "typing…" : "";
  }, console.error));
}
dom.input?.addEventListener("input", () => {
  if (activeRoom?.type !== "private") return;
  setTyping(true).catch(console.error);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => setTyping(false).catch(console.error), 1300);
});

/* 10. MESSAGE RENDERING */
function addDateSeparator(timestamp) {
  const date = new Date(timestamp).toLocaleDateString();
  const last = dom.messages?.querySelector(".date-separator:last-of-type");
  if (last?.dataset.date === date) return;
  const node = document.createElement("div");
  node.className = "date-separator";
  node.dataset.date = date;
  node.textContent = new Date(timestamp).toLocaleDateString([], {weekday:"long",month:"short",day:"numeric"});
  dom.messages?.appendChild(node);
}
function renderMessage(id, data) {
  if (!dom.messages || !data) return;
  const old = $(`[data-message-id="${CSS.escape(id)}"]`, dom.messages);
  if (old) old.remove();
  const mine = data.uid === currentUser.uid;
  const wrapper = document.createElement("div");
  wrapper.className = `message ${mine ? "sent" : "received"}`;
  wrapper.dataset.messageId = id;
  wrapper.dataset.uid = data.uid || "";
  const reply = data.replyTo;
  const replyHTML = reply ? `<div class="reply-quote"><strong>${esc(reply.senderName || "Message")}</strong><span>${esc(reply.text || "Attachment")}</span></div>` : "";
  const forwarded = data.forwarded ? `<div class="forwarded-label">↪ Forwarded</div>` : "";
  let body = `<div class="message-text">${esc(data.text || "")}</div>`;
  if (data.media?.key) body = `<div class="media-loading">Loading attachment…</div>`;
  const reactions = data.reactions || {};
  const reactionCounts = {};
  Object.values(reactions).forEach(r => { reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1; });
  const reactionHTML = Object.entries(reactionCounts).map(([emoji,count]) =>
    `<button class="reaction-chip" data-emoji="${esc(emoji)}">${esc(emoji)} ${count}</button>`).join("");
  wrapper.innerHTML = `${forwarded}${replyHTML}${body}
    <div class="message-meta"><span>${timeOf(data.createdAt)}</span>${mine ? `<span>${esc(data.status || "sent")}</span>` : ""}</div>
    ${reactionHTML}`;
  wrapper.addEventListener("click", e => {
    const chip = e.target.closest(".reaction-chip");
    if (chip) { e.stopPropagation(); toggleReaction(id, chip.dataset.emoji); return; }
    if (e.target.closest("a,video,audio,button")) return;
    openMessageMenu(id, data, wrapper, e);
  });
  addDateSeparator(data.createdAt || Date.now());
  const typing = $("#typingIndicator");
  if (typing?.parentNode === dom.messages) dom.messages.insertBefore(wrapper, typing);
  else dom.messages.appendChild(wrapper);
  if (data.media?.key) downloadAndDisplayMedia(wrapper, data, id);
}
function listenMessages() {
  const path = activePath();
  if (!path) return;
  const messagesRef = ref(db,path);
  listen(roomStops, onChildAdded(messagesRef, snap => {
    const data = snap.val();
    messageCache.set(snap.key,data);
    renderMessage(snap.key,data);
    if (data.uid !== currentUser.uid && activeRoom?.type === "private") {
      update(ref(db, `${path}/${snap.key}`), {status:"seen"}).catch(console.error);
    }
    scrollToBottom();
  }, console.error));
  listen(roomStops, onChildChanged(messagesRef, snap => {
    const data = snap.val();
    messageCache.set(snap.key,data);
    renderMessage(snap.key,data);
    scrollToBottom();
  }, console.error));
  listen(roomStops, onChildRemoved(messagesRef, snap => {
    messageCache.delete(snap.key);
    const node = $(`[data-message-id="${CSS.escape(snap.key)}"]`,dom.messages);
    node?.remove();
    refreshDateSeparators();
    refreshChatPreviewAfterDelete();
  }, console.error));
}
function refreshDateSeparators() {
  $$(".date-separator",dom.messages || document).forEach(n=>n.remove());
  const messages = [...(dom.messages?.querySelectorAll(".message") || [])];
  let last = "";
  messages.forEach(m => {
    const d = new Date(Number(m.dataset.timestamp || Date.now())).toLocaleDateString();
    if (d !== last) { last=d; }
  });
}
function scrollToBottom() {
  if (dom.messages) dom.messages.scrollTop = dom.messages.scrollHeight;
}
async function refreshChatPreviewAfterDelete() {
  if (!activeRoom) return;
  if (activeRoom.type === "general") return;
  const snap = await get(ref(db,activePath()));
  let latest = null;
  snap.forEach(child => { const v=child.val(); if (!latest || (v.createdAt||0)>(latest.createdAt||0)) latest=v; });
  const base = `userChats`;
  const updates = {};
  for (const uid of [currentUser.uid,activeRoom.peerUid]) {
    updates[`${base}/${uid}/${activeRoom.id}/lastMessage`] = latest?.text || (latest?.media ? "Attachment" : "");
    updates[`${base}/${uid}/${activeRoom.id}/lastMessageAt`] = latest?.createdAt || 0;
  }
  await update(ref(db),updates);
}

/* 11. SEND TEXT, REPLY, UNREAD */
async function sendMessage() {
  if (!currentUser || !activeRoom || !dom.input) return;
  const text = dom.input.value.trim();
  if (!text) return;
  const now = Date.now();
  const message = {
    text, uid:currentUser.uid,
    senderName:currentProfile?.name || "User",
    createdAt:now, status:"sent"
  };
  if (replyTarget) message.replyTo = replyTarget;
  dom.send && (dom.send.disabled = true);
  try {
    const messageRef = push(ref(db,activePath()));
    await set(messageRef,message);
    await updateChatMetadata(text,now);
    dom.input.value = "";
    clearReply();
    setTyping(false).catch(console.error);
    scrollToBottom();
  } catch (e) {
    console.error("Send message:",e);
    notify("Message could not be sent. Check your connection.");
  } finally { if (dom.send) dom.send.disabled = false; }
}
async function updateChatMetadata(lastMessage, timestamp) {
  if (activeRoom?.type !== "private") return;
  const updates = {};
  updates[`userChats/${currentUser.uid}/${activeRoom.id}/lastMessage`] = lastMessage;
  updates[`userChats/${currentUser.uid}/${activeRoom.id}/lastMessageAt`] = timestamp;
  updates[`userChats/${activeRoom.peerUid}/${activeRoom.id}/lastMessage`] = lastMessage;
  updates[`userChats/${activeRoom.peerUid}/${activeRoom.id}/lastMessageAt`] = timestamp;
  updates[`userChats/${activeRoom.peerUid}/${activeRoom.id}/unreadCount`] = null;
  await update(ref(db),updates);
  const peerUnreadRef = ref(db,`userChats/${activeRoom.peerUid}/${activeRoom.id}/unreadCount`);
  await runUnreadIncrement(peerUnreadRef);
}
async function runUnreadIncrement(r) {
  await runTransaction(r, current => Number(current || 0) + 1);
}
dom.send?.addEventListener("click",sendMessage);
dom.input?.addEventListener("keydown",e=>{
  if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

/* 12. REPLY */
function clearReply() {
  replyTarget = null;
  hide(dom.replyPreview);
  if (dom.replyText) dom.replyText.textContent = "";
}
dom.cancelReply?.addEventListener("click",clearReply);
function beginReply(id,data) {
  replyTarget = {id,uid:data.uid,senderName:data.senderName || "User",text:data.text || (data.media ? "Attachment" : "")};
  if (dom.replyText) dom.replyText.textContent = `${replyTarget.senderName}: ${replyTarget.text}`;
  show(dom.replyPreview);
  dom.input?.focus();
}

/* 13. MESSAGE ACTION MENU */
function closeMessageMenu() { hide(dom.actionMenu); selectedMessage = null; }
function openMessageMenu(id,data,node,event) {
  if (!dom.actionMenu) return;
  selectedMessage = {id,data};
  const rect = node.getBoundingClientRect();
  dom.actionMenu.style.position = "fixed";
  dom.actionMenu.style.left = `${Math.max(8,Math.min(rect.left,event.clientX))}px`;
  dom.actionMenu.style.top = `${Math.min(window.innerHeight-260,Math.max(8,event.clientY))}px`;
  show(dom.actionMenu,"flex");
}
document.addEventListener("click",e=>{
  if (!e.target.closest("#messageActionMenu") && !e.target.closest(".message")) closeMessageMenu();
});
dom.actionMenu?.addEventListener("click",async e=>{
  const action = e.target.closest("[id]")?.id;
  if (!action || !selectedMessage) return;
  const {id,data} = selectedMessage;
  closeMessageMenu();
  if (action==="replyAction") beginReply(id,data);
  else if (action==="copyAction") {
    if (data.text) {
      try { await navigator.clipboard.writeText(data.text); }
      catch { notify("Clipboard access is unavailable."); }
    }
  } else if (action==="deleteAction") confirmDeleteMessage(id,data);
  else if (action==="pinAction") openPinConfirm(id,data);
  else if (action==="forwardAction") openForwardModal(data);
  else if (action==="reactAction") {
    selectedMessage = {id,data};
    show(dom.reactionPicker,"flex");
  }
});

/* 14. DELETE MESSAGE */
function confirmDeleteMessage(id,data) {
  if (!confirm("Delete this message?")) return;
  remove(ref(db,`${activePath()}/${id}`)).then(async()=>{
    if (activeRoom?.type==="private") await refreshChatPreviewAfterDelete();
  }).catch(e=>{console.error(e);notify("Could not delete message.");});
}

/* 15. PIN / UNPIN */
function openPinConfirm(id,data) {
  selectedMessage = {id,data};
  show(dom.pinModal,"flex");
}
dom.cancelPin?.addEventListener("click",()=>{hide(dom.pinModal);selectedMessage=null;});
dom.confirmPin?.addEventListener("click",async()=>{
  if (!selectedMessage || !activeRoom) return;
  const {id,data}=selectedMessage;
  try {
    await set(ref(db,pinPath()),{
      messageId:id,text:data.text || "Attachment",
      senderName:data.senderName || "User",uid:data.uid,createdAt:Date.now()
    });
    hide(dom.pinModal);
    selectedMessage=null;
  } catch(e){console.error(e);notify("Could not pin message.");}
});
function listenPinned() {
  listen(roomStops,onValue(ref(db,pinPath()),snap=>{
    const p=snap.val();
    if (!p) { hide(dom.pinnedBar); return; }
    if (dom.pinnedText) dom.pinnedText.textContent=`${p.senderName || "User"}: ${p.text || "Attachment"}`;
    show(dom.pinnedBar);
  },console.error));
}
dom.unpin?.addEventListener("click",async()=>{
  if (!activeRoom) return;
  if (!confirm("Unpin this message?")) return;
  try { await remove(ref(db,pinPath())); } catch(e){console.error(e);notify("Could not unpin.");}
});

/* 16. REACTIONS */
async function toggleReaction(messageId,emoji) {
  if (!activeRoom || !currentUser) return;
  const reactionRef=ref(db,`${activePath()}/${messageId}/reactions/${currentUser.uid}`);
  try {
    const snap=await get(reactionRef);
    if (snap.val()?.emoji===emoji) await remove(reactionRef);
    else await set(reactionRef,{emoji,uid:currentUser.uid});
  } catch(e){console.error(e);}
}
dom.reactionPicker?.addEventListener("click",e=>{
  const btn=e.target.closest("[data-reaction]");
  if (!btn || !selectedMessage) return;
  toggleReaction(selectedMessage.id,btn.dataset.reaction);
  hide(dom.reactionPicker);
});

/* 17. FORWARD */
async function openForwardModal(data) {
  forwardMessage=data; forwardTarget=null;
  if (dom.forwardPreview) dom.forwardPreview.textContent=data.text || "Attachment";
  if (dom.forwardList) dom.forwardList.innerHTML="";
  show(dom.forwardModal,"flex");
  try {
    const snap=await get(ref(db,`userChats/${currentUser.uid}`));
    const chats=[];
    snap.forEach(c=>{if(c.val()?.peerUid)chats.push({id:c.key,...c.val()});});
    chats.sort((a,b)=>(b.lastMessageAt||0)-(a.lastMessageAt||0));
    chats.forEach(c=>{
      const row=document.createElement("button");
      row.type="button"; row.className="forward-chat-item";
      row.innerHTML=`${avatarHTML(c.peerName,c.peerPhoto)}<span>${esc(c.peerName||"User")}</span>`;
      row.addEventListener("click",()=>{
        forwardTarget=c;
        $$(".forward-chat-item",dom.forwardList).forEach(x=>x.classList.remove("selected"));
        row.classList.add("selected");
        if(dom.confirmForward)dom.confirmForward.disabled=false;
      });
      dom.forwardList?.appendChild(row);
    });
    if(dom.confirmForward)dom.confirmForward.disabled=true;
  } catch(e){console.error(e);notify("Could not load chats.");}
}
dom.closeForward?.addEventListener("click",()=>hide(dom.forwardModal));
dom.confirmForward?.addEventListener("click",async()=>{
  if(!forwardMessage||!forwardTarget)return;
  try{
    const now=Date.now();
    const payload={
      text:forwardMessage.text || "",
      uid:currentUser.uid,
      senderName:currentProfile?.name || "User",
      createdAt:now,status:"sent",forwarded:true
    };
    if(forwardMessage.media) payload.text="[Forwarded attachment metadata unavailable]";
    const path=`privateChats/${forwardTarget.id}/messages`;
    await set(push(ref(db,path)),payload);
    const updates={};
    updates[`userChats/${currentUser.uid}/${forwardTarget.id}/lastMessage`]=payload.text || "Forwarded message";
    updates[`userChats/${currentUser.uid}/${forwardTarget.id}/lastMessageAt`]=now;
    updates[`userChats/${forwardTarget.peerUid}/${forwardTarget.id}/lastMessage`]=payload.text || "Forwarded message";
    updates[`userChats/${forwardTarget.peerUid}/${forwardTarget.id}/lastMessageAt`]=now;
    await update(ref(db),updates);
    await runUnreadIncrement(ref(db,`userChats/${forwardTarget.peerUid}/${forwardTarget.id}/unreadCount`));
    hide(dom.forwardModal);
  }catch(e){console.error(e);notify("Forward failed.");}
});

/* 18. B2 MEDIA UPLOAD / DOWNLOAD */
const MAX_MEDIA_SIZE=4*1024*1024;
function fileToBase64(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(",")[1] || "");
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}
async function uploadToB2(file) {
  if(!currentUser||!activeRoom)throw new Error("Select a chat first.");
  if(file.size===0||file.size>MAX_MEDIA_SIZE)throw new Error("File must be 4 MB or smaller.");
  const token=await currentUser.getIdToken();
  const fileData=await fileToBase64(file);
  const response=await fetch("/.netlify/functions/b2-upload",{
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
    body:JSON.stringify({
      fileName:file.name,contentType:file.type,fileData,
      roomType:activeRoom.type,roomId:activeRoom.id
    })
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.success)throw new Error(result.error || "Upload failed.");
  return result;
}
async function downloadAndDisplayMedia(wrapper,data,messageId) {
  const placeholder=$(".media-loading",wrapper);
  try{
    const token=await currentUser.getIdToken();
    const response=await fetch("/.netlify/functions/b2-download",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({
        key:data.media.key,roomType:activeRoom.type,
        roomId:activeRoom.id,messageId
      })
    });
    if(!response.ok)throw new Error("Download failed.");
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    currentMediaUrls.add(url);
    const type=data.media.contentType || blob.type;
    let node;
    if(type.startsWith("image/")){
      node=document.createElement("img");node.className="chat-media-image";node.alt=data.media.name || "Image";node.src=url;
    }else if(type.startsWith("video/")){
      node=document.createElement("video");node.className="chat-media-video";node.controls=true;node.src=url;
    }else if(type.startsWith("audio/")){
      node=document.createElement("audio");node.controls=true;node.src=url;
    }else{
      node=document.createElement("a");node.className="chat-file-link";node.href=url;node.download=data.media.name || "download";node.textContent=`📎 ${data.media.name || "Download file"}`;
    }
    placeholder?.replaceWith(node);
  }catch(e){
    console.error("Media download:",e);
    if(placeholder)placeholder.textContent="Attachment unavailable";
  }
}
function openPhotoPreview(file) {
  selectedMediaFile=file;
  if(dom.photoImage)dom.photoImage.src=URL.createObjectURL(file);
  if(dom.photoName)dom.photoName.textContent=file.name;
  if(dom.photoProgressText)dom.photoProgressText.textContent="0%";
  if(dom.photoProgressCircle)dom.photoProgressCircle.style.setProperty("--progress","0deg");
  show(dom.photoModal,"flex");
}
function closePhotoPreview() {
  hide(dom.photoModal);
  if(dom.photoImage?.src.startsWith("blob:"))URL.revokeObjectURL(dom.photoImage.src);
  if(dom.photoImage)dom.photoImage.removeAttribute("src");
  selectedMediaFile=null;
}
dom.closePhoto?.addEventListener("click",closePhotoPreview);
dom.mediaInput?.addEventListener("change",()=>{
  const f=dom.mediaInput.files?.[0];if(!f)return;
  if(!["image/","video/"].some(t=>f.type.startsWith(t))){notify("Choose an image or video.");dom.mediaInput.value="";return;}
  if(f.size>MAX_MEDIA_SIZE){notify("Maximum file size is 4 MB.");dom.mediaInput.value="";return;}
  if(f.type.startsWith("image/"))openPhotoPreview(f);
  else sendAttachment(f).finally(()=>{dom.mediaInput.value="";});
});
dom.documentInput?.addEventListener("change",async()=>{
  const f=dom.documentInput.files?.[0];if(!f)return;
  const allowed=["application/pdf","text/plain"];
  if(!allowed.includes(f.type)){notify("Currently supported document types: PDF and TXT.");dom.documentInput.value="";return;}
  await sendAttachment(f);dom.documentInput.value="";
});
async function sendAttachment(file) {
  if(photoUploading||!activeRoom)return;
  photoUploading=true;
  const roomAtStart = {...activeRoom};
  if(dom.sendPhoto)dom.sendPhoto.disabled=true;
  try{
    const result = await uploadToB2(file);
    const now = Date.now();
    const preview = file.name || "Attachment";
    if (roomAtStart.type === "private") {
      const updates = {};
      updates[`userChats/${currentUser.uid}/${roomAtStart.id}/lastMessage`] = preview;
      updates[`userChats/${currentUser.uid}/${roomAtStart.id}/lastMessageAt`] = now;
      updates[`userChats/${roomAtStart.peerUid}/${roomAtStart.id}/lastMessage`] = preview;
      updates[`userChats/${roomAtStart.peerUid}/${roomAtStart.id}/lastMessageAt`] = now;
      await update(ref(db), updates);
      await runUnreadIncrement(ref(db,`userChats/${roomAtStart.peerUid}/${roomAtStart.id}/unreadCount`));
    }
    if(dom.photoProgressText)dom.photoProgressText.textContent="100%";
    if(dom.photoProgressCircle)dom.photoProgressCircle.style.setProperty("--progress","360deg");
    if (activeRoom?.id === roomAtStart.id) closePhotoPreview();
    renderChatListFromDb();
  }catch(e){console.error(e);notify(e.message || "Upload failed.");}
  finally{photoUploading=false;if(dom.sendPhoto)dom.sendPhoto.disabled=false;}
}
dom.sendPhoto?.addEventListener("click",async()=>{
  if(!selectedMediaFile||photoUploading)return;
  await sendAttachment(selectedMediaFile);
});
dom.attach?.addEventListener("click",()=>{
  dom.attachmentPopup?.classList.toggle("active");
  if(dom.attachmentPopup)dom.attachmentPopup.style.display=dom.attachmentPopup.classList.contains("active")?"flex":"none";
});
document.addEventListener("click",e=>{
  if(!e.target.closest("#attachmentPopup")&&!e.target.closest("#attachButton")){
    hide(dom.attachmentPopup);dom.attachmentPopup?.classList.remove("active");
  }
});
el("photoOption")?.addEventListener("click",()=>{hide(dom.attachmentPopup);dom.mediaInput?.click();});
el("fileOption")?.addEventListener("click",()=>{hide(dom.attachmentPopup);dom.documentInput?.click();});
el("locationOption")?.addEventListener("click",()=>{
  hide(dom.attachmentPopup);
  if(!navigator.geolocation)return notify("Location is not available in this browser.");
  navigator.geolocation.getCurrentPosition(pos=>{
    const text=`Location: https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
    if(dom.input){dom.input.value=text;dom.input.focus();}
  },()=>notify("Could not access location."));
});
el("voiceOption")?.addEventListener("click",()=>notify("Voice messages are not enabled in this version yet."));

/* 19. ACCOUNT DELETION */
el("deleteAccountBtn")?.addEventListener("click",()=>{
  show(dom.deletePasswordModal,"flex");
});
dom.cancelDeletePassword?.addEventListener("click",()=>hide(dom.deletePasswordModal));
dom.confirmDeletePassword?.addEventListener("click",async()=>{
  const password=dom.deletePassword?.value || "";
  if(!password||!currentUser?.email)return notify("Enter your password.");
  dom.confirmDeletePassword.disabled=true;
  try{
    const credential=EmailAuthProvider.credential(currentUser.email,password);
    await reauthenticateWithCredential(currentUser,credential);
    const uid=currentUser.uid;
    const profileSnap=await get(ref(db,`users/${uid}/profile`));
    const username=profileSnap.val()?.username;
    const updates={
      [`users/${uid}`]:null,
      [`presence/${uid}`]:null
    };
    if(username)updates[`usernames/${username}`]=null;
    const chatsSnap=await get(ref(db,`userChats/${uid}`));
    chatsSnap.forEach(child=>{
      updates[`userChats/${uid}/${child.key}`]=null;
    });
    await update(ref(db),updates);
    await deleteUser(currentUser);
    hide(dom.deletePasswordModal);
  }catch(e){console.error(e);notify(e.code==="auth/wrong-password"?"Incorrect password.":e.message || "Account deletion failed.");}
  finally{dom.confirmDeletePassword.disabled=false;}
});

/* 20. GLOBAL CLEANUP AND AUTH STATE */
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible" && currentUser && activeRoom?.type==="private"){
    setTyping(false).catch(()=>{});
  }
});
window.addEventListener("beforeunload",()=>{
  for(const u of currentMediaUrls)URL.revokeObjectURL(u);
});
function bootUser() {
  listenProfile();
  startPresence();
  listenChatList();
  emptyChat(); // Do not automatically open General.
}
function bootSignedOut() {
  stopAll(roomStops);stopAll(userStops);
  currentUser=null;currentProfile=null;activeRoom=null;
  emptyChat();
  hide(dom.splash);show(dom.auth);hide(dom.app);
}
hide(dom.auth);hide(dom.app);show(dom.splash);
onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(!user){bootSignedOut();return;}
  try{
    await ensureProfile(user);
    hide(dom.splash);hide(dom.auth);show(dom.app);
    dom.app?.classList.add("active");
    bootUser();
  }catch(e){
    console.error("Startup:",e);
    notify("Could not initialize PankieChat. Check Firebase config and database rules.");
    hide(dom.splash);show(dom.auth);hide(dom.app);
  }
});

/* End of PankieChat app.js */
