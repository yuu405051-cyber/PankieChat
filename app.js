
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  push,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onValue,
  set,
  get,
  update,
  remove,
  runTransaction,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js";

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

// INITIALIZE FIREBASE
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// ELEMENTS
const authScreen = document.querySelector("#authScreen");
const splashScreen = document.querySelector("#splashScreen");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const loginBtn = document.querySelector("#loginBtn");
const registerBtn = document.querySelector("#registerBtn");
const authMessage = document.querySelector("#authMessage");

const appScreen = document.querySelector("#app");
const logoutBtn = document.querySelector("#logoutBtn");

const messageInput = document.querySelector(".message-input input");
const sendButton = document.querySelector(".message-input .send");
const messagesArea = document.querySelector(".messages");

const userSearch = document.querySelector("#userSearch");
const searchResults = document.querySelector("#searchResults");
const chatList = document.querySelector(".chat-list");

const chatHeaderName = document.querySelector(".chat-header b");
const chatHeaderAvatar = document.querySelector(".chat-header .avatar");

const myProfile = document.querySelector("#myProfile");
const profileModal = document.querySelector("#profileModal");
const closeProfile = document.querySelector("#closeProfile");

const photoInput = document.querySelector("#photoInput");
const changePhotoBtn = document.querySelector("#changePhotoBtn");
const profileAvatar = document.querySelector("#profileAvatar");

const editProfileBtn = document.querySelector("#editProfileBtn");
const editForm = document.querySelector("#editForm");
const editName = document.querySelector("#editName");
const editUsername = document.querySelector("#editUsername");
const saveProfile = document.querySelector("#saveProfile");
const cancelEdit = document.querySelector("#cancelEdit");

// STATE
let currentUser = null;
let currentProfile = null;
let activeRoom = null;

let stopMessages = null;
let stopPinnedMessage = null;
let stopPresence = null;
let stopTyping = null;
let stopPeerPresence = null;
let stopUserChats = null;
let stopGeneralPreview = null;

let replyingTo = null;
let selectedMessage = null;
let pendingPinMessage = null;

let searchRequest = 0;
let typingWriteQueue = Promise.resolve();

const profileListeners = new Map();
const unreadListeners = new Map();
const chatPresenceListeners = new Map();
const chatTypingListeners = new Map();
const chatMessageListeners = new Map();

// SPLASH
function hideSplash() {
  if (splashScreen) {
    splashScreen.classList.add("hide");
  }
}

// CLEAN UP CHAT LISTENERS
function stopMapListeners(map) {
  map.forEach(stop => {
    try {
      stop();
    } catch (error) {
      console.error(error);
    }
  });

  map.clear();
}

// CLEAN UP ALL LISTENERS
function stopAllListeners() {
  if (stopUserChats) {
  stopUserChats();
  stopUserChats = null;
}

if (stopGeneralPreview) {
  stopGeneralPreview();
  stopGeneralPreview = null;
}
  [
    stopMessages,
    stopPinnedMessage,
    stopPresence,
    stopTyping,
    stopPeerPresence
  ].forEach(stop => {
    if (typeof stop === "function") {
      try {
        stop();
      } catch (error) {
        console.error(error);
      }
    }
  });

  stopMessages = null;
  stopPinnedMessage = null;
  stopPresence = null;
  stopTyping = null;
  stopPeerPresence = null;

  stopMapListeners(profileListeners);
  stopMapListeners(unreadListeners);
  stopMapListeners(chatPresenceListeners);
  stopMapListeners(chatTypingListeners);
  stopMapListeners(chatMessageListeners);
}

// PINNED MESSAGE PATH
function getPinnedMessagePath() {
  if (!activeRoom) return null;

  return activeRoom.type === "general"
    ? "rooms/general/pinnedMessage"
    : `privateChats/${activeRoom.id}/pinnedMessage`;
}

// MESSAGE MENU
const messageActionMenu = document.getElementById("messageActionMenu");

function closeMessageMenu() {
  if (!messageActionMenu) return;

  messageActionMenu.style.display = "none";

  const picker = document.getElementById("reactionPicker");

  if (picker) {
    picker.style.display = "none";
  }

  selectedMessage = null;
}

document.addEventListener("click", event => {
  if (
    !event.target.closest(".message-action-menu") &&
    !event.target.closest(".message")
  ) {
    closeMessageMenu();
  }
});

// SET TYPING STATUS
function setTyping(isTyping) {
  if (!currentUser || !activeRoom || activeRoom.type !== "private") {
    return Promise.resolve();
  }

  const typingRef = ref(
    db,
    `privateChats/${activeRoom.id}/typing/${currentUser.uid}`
  );

  typingWriteQueue = typingWriteQueue
    .catch(() => {})
    .then(() => set(typingRef, Boolean(isTyping)));

  return typingWriteQueue.catch(error => {
    console.error("Typing Error:", error);
  });
}

// MESSAGE TYPING EVENT
let typingTimer = null;

messageInput.addEventListener("input", () => {
  if (!activeRoom || activeRoom.type !== "private") return;

  if (messageInput.value.trim()) {
    setTyping(true);

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
      setTyping(false);
    }, 2000);
  } else {
    clearTimeout(typingTimer);
    setTyping(false);
  }
});

// ONLINE / OFFLINE PRESENCE
function startPresence() {
  if (!currentUser) return;

  if (stopPresence) {
    stopPresence();
    stopPresence = null;
  }

  const uid = currentUser.uid;
  const connectedRef = ref(db, ".info/connected");
  const presenceRef = ref(db, `presence/${uid}`);

  stopPresence = onValue(connectedRef, async snapshot => {
    if (snapshot.val() !== true) return;

    try {
      await onDisconnect(presenceRef).set({
        state: "offline",
        lastChanged: serverTimestamp()
      });

      await set(presenceRef, {
        state: "online",
        lastChanged: serverTimestamp()
      });

    } catch (error) {
      console.error("Presence Error:", error);
    }
  });
}

// USERNAME HELPERS
function cleanUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

async function claimUsername(username, uid) {
  const usernameRef = ref(db, `usernames/${username}`);

  const result = await runTransaction(usernameRef, value => {
    if (value === null || value === uid) {
      return uid;
    }

    return;
  });

  return result.committed;
}

async function releaseUsername(username, uid) {
  if (!username) return;

  const usernameRef = ref(db, `usernames/${username}`);

  await runTransaction(usernameRef, value => {
    if (value === uid) return null;
    return;
  });
}

async function claimUniqueUsername(baseUsername, uid) {
  let base = cleanUsername(baseUsername)
    .replace(/[^a-z0-9_]/g, "");

  if (base.length < 3) base = "user";
  base = base.slice(0, 12);

  const suffix = uid.slice(0, 6).toLowerCase();

  for (let i = 0; i < 100; i++) {
    let candidate;

    if (i === 0) {
      candidate = base;
    } else if (i === 1) {
      candidate = `${base}_${suffix}`;
    } else {
      candidate = `${base}_${suffix}${i}`;
    }

    candidate = candidate.slice(0, 20);

    if (candidate.length < 3) continue;

    if (await claimUsername(candidate, uid)) {
      return candidate;
    }
  }

  throw new Error("Could not create a unique username.");
}

// AUTH LOADING
function setAuthLoading(loading, message = "") {
  loginBtn.disabled = loading;
  registerBtn.disabled = loading;

  if (message) {
    authMessage.textContent = message;
  }
}

// REGISTER
registerBtn.onclick = async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) {
    authMessage.textContent = "Enter your email and password.";
    return;
  }

  if (password.length < 6) {
    authMessage.textContent = "Password must be at least 6 characters.";
    return;
  }

  setAuthLoading(true, "Creating account...");

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    authMessage.textContent = "Account created successfully!";

  } catch (error) {
    console.error("Register Error:", error);

    authMessage.textContent =
      error.code === "auth/email-already-in-use"
        ? "This email is already registered."
        : error.code === "auth/invalid-email"
          ? "Invalid email address."
          : error.code === "auth/weak-password"
            ? "Password is too weak."
            : error.message;

    hideSplash();

  } finally {
    setAuthLoading(false);
  }
};

// LOGIN
loginBtn.onclick = async () => {
  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (!email || !password) {
    authMessage.textContent = "Enter your email and password.";
    return;
  }

  setAuthLoading(true, "Logging in...");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    authMessage.textContent = "Login successful!";

  } catch (error) {
    console.error("Login Error:", error);

    authMessage.textContent =
      error.code === "auth/invalid-credential" ||
      error.code === "auth/user-not-found" ||
      error.code === "auth/wrong-password"
        ? "Incorrect email or password."
        : error.message;

    hideSplash();

  } finally {
    setAuthLoading(false);
  }
};

// WAIT FOR AUTH CHECK
authScreen.style.display = "none";
appScreen.style.display = "none";

// AUTH STATE
onAuthStateChanged(auth, async user => {
  currentUser = user;

  try {
    if (user) {
      authScreen.style.display = "none";
      appScreen.style.display = "flex";

      await loadProfile();
      await loadUserChats();

      listenAllChatPresence();
      listenAllChatTyping();
      startPresence();

      activeRoom = null;

      chatHeaderName.textContent = "PankieChat";
      chatHeaderAvatar.className = "avatar blue";
      chatHeaderAvatar.textContent = "P";

      document.querySelector("#chatStatus").textContent =
        "Select a chat to start messaging";

      document.querySelector("#typingStatus").textContent = "";

      messagesArea.querySelectorAll(".message, .live-typing-indicator")
        .forEach(message => message.remove());

      setActiveChat("");
      appScreen.classList.remove("mobile-chat-open");

      authMessage.textContent = "";

    } else {
      stopAllListeners();

      authScreen.style.display = "flex";
      appScreen.style.display = "none";

      closeMessageMenu();

      activeRoom = null;
      currentProfile = null;
      pendingPinMessage = null;
      replyingTo = null;

      searchResults.innerHTML = "";
      userSearch.value = "";
      chatList.innerHTML = "";

      messagesArea.querySelectorAll(".message, .live-typing-indicator")
        .forEach(message => message.remove());

      profileModal.classList.remove("show");
    }

  } catch (error) {
    console.error("App Load Error:", error);

    if (user) {
      authScreen.style.display = "none";
      appScreen.style.display = "flex";

      authMessage.textContent =
        "Could not load app: " + error.message;
    } else {
      authScreen.style.display = "flex";
      appScreen.style.display = "none";
    }

  } finally {
    hideSplash();
  }
});

// LOGOUT
logoutBtn.onclick = async () => {
  try {
    await setTyping(false);
    await signOut(auth);
    profileModal.classList.remove("show");

  } catch (error) {
    alert(error.message);
  }
};

// LOAD PROFILE
async function loadProfile() {
  if (!currentUser) return;

  const uid = currentUser.uid;
  const profileRef = ref(db, `users/${uid}/profile`);

  const snapshot = await get(profileRef);
  let profile = snapshot.val();

  if (!profile) {
    const emailName = (currentUser.email || "user")
      .split("@")[0]
      .toLowerCase();

    const username = await claimUniqueUsername(emailName, uid);

    profile = {
      name: emailName,
      username,
      photo: ""
    };

    await set(profileRef, profile);

  } else {
    let username = cleanUsername(profile.username || "");

    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      username = await claimUniqueUsername(profile.name || "user", uid);

    } else {
      const claimed = await claimUsername(username, uid);

      if (!claimed) {
        username = await claimUniqueUsername(profile.name || "user", uid);
      }
    }

    profile = {
      name: profile.name || "User",
      username,
      photo: profile.photo || ""
    };

    await set(profileRef, profile);
  }

  currentProfile = profile;
  updateProfileUI(profile);
}

// UPDATE PROFILE UI
function updateProfileUI(profile) {
  const name = profile.name || "User";
  const username = profile.username || "username";

  myProfile.querySelector("b").textContent = name;
  myProfile.querySelector("p").textContent = "@" + username;

  document.querySelector(".profile-card h2").textContent = name;
  document.querySelector(".profile-card > p").textContent = "@" + username;

  const details = document.querySelectorAll(".profile-detail b");

  if (details[0]) details[0].textContent = name;
  if (details[1]) details[1].textContent = "@" + username;

  [myProfile.querySelector(".avatar"), profileAvatar].forEach(avatar => {
    if (!avatar) return;

    avatar.innerHTML = "";

    if (profile.photo) {
      const img = document.createElement("img");
      img.src = profile.photo;
      avatar.appendChild(img);
    } else {
      avatar.textContent = name.charAt(0).toUpperCase();
    }
  });

  editName.value = name;
  editUsername.value = username;
}

// PROFILE SUCCESS MESSAGE
const profileUpdateStatus = document.createElement("div");
profileUpdateStatus.id = "profileUpdateStatus";
profileUpdateStatus.textContent = "Profile update successful";

if (editForm) {
  editForm.insertAdjacentElement("afterend", profileUpdateStatus);
}

if (!document.getElementById("profileSuccessStyles")) {
  const style = document.createElement("style");
  style.id = "profileSuccessStyles";

  style.textContent = `
    #profileUpdateStatus {
      display: none;
      color: #22c55e;
      background: rgba(34, 197, 94, 0.10);
      border: 1px solid rgba(34, 197, 94, 0.25);
      padding: 10px 14px;
      margin-top: 12px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      text-align: center;
    }
  `;

  document.head.appendChild(style);
}

function showProfileUpdateStatus(message) {
  profileUpdateStatus.textContent = message;
  profileUpdateStatus.style.display = "block";

  clearTimeout(profileUpdateStatus.timer);

  profileUpdateStatus.timer = setTimeout(() => {
    profileUpdateStatus.style.display = "none";
  }, 4000);
}

// SAVE PROFILE
saveProfile.onclick = async () => {
  if (!currentUser) return;

  const name = editName.value.trim();
  const username = cleanUsername(editUsername.value);

  profileUpdateStatus.style.display = "none";

  if (!name || !username) {
    alert("Enter your name and username.");
    return;
  }

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    alert("Username must be 3-20 characters. Use letters, numbers or _ only.");
    return;
  }

  saveProfile.disabled = true;
  saveProfile.textContent = "Saving...";

  try {
    const uid = currentUser.uid;
    const profileRef = ref(db, `users/${uid}/profile`);

    const snapshot = await get(profileRef);
    const oldProfile = snapshot.val() || {};
    const oldUsername = cleanUsername(oldProfile.username || "");

    const claimed = await claimUsername(username, uid);

    if (!claimed) {
      alert("This username is already taken.");
      return;
    }

    const profile = {
      name,
      username,
      photo: oldProfile.photo || ""
    };

    await set(profileRef, profile);

    if (oldUsername && oldUsername !== username) {
      await releaseUsername(oldUsername, uid);
    }

    currentProfile = profile;
    updateProfileUI(profile);

    editForm.style.display = "none";

    showProfileUpdateStatus("Profile update successful");

  } catch (error) {
    console.error("Profile Update Error:", error);
    alert("Could not save profile: " + error.message);

  } finally {
    saveProfile.disabled = false;
    saveProfile.textContent = "Save Changes";
  }
};

// EDIT PROFILE
editProfileBtn.onclick = () => {
  profileUpdateStatus.style.display = "none";
  editForm.style.display = "flex";
  editName.focus();
};

cancelEdit.onclick = () => {
  editForm.style.display = "none";
};

// COMPRESS PROFILE PHOTO
async function compressProfilePhoto(file) {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = new Image();

    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(
        new Error("Could not read this image.")
      );
      image.src = imageUrl;
    });

    let width = image.naturalWidth;
    let height = image.naturalHeight;

    const maxDimension = 900;

    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(
        maxDimension / width,
        maxDimension / height
      );

      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Image compression is not supported.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    let quality = 0.85;
    let result = null;

    for (let i = 0; i < 8; i++) {
      result = await new Promise(resolve => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });

      if (!result) {
        throw new Error("Image compression failed.");
      }

      if (result.size <= 450 * 1024) break;

      quality -= 0.1;
    }

    if (!result || result.size > 450 * 1024) {
      throw new Error("Image is too large to compress.");
    }

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(
        new Error("Could not read compressed image.")
      );

      reader.readAsDataURL(result);
    });

  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

// PROFILE PHOTO
changePhotoBtn.onclick = () => photoInput.click();

photoInput.onchange = async () => {
  const file = photoInput.files[0];

  if (!file || !currentUser) return;

  try {
    if (!file.type.startsWith("image/")) {
      throw new Error("Please select an image.");
    }

    changePhotoBtn.disabled = true;
    changePhotoBtn.textContent = "Compressing...";
    profileUpdateStatus.style.display = "none";

    const compressedPhoto = await compressProfilePhoto(file);

    const profileRef = ref(db, `users/${currentUser.uid}/profile`);
    const snapshot = await get(profileRef);
    const profile = snapshot.val();

    if (!profile) {
      throw new Error("Profile not found. Please reload the app.");
    }

    profile.photo = compressedPhoto;

    await set(profileRef, profile);

    currentProfile = profile;
    updateProfileUI(profile);

    showProfileUpdateStatus("Profile update successful");

  } catch (error) {
    console.error("Photo Update Error:", error);
    alert("Photo could not be saved: " + error.message);

  } finally {
    photoInput.value = "";
    changePhotoBtn.disabled = false;
    changePhotoBtn.textContent = "Change Profile Photo";
  }
};

// PROFILE MODAL
myProfile.onclick = () => {
  profileModal.classList.add("show");
};

closeProfile.onclick = () => {
  profileModal.classList.remove("show");
};

profileModal.onclick = event => {
  if (event.target === profileModal) {
    profileModal.classList.remove("show");
  }
};

// LIVE PROFILE LISTENER
function watchChatProfile(item) {
  if (!item) return;

  const uid = item.dataset.peerUid;
  if (!uid) return;

  if (profileListeners.has(uid)) return;

  const profileRef = ref(db, `users/${uid}/profile`);

  const stop = onValue(profileRef, snapshot => {
    if (!snapshot.exists()) return;

    const profile = snapshot.val();

    const name = profile.name || "User";
    const username = profile.username || "";
    const photo = profile.photo || "";

    item.dataset.name = name;
    item.dataset.username = username;
    item.dataset.photo = photo;

    const title = item.querySelector(".chat-info b");
    if (title) title.textContent = name;

    const avatar = item.querySelector(".avatar");

    if (avatar) {
      avatar.innerHTML = "";

      if (photo) {
        const img = document.createElement("img");
        img.src = photo;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        avatar.appendChild(img);
      } else {
        avatar.textContent = name.charAt(0).toUpperCase();
      }
    }

    // Update open chat header immediately
    if (
      activeRoom?.type === "private" &&
      activeRoom.id === item.dataset.roomId
    ) {
      chatHeaderName.textContent = name;
      chatHeaderAvatar.innerHTML = "";

      if (photo) {
        const img = document.createElement("img");
        img.src = photo;
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        chatHeaderAvatar.appendChild(img);
      } else {
        chatHeaderAvatar.textContent = name.charAt(0).toUpperCase();
      }
    }
  });

  profileListeners.set(uid, stop);
}

// CHAT LIST HELPERS
function addChatToList(roomId, name, username, photo, type, peerUid) {
  const existing = Array.from(chatList.children)
    .find(item => item.dataset.roomId === roomId);

  if (existing) return existing;

  const item = document.createElement("div");
  item.className = "chat";

  item.dataset.roomId = roomId;
  item.dataset.roomType = type;
  item.dataset.peerUid = peerUid || "";
  item.dataset.name = name || "User";
  item.dataset.username = username || "";
  item.dataset.photo = photo || "";

  item.dataset.isTyping = "false";
  item.dataset.isOnline = "false";
  item.dataset.lastMessage = "";
  item.dataset.lastSeen = "";

  const avatar = document.createElement("div");
  avatar.className = "avatar blue";

  if (photo) {
    const img = document.createElement("img");
    img.src = photo;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    avatar.appendChild(img);
  } else {
    avatar.textContent = (name || "U").charAt(0).toUpperCase();
  }

  const info = document.createElement("div");
  info.className = "chat-info";

  const title = document.createElement("b");
  title.textContent = name || "User";

  const subtitle = document.createElement("p");
  subtitle.className = "last-message";

  subtitle.textContent = type === "general"
    ? "Start chatting..."
    : "@" + (username || "user");

  const typing = document.createElement("small");
  typing.className = "chat-typing";

  const unreadBadge = document.createElement("span");
  unreadBadge.className = "unread-badge";
  unreadBadge.textContent = "0";
  unreadBadge.style.display = "none";

  info.append(title, subtitle, typing);
  item.append(avatar, info, unreadBadge);

  chatList.appendChild(item);

  return item;
}

// CHAT PREVIEW
function renderChatPreview(item) {
  if (!item) return;

  const preview = item.querySelector(".last-message");
  if (!preview) return;

  if (item.dataset.isTyping === "true") {
    preview.textContent = "Typing...";
    preview.classList.add("is-typing");
  } else {
    preview.textContent =
      item.dataset.lastMessage || (
        item.dataset.roomType === "general"
          ? "Start chatting..."
          : "No messages yet"
      );

    preview.classList.remove("is-typing");
  }
}

// UPDATE LAST MESSAGE
function updateLastMessage(roomId, message) {
  const chatItem = Array.from(chatList.children)
    .find(item => item.dataset.roomId === roomId);

  if (!chatItem) return;

  chatItem.dataset.lastMessage = message || "No messages yet";
  renderChatPreview(chatItem);
}

// REFRESH LAST MESSAGE AFTER DELETE
async function refreshLastMessage(roomId, roomPath, roomType) {
  try {
    const snapshot = await get(ref(db, roomPath));

    if (!snapshot.exists()) {
      updateLastMessage(
        roomId,
        roomType === "general"
          ? "Start chatting..."
          : "No messages yet"
      );
      return;
    }

    const messages = Object.values(snapshot.val());

    messages.sort((a, b) => {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    updateLastMessage(
      roomId,
      messages[0]?.text || "No messages yet"
    );

  } catch (error) {
    console.error("Refresh Last Message Error:", error);
  }
}

// LOAD SAVED PRIVATE CHATS — REALTIME
function loadUserChats() {
  if (!currentUser) return;

// CLEANUP OLD CHAT LISTENERS
[
  chatPresenceListeners,
  chatTypingListeners,
  chatMessageListeners,
  unreadListeners
].forEach(listenerMap => {
  listenerMap.forEach(stop => stop());
  listenerMap.clear();
});

if (stopGeneralPreview) {
  stopGeneralPreview();
  stopGeneralPreview = null;
}

chatList.innerHTML = "";

  // General Chat
  const generalItem = addChatToList(
    "general",
    "General Chat",
    "",
    "",
    "general",
    ""
  );

  // General Chat live preview
  if (stopGeneralPreview) {
    stopGeneralPreview();
  }

  const generalMessagesRef = ref(db, "rooms/general/messages");

  stopGeneralPreview = onValue(generalMessagesRef, snapshot => {
    if (!snapshot.exists()) {
      generalItem.dataset.lastMessage = "Start chatting...";
      renderChatPreview(generalItem);
      return;
    }

    const messages = Object.values(snapshot.val());

    messages.sort((a, b) =>
      (b.createdAt || 0) - (a.createdAt || 0)
    );

    generalItem.dataset.lastMessage =
      messages[0]?.text || "Start chatting...";

    renderChatPreview(generalItem);
  });

  const chatsRef = ref(db, `userChats/${currentUser.uid}`);

  if (stopUserChats) {
    stopUserChats();
    stopUserChats = null;
  }

  const stops = [];

  function attachPrivateChat(roomId, chat) {
    if (
      roomId === "activeRoom" ||
      !chat ||
      typeof chat !== "object" ||
      !chat.peerUid
    ) return;

    const item = addChatToList(
      roomId,
      chat.name || "User",
      chat.username || "",
      chat.photo || "",
      "private",
      chat.peerUid
    );

    // Update existing chat item data
    item.dataset.name = chat.name || "User";
    item.dataset.username = chat.username || "";
    item.dataset.photo = chat.photo || "";
    item.dataset.peerUid = chat.peerUid;

    const title = item.querySelector(".chat-info b");
    if (title) title.textContent = chat.name || "User";

    const avatar = item.querySelector(".avatar");

    if (avatar) {
      avatar.innerHTML = "";

      if (chat.photo) {
        const img = document.createElement("img");
        img.src = chat.photo;
        avatar.appendChild(img);
      } else {
        avatar.textContent =
          (chat.name || "U").charAt(0).toUpperCase();
      }
    }

    // Live profile
    watchChatProfile(item);

    // Live unread count
    if (!unreadListeners.has(roomId)) {
      const unreadRef = ref(
        db,
        `userChats/${currentUser.uid}/${roomId}/unreadCount`
      );

      const stopUnread = onValue(unreadRef, snapshot => {
        const count = Number(snapshot.val()) || 0;
        const badge = item.querySelector(".unread-badge");

        if (!badge) return;

        badge.textContent = count > 99 ? "99+" : count;
        badge.style.display = count > 0 ? "flex" : "none";
      });

      unreadListeners.set(roomId, stopUnread);
    }

    // Attach listeners for newly added chats too
    listenAllChatPresence();
    listenAllChatTyping();
  }

  const stopAdded = onChildAdded(chatsRef, snapshot => {
    attachPrivateChat(snapshot.key, snapshot.val());
  });

  const stopChanged = onChildChanged(chatsRef, snapshot => {
    attachPrivateChat(snapshot.key, snapshot.val());
  });

  const stopRemoved = onChildRemoved(chatsRef, snapshot => {
    const roomId = snapshot.key;

    if (roomId === "activeRoom") return;

    const item = Array.from(chatList.children).find(
      child => child.dataset.roomId === roomId
    );

    if (item) item.remove();

    cleanupDateSeparators();

    if (unreadListeners.has(roomId)) {
      unreadListeners.get(roomId)();
      unreadListeners.delete(roomId);
    }

    if (chatTypingListeners.has(roomId)) {
      chatTypingListeners.get(roomId)();
      chatTypingListeners.delete(roomId);
    }

    if (chatMessageListeners.has(roomId)) {
      chatMessageListeners.get(roomId)();
      chatMessageListeners.delete(roomId);
    }

    if (activeRoom?.id === roomId) {
      activeRoom = null;
      messagesArea.innerHTML = "";
      chatHeaderName.textContent = "PankieChat";
      chatHeaderAvatar.className = "avatar blue";
      chatHeaderAvatar.textContent = "P";
      setActiveChat("");
    }
  });

  stops.push(stopAdded, stopChanged, stopRemoved);

  stopUserChats = () => {
    stops.forEach(stop => stop());
  };
}

// LISTEN ALL CHAT PRESENCE
function listenAllChatPresence() {
  chatList.querySelectorAll(".chat").forEach(item => {
    const uid = item.dataset.peerUid;
    if (!uid) return;

    if (chatPresenceListeners.has(uid)) return;

    const presenceRef = ref(db, `presence/${uid}`);

    const stop = onValue(presenceRef, snapshot => {
      const data = snapshot.val();
      console.log("MEDIA DEBUG:", data.media);
      const avatar = item.querySelector(".avatar");

      if (avatar) {
        avatar.classList.toggle(
          "is-online",
          data?.state === "online"
        );
      }
    });

    chatPresenceListeners.set(uid, stop);
  });
}

// LISTEN ALL CHAT TYPING + LAST MESSAGE
function listenAllChatTyping() {
  chatList.querySelectorAll(".chat").forEach(item => {
    const uid = item.dataset.peerUid;
    const roomId = item.dataset.roomId;

    if (!uid || !roomId || item.dataset.roomType !== "private") {
      return;
    }

    if (!chatTypingListeners.has(roomId)) {
      const typingRef = ref(
        db,
        `privateChats/${roomId}/typing/${uid}`
      );

      const stop = onValue(typingRef, snapshot => {
        item.dataset.isTyping =
          snapshot.val() === true ? "true" : "false";

        renderChatPreview(item);

        const chatTyping = item.querySelector(".chat-typing");

        if (chatTyping) {
          chatTyping.textContent =
            item.dataset.isTyping === "true" ? "Typing..." : "";
        }
      });

      chatTypingListeners.set(roomId, stop);
    }

    if (!chatMessageListeners.has(roomId)) {
      const messagesRef = ref(
        db,
        `privateChats/${roomId}/messages`
      );

      const stop = onValue(messagesRef, snapshot => {
        if (!snapshot.exists()) {
          item.dataset.lastMessage = "No messages yet";
          renderChatPreview(item);
          return;
        }

        const messages = Object.values(snapshot.val());

        messages.sort((a, b) => {
          return (b.createdAt || 0) - (a.createdAt || 0);
        });

        item.dataset.lastMessage =
          messages[0]?.text || "No messages yet";

        renderChatPreview(item);
      });

      chatMessageListeners.set(roomId, stop);
    }
  });
}

// ACTIVE CHAT STYLE
function setActiveChat(roomId) {
  chatList.querySelectorAll(".chat").forEach(item => {
    item.classList.toggle(
      "active",
      item.dataset.roomId === roomId
    );
  });

  if (window.innerWidth <= 768 && roomId) {
    appScreen.classList.add("mobile-chat-open");
  }
}

// FORMAT LAST SEEN
function formatLastSeen(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();

  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();

  if (isToday) {
    return `Last seen today at ${time}`;
  }

  if (isYesterday) {
    return `Last seen yesterday at ${time}`;
  }

  const dateText = date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });

  return `Last seen on ${dateText} at ${time}`;
}

// LISTEN PEER PRESENCE
function listenPeerPresence(uid) {
  if (stopPeerPresence) {
    stopPeerPresence();
    stopPeerPresence = null;
  }

  if (!uid) return;

  const presenceRef = ref(db, `presence/${uid}`);

  stopPeerPresence = onValue(presenceRef, snapshot => {
    const data = snapshot.val();
    const status = document.querySelector("#chatStatus");

    if (!status) return;

    if (data?.state === "online") {
      status.textContent = "Online";
    } else if (data?.lastChanged) {
      status.textContent = formatLastSeen(data.lastChanged);
    } else {
      status.textContent = "Last seen unavailable";
    }

    status.classList.toggle("online", data?.state === "online");

    const chatItem = Array.from(chatList.children).find(
      item => item.dataset.peerUid === uid
    );

    if (chatItem) {
      chatItem.querySelector(".avatar")?.classList.toggle(
        "is-online",
        data?.state === "online"
      );
    }

    chatHeaderAvatar.classList.toggle(
      "is-online",
      data?.state === "online"
    );
  });
}

// LIVE TYPING INDICATOR STYLE
if (!document.getElementById("liveTypingStyles")) {
  const style = document.createElement("style");
  style.id = "liveTypingStyles";

  style.textContent = `
    .live-typing-indicator {
      display: flex;
      align-items: center;
      gap: 9px;
      width: fit-content;
      margin: 7px 12px 10px;
      padding: 9px 13px;
      border-radius: 15px;
      background: rgba(120, 140, 170, 0.13);
      color: #8da5c7;
      font-size: 12px;
      animation: typingFade .2s ease;
    }

    .typing-dots {
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .typing-dots i {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #65a5ff;
      animation: typingBounce .8s infinite ease-in-out;
    }

    .typing-dots i:nth-child(2) {
      animation-delay: .15s;
    }

    .typing-dots i:nth-child(3) {
      animation-delay: .3s;
    }

    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); opacity: .5; }
      30% { transform: translateY(-4px); opacity: 1; }
    }

    @keyframes typingFade {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  document.head.appendChild(style);
}

// LISTEN PEER TYPING
function listenPeerTyping(uid) {
  if (stopTyping) {
    stopTyping();
    stopTyping = null;
  }

  const oldIndicator = messagesArea.querySelector(".live-typing-indicator");
  if (oldIndicator) oldIndicator.remove();

  const typingStatus = document.querySelector("#typingStatus");
  if (typingStatus) typingStatus.textContent = "";

  if (!uid || !activeRoom || activeRoom.type !== "private") return;

  const typingRef = ref(
    db,
    `privateChats/${activeRoom.id}/typing/${uid}`
  );

  stopTyping = onValue(typingRef, snapshot => {
    const isTyping = snapshot.val() === true;

    if (typingStatus) typingStatus.textContent = "";

    const chatItem = Array.from(chatList.children).find(
      item => item.dataset.peerUid === uid
    );

    if (chatItem) {
      chatItem.dataset.isTyping = isTyping ? "true" : "false";
      renderChatPreview(chatItem);

      const chatTyping = chatItem.querySelector(".chat-typing");

      if (chatTyping) {
        chatTyping.textContent = isTyping ? "Typing..." : "";
      }
    }

    let indicator = messagesArea.querySelector(".live-typing-indicator");

    if (isTyping) {
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.className = "live-typing-indicator";
        indicator.innerHTML = `
          <span class="typing-dots">
            <i></i><i></i><i></i>
          </span>
          <span>Typing...</span>
        `;
      }

      messagesArea.appendChild(indicator);
      messagesArea.scrollTop = messagesArea.scrollHeight;

    } else if (indicator) {
      indicator.remove();
    }
  });
}

// OPEN GENERAL CHAT
function openGeneralChat() {
  setTyping(false).catch(console.error);

  activeRoom = {
    type: "general",
    id: "general",
    path: "rooms/general/messages"
  };

  if (currentUser) {
    const activeChatRef = ref(
      db,
      `userChats/${currentUser.uid}/activeRoom`
    );

    onDisconnect(activeChatRef).remove()
      .then(() => set(activeChatRef, "general"))
      .catch(console.error);
  }

  chatHeaderName.textContent = "General Chat";
  chatHeaderAvatar.className = "avatar blue";
  chatHeaderAvatar.innerHTML = "G";

  if (stopPeerPresence) {
    stopPeerPresence();
    stopPeerPresence = null;
  }

  if (stopTyping) {
    stopTyping();
    stopTyping = null;
  }

  document.querySelector("#typingStatus").textContent = "";
  document.querySelector("#chatStatus").textContent = "";

  setActiveChat("general");
  listenMessages();
}

// OPEN PRIVATE CHAT - FAST VERSION
async function openPrivateChat(peerUid, peerProfile) {
  if (!currentUser || !peerUid || !peerProfile) return;

  setTyping(false).catch(console.error);

  const members = [currentUser.uid, peerUid].sort();
  const roomId = members.join("_");
  const roomPath = `privateChats/${roomId}/messages`;

  const myProfileData = currentProfile || {
    name: "User",
    username: "user",
    photo: ""
  };

  activeRoom = {
    type: "private",
    id: roomId,
    path: roomPath
  };

  const chatItem = addChatToList(
    roomId,
    peerProfile.name,
    peerProfile.username,
    peerProfile.photo,
    "private",
    peerUid
  );

  watchChatProfile(chatItem);

  chatHeaderName.textContent = peerProfile.name || "User";
  chatHeaderAvatar.className = "avatar blue";
  chatHeaderAvatar.innerHTML = "";

  if (peerProfile.photo) {
    const img = document.createElement("img");
    img.src = peerProfile.photo;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    chatHeaderAvatar.appendChild(img);
  } else {
    chatHeaderAvatar.textContent =
      (peerProfile.name || "U").charAt(0).toUpperCase();
  }

  document.querySelector("#chatStatus").textContent = "";
  document.querySelector("#typingStatus").textContent = "";

  setActiveChat(roomId);

  searchResults.innerHTML = "";
  userSearch.value = "";

  listenMessages();
  listenPeerPresence(peerUid);
  listenPeerTyping(peerUid);

  messageInput.focus();

  set(
    ref(db, `userChats/${currentUser.uid}/${roomId}/unreadCount`),
    0
  ).catch(console.error);

  const saveChatInfo = async () => {
    try {
      await Promise.all([
        update(
          ref(db, `userChats/${currentUser.uid}/${roomId}`),
          {
            peerUid,
            name: peerProfile.name || "User",
            username: peerProfile.username || "",
            photo: peerProfile.photo || ""
          }
        ),

        update(
          ref(db, `userChats/${peerUid}/${roomId}`),
          {
            peerUid: currentUser.uid,
            name: myProfileData.name || "User",
            username: myProfileData.username || "",
            photo: myProfileData.photo || ""
          }
        )
      ]);

      const myTypingRef = ref(
        db,
        `privateChats/${roomId}/typing/${currentUser.uid}`
      );

      const activeChatRef = ref(
        db,
        `userChats/${currentUser.uid}/activeRoom`
      );

      await Promise.all([
        onDisconnect(myTypingRef).remove(),
        onDisconnect(activeChatRef).remove()
      ]);

      await set(activeChatRef, roomId);

    } catch (error) {
      console.error("Save Chat Info Error:", error);
    }
  };

  saveChatInfo();
}

// CHAT LIST CLICK
chatList.addEventListener("click", event => {
  const item = event.target.closest(".chat");
  if (!item) return;

  if (item.dataset.roomType === "general") {
    openGeneralChat();
    return;
  }

  const peerUid = item.dataset.peerUid;
  if (!peerUid) return;

  openPrivateChat(peerUid, {
    name: item.dataset.name,
    username: item.dataset.username,
    photo: item.dataset.photo
  });
});

// USER SEARCH
userSearch.addEventListener("input", async () => {
  const requestId = ++searchRequest;
  const username = cleanUsername(userSearch.value);

  searchResults.innerHTML = "";

  if (!currentUser || username.length < 3) return;

  try {
    const usernameRef = ref(db, `usernames/${username}`);
    const usernameSnapshot = await get(usernameRef);

    if (requestId !== searchRequest) return;

    if (!usernameSnapshot.exists()) {
      searchResults.textContent = "User not found.";
      return;
    }

    const uid = usernameSnapshot.val();

    if (uid === currentUser.uid) {
      searchResults.textContent = "This is your account.";
      return;
    }

    const profileRef = ref(db, `users/${uid}/profile`);
    const profileSnapshot = await get(profileRef);

    if (requestId !== searchRequest) return;

    if (!profileSnapshot.exists()) {
      searchResults.textContent = "Profile not found.";
      return;
    }

    const profile = profileSnapshot.val();

    const result = document.createElement("div");
    result.className = "search-user";

    const avatar = document.createElement("div");
    avatar.className = "avatar blue";

    if (profile.photo) {
      const img = document.createElement("img");
      img.src = profile.photo;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      avatar.appendChild(img);
    } else {
      avatar.textContent =
        (profile.name || "U").charAt(0).toUpperCase();
    }

    const searchPresenceRef = ref(db, `presence/${uid}`);

    const stopSearchPresence = onValue(searchPresenceRef, snapshot => {
      const data = snapshot.val();

      avatar.classList.toggle(
        "is-online",
        data?.state === "online"
      );
    });

    const info = document.createElement("div");

    const name = document.createElement("b");
    name.textContent = profile.name || "User";

    const tag = document.createElement("p");
    tag.textContent = "@" + (profile.username || username);

    info.append(name, tag);
    result.append(avatar, info);

    result.onclick = () => {
      stopSearchPresence();

      openPrivateChat(uid, profile);

      searchOverlay.classList.remove("active");
      userSearch.value = "";
      searchResults.innerHTML = "";
    };

    searchResults.appendChild(result);

  } catch (error) {
    if (requestId !== searchRequest) return;

    console.error("Search Error:", error);
    searchResults.textContent = "Search failed.";
  }
});

// MESSAGE REACTIONS DISPLAY
function renderMessageReactions(container, reactions) {
  container.replaceChildren();

  const counts = {};

  Object.values(reactions || {}).forEach(emoji => {
    if (typeof emoji === "string" && emoji.trim()) {
      counts[emoji] = (counts[emoji] || 0) + 1;
    }
  });

  Object.entries(counts).forEach(([emoji, count]) => {
    const chip = document.createElement("span");
    chip.className = "reaction-chip";
    chip.textContent = `${emoji} ${count}`;
    container.appendChild(chip);
  });
}

// POSITION MESSAGE MENU
function positionMessageMenu(messageElement) {
  if (!messageActionMenu) return;

  messageActionMenu.style.display = "block";

  const rect = messageElement.getBoundingClientRect();
  const menuWidth = messageActionMenu.offsetWidth;
  const menuHeight = messageActionMenu.offsetHeight;

  const left = Math.max(
    10,
    Math.min(rect.left, window.innerWidth - menuWidth - 10)
  );

  let top = rect.bottom + 6;

  if (top + menuHeight > window.innerHeight - 10) {
    top = rect.top - menuHeight - 6;
  }

  top = Math.max(
    10,
    Math.min(top, window.innerHeight - menuHeight - 10)
  );

  messageActionMenu.style.left = `${left}px`;
  messageActionMenu.style.top = `${top}px`;
}


function getMessageDateLabel(timestamp) {
  const date = new Date(timestamp || Date.now());
  const today = new Date();
  const yesterday = new Date();

  today.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const messageDate = new Date(date);
  messageDate.setHours(0, 0, 0, 0);

  if (messageDate.getTime() === today.getTime()) {
    return "TODAY";
  }

  if (messageDate.getTime() === yesterday.getTime()) {
    return "YESTERDAY";
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function cleanupDateSeparators() {
  messagesArea.querySelectorAll(".date-separator").forEach(separator => {
    const date = separator.dataset.date;

    const hasMessage = Array.from(
      messagesArea.querySelectorAll(".message")
    ).some(message => {
      return getMessageDateLabel(
        Number(message.dataset.createdAt)
      ) === date;
    });

    if (!hasMessage) {
      separator.remove();
    }
  });
}

// MESSAGE LISTENER
function listenMessages() {
  if (!activeRoom) return;

  if (stopMessages) {
    stopMessages();
    stopMessages = null;
  }

  closeMessageMenu();

  messagesArea.querySelectorAll(
  ".message, .date-separator, .live-typing-indicator"
).forEach(element => element.remove());
  const roomPath = activeRoom.path;
  const roomId = activeRoom.id;
  const roomType = activeRoom.type;
  const messagesRef = ref(db, roomPath);

  const stopAdded = onChildAdded(messagesRef, snapshot => {
    const data = snapshot.val();

    if (!data || typeof data.text !== "string" || !currentUser) {
      return;
    }

    const item = document.createElement("div");
    item.classList.add("message");
    item.dataset.messageId = snapshot.key;

    const isSent = data.uid === currentUser.uid;
    item.classList.add(isSent ? "sent" : "received");

    if (data.replyTo) {
      const replyBox = document.createElement("div");
      replyBox.className = "reply-quote";

      const replySender = document.createElement("b");
      replySender.textContent = data.replyTo.senderName || "User";

      const replyContent = document.createElement("p");
      replyContent.textContent = data.replyTo.text || "";

      replyBox.append(replySender, replyContent);
      item.appendChild(replyBox);
    }

    
if (data.media?.key) {
  const mediaBox = document.createElement("div");
  mediaBox.className = "message-media";

  
const downloadMedia = async () => {
  const token = await currentUser.getIdToken();

  const response = await fetch("/.netlify/functions/b2-download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      key: data.media.key,
      roomType,
      roomId,
      messageId: snapshot.key
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Download failed");
  }

  const blob = await response.blob();

  return URL.createObjectURL(blob);
};

  const type = data.media.contentType || "";

  if (type.startsWith("image/")) {
  const image = document.createElement("img");
  image.alt = data.media.name || "Shared image";
  image.loading = "lazy";
  image.className = "chat-media-image";

  const loading = document.createElement("div");
  loading.className = "media-loading";
  loading.textContent = "Loading image...";

  mediaBox.appendChild(loading);
  mediaBox.appendChild(image);

  downloadMedia()
    .then(url => {
      image.src = url;

      image.onload = () => {
        loading.remove();
      };

      image.onerror = () => {
        loading.textContent = "Image could not be loaded";
        URL.revokeObjectURL(url);
      };
    })
    .catch(error => {
      console.error("Image Display Error:", error);
      loading.textContent = "Image could not be loaded";
    });
  } else if (type.startsWith("video/")) {
    const video = document.createElement("video");
    video.controls = true;
    video.preload = "metadata";
    video.className = "chat-media-video";

    downloadMedia()
      .then(url => {
        video.src = url;
      })
      .catch(error => {
        console.error("Video Display Error:", error);
      });

  } else {
    const fileButton = document.createElement("button");
    fileButton.type = "button";
    fileButton.className = "chat-file-button";
    fileButton.textContent = "📎 " + (data.media.name || data.text);

    fileButton.onclick = async () => {
      try {
        fileButton.disabled = true;
        const url = await downloadMedia();
        window.open(url, "_blank", "noopener");
      } catch (error) {
        alert("Could not open file: " + error.message);
      } finally {
        fileButton.disabled = false;
      }
    };

    mediaBox.appendChild(fileButton);
  }

  item.appendChild(mediaBox);

} else {
  const messageText = document.createElement("span");
  messageText.textContent = data.text;
  item.appendChild(messageText);
}

    const time = document.createElement("small");
    time.textContent = new Date(data.createdAt || Date.now())
      .toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

    item.appendChild(time);

    if (isSent) {
      const status = document.createElement("small");
      status.className = "message-status";
      status.textContent = data.status === "seen" ? "✓✓" : "✓";
      status.classList.toggle("seen", data.status === "seen");
      item.appendChild(status);
    }

    const reactions = document.createElement("div");
    reactions.className = "message-reactions";
    renderMessageReactions(reactions, data.reactions);
    item.appendChild(reactions);

    item.addEventListener("click", event => {
      event.stopPropagation();

      selectedMessage = {
        id: snapshot.key,
        text: data.text,
        uid: data.uid,
        senderName: data.senderName || "User",
        roomPath,
        roomId
      };

      positionMessageMenu(item);
    });

    
    const dateLabel = getMessageDateLabel(data.createdAt);

    const existingSeparator = Array.from(
      messagesArea.querySelectorAll(".date-separator")
    ).find(separator => separator.dataset.date === dateLabel);

    if (!existingSeparator) {
      const separator = document.createElement("div");
      separator.className = "date-separator";
      separator.dataset.date = dateLabel;
      separator.textContent = dateLabel;

      messagesArea.appendChild(separator);
    }

    messagesArea.appendChild(item);

    // Keep typing indicator at the very bottom
    const typingIndicator = messagesArea.querySelector(
      ".live-typing-indicator"
    );

    if (typingIndicator) {
      messagesArea.appendChild(typingIndicator);
    }

    updateLastMessage(roomId, data.text);

    if (!isSent && roomType === "private") {
      update(
        ref(db, `${roomPath}/${snapshot.key}`),
        { status: "seen" }
      ).catch(console.error);

      set(
        ref(db, `userChats/${currentUser.uid}/${roomId}/unreadCount`),
        0
      ).catch(console.error);
    }

    messagesArea.scrollTop = messagesArea.scrollHeight;
  });

  const stopChanged = onChildChanged(messagesRef, snapshot => {
    const data = snapshot.val();

    const item = messagesArea.querySelector(
      `[data-message-id="${snapshot.key}"]`
    );

    if (!item || !data) return;

    const status = item.querySelector(".message-status");

    if (status && data.uid === currentUser?.uid) {
      status.textContent = data.status === "seen" ? "✓✓" : "✓";
      status.classList.toggle("seen", data.status === "seen");
    }

    const reactionBox = item.querySelector(".message-reactions");

    if (reactionBox) {
      renderMessageReactions(reactionBox, data.reactions);
    }
  });

  const stopRemoved = onChildRemoved(messagesRef, snapshot => {
    const item = messagesArea.querySelector(
      `[data-message-id="${snapshot.key}"]`
    );

    if (item) item.remove();

// Remove empty date separators
messagesArea.querySelectorAll(".date-separator").forEach(separator => {
  const next = separator.nextElementSibling;

  if (!next || !next.classList.contains("message")) {
    separator.remove();
  }
});

refreshLastMessage(roomId, roomPath, roomType);
  });

  stopMessages = () => {
    stopAdded();
    stopChanged();
    stopRemoved();
  };

  if (stopPinnedMessage) {
    stopPinnedMessage();
    stopPinnedMessage = null;
  }

  const pinnedRef = ref(db, getPinnedMessagePath());

  stopPinnedMessage = onValue(pinnedRef, snapshot => {
    const bar = document.getElementById("pinnedMessageBar");
    const text = document.getElementById("pinnedMessageText");

    if (!bar || !text) return;

    const pinned = snapshot.val();

    if (!pinned) {
      bar.style.display = "none";
      return;
    }

    text.textContent =
      `${pinned.senderName || "User"}: ${pinned.text || ""}`;

    bar.style.display = "flex";

    bar.onclick = event => {
      if (event.target.closest("#unpinMessageBtn")) return;

      const message = messagesArea.querySelector(
        `[data-message-id="${pinned.messageId}"]`
      );

      if (message) {
        message.scrollIntoView({
          behavior: "smooth",
          block: "center"
        });

        message.classList.add("pinned-highlight");

        setTimeout(() => {
          message.classList.remove("pinned-highlight");
        }, 1800);
      }
    };
  });
}

// SEND MESSAGE
async function sendMessage() {
  if (!activeRoom || !currentUser) return;

  const text = messageInput.value.trim();
  if (!text) return;

  const room = { ...activeRoom };
  const sender = currentUser;
  const peerProfileData = currentProfile;

  const replyData = replyingTo
    ? {
        messageId: replyingTo.id,
        text: replyingTo.text,
        senderName: replyingTo.senderName
      }
    : null;

  // Clear input immediately
  messageInput.value = "";
  clearTimeout(typingTimer);
  replyingTo = null;

  document.getElementById("replyPreview").style.display = "none";

  setTyping(false).catch(console.error);

  try {
    const messagesRef = ref(db, room.path);
    const newMessageRef = push(messagesRef);

    const messageData = {
      text,
      uid: sender.uid,
      senderName: peerProfileData?.name || "User",
      createdAt: Date.now(),
      status: "sent"
    };

    if (replyData) {
      messageData.replyTo = replyData;
    }

    await set(newMessageRef, messageData);

    updateLastMessage(room.id, text);

    if (room.type === "private") {
      const chatItem = Array.from(chatList.children)
        .find(item => item.dataset.roomId === room.id);

      const peerUid = chatItem?.dataset.peerUid;

      if (peerUid) {
        const peerActiveRoomRef = ref(
          db,
          `userChats/${peerUid}/activeRoom`
        );

        const unreadRef = ref(
          db,
          `userChats/${peerUid}/${room.id}/unreadCount`
        );

        get(peerActiveRoomRef)
          .then(snapshot => {
            if (snapshot.val() !== room.id) {
              return runTransaction(unreadRef, count => {
                return (Number(count) || 0) + 1;
              });
            }
          })
          .catch(console.error);
      }
    }

  } catch (error) {
    console.error("Send Error:", error);
    alert("Message could not be sent: " + error.message);
  }
}

sendButton.onclick = sendMessage;

// ATTACHMENT POPUP
const attachButton = document.getElementById("attachButton");
const attachmentPopup = document.getElementById("attachmentPopup");

attachButton.onclick = () => {
  if (!activeRoom || !currentUser) return;
  attachmentPopup.classList.toggle("active");
};

// Close popup when clicking outside
document.addEventListener("click", (event) => {
  if (
    !attachmentPopup.contains(event.target) &&
    !attachButton.contains(event.target)
  ) {
    attachmentPopup.classList.remove("active");
  }
});


// PHOTO & VIDEO PICKER
const photoOption = document.getElementById("photoOption");
const mediaInput = document.getElementById("mediaInput");

photoOption.onclick = () => {
  attachmentPopup.classList.remove("active");
  mediaInput.click();
};



mediaInput.onchange = async () => {
  const file = mediaInput.files[0];
  if (!file) return;

  if (!activeRoom || !currentUser) {
    alert("Please open a chat first.");
    mediaInput.value = "";
    return;
  }

  if (file.size > 4 * 1024 * 1024) {
    alert("File must be 4MB or smaller.");
    mediaInput.value = "";
    return;
  }

  try {
    attachButton.disabled = true;
    attachButton.textContent = "…";

    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        resolve(reader.result.split(",")[1]);
      };

      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const token = await currentUser.getIdToken();

    const response = await fetch("/.netlify/functions/b2-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type,
        fileData: base64,
        roomType: activeRoom.type,
        roomId: activeRoom.id
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Upload failed");
    }

    updateLastMessage(activeRoom.id, file.name);

    attachmentPopup.classList.remove("active");

    console.log("Media message sent:", result.messageId);

  } catch (error) {
    console.error("Media Upload Error:", error);
    alert("Upload failed: " + error.message);
  } finally {
    attachButton.disabled = false;
    attachButton.textContent = "＋";
    mediaInput.value = "";
  }
};


// FILE PICKER
const fileOption = document.getElementById("fileOption");
const documentInput = document.getElementById("documentInput");

fileOption.onclick = () => {
  attachmentPopup.classList.remove("active");
  documentInput.click();
};

documentInput.onchange = ( ) => {
  const file = documentInput.files[0];
  if (!file) return;

  console.log("Selected file:", file.name, file.type);
};



// LOCATION PICKER
const locationOption = document.getElementById("locationOption");

locationOption.onclick = () => {
  attachmentPopup.classList.remove("active");

  if (!navigator.geolocation) {
    alert("Location is not supported by this browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      console.log("Location:", latitude, longitude);

      alert(
        "Location captured!\nLatitude: " +
        latitude +
        "\nLongitude: " +
        longitude
      );
    },
    (error) => {
      alert("Could not get location: " + error.message);
    }
  );
};


// VOICE MESSAGE
const voiceOption = document.getElementById("voiceOption");

voiceOption.onclick = async () => {
  attachmentPopup.classList.remove("active");

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("Voice recording is not supported by this browser.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    stream.getTracks().forEach(track => track.stop());

    alert("Microphone permission granted! Voice recording UI is next.");
  } catch (error) {
    alert("Microphone permission denied: " + error.message);
  }
};

// SEARCH WINDOW
const searchTrigger = document.getElementById("searchTrigger");
const searchOverlay = document.getElementById("searchOverlay");
const closeSearch = document.getElementById("closeSearch");

searchTrigger.onclick = () => {
  searchOverlay.classList.add("active");
  userSearch.focus();
};

closeSearch.onclick = () => {
  searchOverlay.classList.remove("active");
  userSearch.value = "";
  searchResults.innerHTML = "";
};

searchOverlay.onclick = event => {
  if (event.target === searchOverlay) {
    searchOverlay.classList.remove("active");
    userSearch.value = "";
    searchResults.innerHTML = "";
  }
};

// SEARCH CHATS
const chatSearch = document.getElementById("chatSearch");

chatSearch.addEventListener("input", () => {
  const keyword = chatSearch.value.toLowerCase().trim();

  document.querySelectorAll(".chat-list .chat").forEach(item => {
    const name = item.dataset.name || "";
    const username = item.dataset.username || "";

    const match =
      name.toLowerCase().includes(keyword) ||
      username.toLowerCase().includes(keyword);

    item.style.display = match ? "flex" : "none";
  });
});

// CANCEL REPLY
const cancelReply = document.getElementById("cancelReply");

cancelReply.onclick = () => {
  replyingTo = null;
  document.getElementById("replyPreview").style.display = "none";
};

// MOBILE BACK BUTTON
const mobileBackBtn = document.getElementById("mobileBackBtn");

if (mobileBackBtn) {
  mobileBackBtn.onclick = () => {
    appScreen.classList.remove("mobile-chat-open");
  };
}

// REGISTER SERVICE WORKER
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then(() => console.log("PankieChat PWA Ready"))
      .catch(error => console.error("PWA Error:", error));
  });
}

// MESSAGE REPLY ACTION
document.getElementById("replyAction").onclick = () => {
  if (!selectedMessage) return;

  replyingTo = {
    id: selectedMessage.id,
    text: selectedMessage.text,
    senderName: selectedMessage.senderName
  };

  document.getElementById("replyText").textContent =
    `${replyingTo.senderName}: ${replyingTo.text}`;

  document.getElementById("replyPreview").style.display = "flex";

  closeMessageMenu();
};

// MESSAGE COPY ACTION
const copyAction = document.getElementById("copyAction");

copyAction.onclick = async () => {
  if (!selectedMessage) return;

  try {
    await navigator.clipboard.writeText(selectedMessage.text);
    closeMessageMenu();

  } catch (error) {
    console.error("Copy Error:", error);
  }
};

// MESSAGE PIN ACTION
const pinAction = document.getElementById("pinAction");
const pinConfirmModal = document.getElementById("pinConfirmModal");
const cancelPinBtn = document.getElementById("cancelPinBtn");
const confirmPinBtn = document.getElementById("confirmPinBtn");

pinAction.onclick = () => {
  if (!selectedMessage || !activeRoom) return;

  pendingPinMessage = {
    ...selectedMessage,
    pinPath: getPinnedMessagePath()
  };

  closeMessageMenu();
  pinConfirmModal.style.display = "flex";
};

cancelPinBtn.onclick = () => {
  pinConfirmModal.style.display = "none";
  pendingPinMessage = null;
};

confirmPinBtn.onclick = async () => {
  if (!pendingPinMessage || !currentUser) return;

  const message = pendingPinMessage;
  const pinPath = message.pinPath;

  if (!pinPath) return;

  confirmPinBtn.disabled = true;

  try {
    await set(ref(db, pinPath), {
      messageId: message.id,
      text: message.text,
      uid: message.uid,
      senderName: message.senderName,
      pinnedBy: currentUser.uid,
      pinnedAt: Date.now()
    });

    pinConfirmModal.style.display = "none";
    pendingPinMessage = null;

  } catch (error) {
    console.error("Pin Error:", error);
    alert("Could not pin message: " + error.message);

  } finally {
    confirmPinBtn.disabled = false;
  }
};

// UNPIN BUTTON
const unpinMessageBtn = document.getElementById("unpinMessageBtn");

if (unpinMessageBtn) {
  unpinMessageBtn.onclick = async () => {
    const pinPath = getPinnedMessagePath();
    if (!pinPath) return;

    try {
      await remove(ref(db, pinPath));

    } catch (error) {
      console.error("Unpin Error:", error);
    }
  };
}

// MESSAGE FORWARD ACTION
document.getElementById("forwardAction").onclick = () => {
  if (!selectedMessage || !currentUser) return;

  const message = { ...selectedMessage };
  closeMessageMenu();

  document.getElementById("forwardChatModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "forwardChatModal";

  modal.innerHTML = `
    <div class="forward-box">
      <h3>Forward Message</h3>
      <p class="forward-subtitle">Choose a chat</p>
      <div class="forward-chat-list"></div>
      <div class="forward-buttons">
        <button class="forward-cancel" type="button">Cancel</button>
        <button class="forward-send" type="button" disabled>Send</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const list = modal.querySelector(".forward-chat-list");
  const sendBtn = modal.querySelector(".forward-send");
  const cancelBtn = modal.querySelector(".forward-cancel");

  let selectedChat = null;

  chatList.querySelectorAll(".chat").forEach(chat => {
    const roomId = chat.dataset.roomId;
    const roomType = chat.dataset.roomType;
    const name = chat.dataset.name || "User";
    const photo = chat.dataset.photo || "";

    const item = document.createElement("div");
    item.className = "forward-chat-item";

    const avatar = document.createElement("div");
    avatar.className = "forward-avatar";

    if (photo) {
      const img = document.createElement("img");
      img.src = photo;
      avatar.appendChild(img);
    } else {
      avatar.textContent = name.charAt(0).toUpperCase();
    }

    const chatName = document.createElement("span");
    chatName.className = "forward-chat-name";
    chatName.textContent = name;

    const check = document.createElement("span");
    check.className = "forward-check";
    check.textContent = "✓";

    item.append(avatar, chatName, check);

    item.onclick = () => {
      list.querySelectorAll(".forward-chat-item").forEach(element => {
        element.classList.remove("selected");
      });

      item.classList.add("selected");

      selectedChat = {
        id: roomId,
        type: roomType
      };

      sendBtn.disabled = false;
    };

    list.appendChild(item);
  });

  if (!list.children.length) {
    const empty = document.createElement("p");
    empty.className = "forward-empty";
    empty.textContent = "No chats available";
    list.appendChild(empty);
  }

  cancelBtn.onclick = () => modal.remove();

  sendBtn.onclick = async () => {
    if (!selectedChat) return;

    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";

    const targetPath = selectedChat.type === "general"
      ? "rooms/general/messages"
      : `privateChats/${selectedChat.id}/messages`;

    try {
      const newMessageRef = push(ref(db, targetPath));

      const forwardedData = {
        text: message.text,
        uid: currentUser.uid,
        senderName: currentProfile?.name || currentUser.email,
        createdAt: Date.now(),
        status: "sent",
        forwarded: true
      };

      await set(newMessageRef, forwardedData);

      updateLastMessage(selectedChat.id, message.text);
      modal.remove();

    } catch (error) {
      console.error("Forward Error:", error);
      alert("Forward failed: " + error.message);

      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  };
};

// FORWARD MODAL CSS
if (!document.getElementById("forwardModalStyles")) {
  const style = document.createElement("style");
  style.id = "forwardModalStyles";

  style.textContent = `
    #forwardChatModal {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
    }

    .forward-box {
      width: 100%;
      max-width: 380px;
      max-height: 80vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 20px;
      border-radius: 20px;
      background: var(--card-bg, #ffffff);
      color: var(--text-color, #111111);
      box-shadow: 0 15px 45px rgba(0,0,0,0.2);
    }

    .forward-box h3 {
      margin: 0;
      font-size: 19px;
    }

    .forward-subtitle {
      margin: 6px 0 14px;
      opacity: 0.6;
      font-size: 13px;
    }

    .forward-chat-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      min-height: 50px;
      max-height: 50vh;
    }

    .forward-chat-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px;
      border-radius: 13px;
      cursor: pointer;
      background: rgba(128,128,128,0.08);
      transition: 0.2s;
    }

    .forward-chat-item:hover {
      background: rgba(128,128,128,0.16);
    }

    .forward-chat-item.selected {
      background: rgba(55,130,255,0.15);
      outline: 1px solid #3985ff;
    }

    .forward-avatar {
      width: 42px;
      height: 42px;
      min-width: 42px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #3985ff;
      color: white;
      font-weight: bold;
    }

    .forward-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .forward-chat-name {
      flex: 1;
      font-size: 14px;
      font-weight: 600;
    }

    .forward-check {
      display: none;
      color: #3985ff;
      font-weight: bold;
    }

    .forward-chat-item.selected .forward-check {
      display: block;
    }

    .forward-empty {
      text-align: center;
      opacity: 0.6;
      padding: 20px;
    }

    .forward-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 18px;
    }

    .forward-buttons button {
      border: none;
      border-radius: 12px;
      padding: 11px 20px;
      font-size: 14px;
      cursor: pointer;
    }

    .forward-cancel {
      background: rgba(128,128,128,0.15);
      color: inherit;
    }

    .forward-send {
      background: #3985ff;
      color: white;
    }

    .forward-send:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    @media (max-width: 768px) {
      .forward-box {
        max-width: 100%;
      }
    }
  `;

  document.head.appendChild(style);
}

// MESSAGE REACT ACTION
const reactAction = document.getElementById("reactAction");

function ensureReactionPicker() {
  let picker = document.getElementById("reactionPicker");

  if (picker) return picker;

  picker = document.createElement("div");
  picker.id = "reactionPicker";
  picker.className = "reaction-picker";

  ["❤️", "😂", "😮", "😢", "👍"].forEach(emoji => {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = emoji;
    button.setAttribute("aria-label", `React ${emoji}`);

    button.addEventListener("click", async event => {
      event.stopPropagation();

      if (!selectedMessage || !currentUser) return;

      const message = selectedMessage;

      try {
        await set(
          ref(
            db,
            `${message.roomPath}/${message.id}/reactions/${currentUser.uid}`
          ),
          emoji
        );

        closeMessageMenu();

      } catch (error) {
        alert("Reaction failed: " + error.message);
      }
    });

    picker.appendChild(button);
  });

  messageActionMenu.appendChild(picker);

  if (!document.getElementById("messageActionExtraStyles")) {
    const style = document.createElement("style");
    style.id = "messageActionExtraStyles";

    style.textContent = `
      .reaction-picker {
        display: none;
        gap: 6px;
        align-items: center;
        justify-content: center;
        padding: 8px 4px;
        flex-wrap: nowrap;
      }

      .reaction-picker button {
        border: 0;
        background: rgba(128,128,128,.14);
        border-radius: 12px;
        padding: 7px;
        font-size: 21px;
        cursor: pointer;
        line-height: 1;
      }

      .reaction-picker button:hover {
        background: rgba(128,128,128,.28);
      }

      .message-reactions {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
        margin-top: 4px;
      }

      .reaction-chip {
        font-size: 13px;
        padding: 2px 7px;
        border-radius: 12px;
        background: rgba(128,128,128,.16);
      }

      @media (max-width: 768px) {
        .reaction-picker button {
          font-size: 20px;
          padding: 8px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  return picker;
}

reactAction.onclick = event => {
  event.stopPropagation();

  if (!selectedMessage) return;

  const picker = ensureReactionPicker();
  const willShow = picker.style.display !== "flex";

  picker.style.display = willShow ? "flex" : "none";

  if (willShow) {
    requestAnimationFrame(() => {
      const messageElement = messagesArea.querySelector(
        `[data-message-id="${selectedMessage.id}"]`
      );

      if (messageElement) {
        positionMessageMenu(messageElement);
      }
    });
  }
};

// MESSAGE DELETE ACTION
const deleteAction = document.getElementById("deleteAction");

if (deleteAction) {
  deleteAction.onclick = () => {
    if (!selectedMessage || !currentUser) return;

    const message = { ...selectedMessage };
    closeMessageMenu();

    document.getElementById("deleteConfirmModal")?.remove();

    const modal = document.createElement("div");
    modal.id = "deleteConfirmModal";

    modal.innerHTML = `
      <div class="delete-confirm-box">
        <div class="delete-icon">🗑️</div>
        <h3>Delete Message?</h3>
        <p>Are you Sure to Delete This Message?</p>

        <div class="delete-confirm-buttons">
          <button type="button" class="delete-cancel">Cancel</button>
          <button type="button" class="delete-confirm">Delete</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector(".delete-cancel").onclick = () => {
      modal.remove();
    };

    modal.onclick = event => {
      if (event.target === modal) modal.remove();
    };

    modal.querySelector(".delete-confirm").onclick = async () => {
      const deleteBtn = modal.querySelector(".delete-confirm");

      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting...";

      try {
        const messageRef = ref(
          db,
          `${message.roomPath}/${message.id}`
        );

        const messageSnap = await get(messageRef);

        if (!messageSnap.exists()) {
          modal.remove();
          return;
        }

        const latestMessage = messageSnap.val();

        await remove(messageRef);

        if (
          message.roomPath.startsWith("privateChats/") &&
          latestMessage.status !== "seen"
        ) {
          const peerSnap = await get(
            ref(db, `userChats/${currentUser.uid}/${message.roomId}/peerUid`)
          );

          const peerUid = peerSnap.val();

          const unreadOwner =
            latestMessage.uid === currentUser.uid
              ? peerUid
              : currentUser.uid;

          if (unreadOwner) {
            const unreadRef = ref(
              db,
              `userChats/${unreadOwner}/${message.roomId}/unreadCount`
            );

            await runTransaction(unreadRef, count => {
              return Math.max(0, (Number(count) || 0) - 1);
            });
          }
        }

        modal.remove();

      } catch (error) {
        console.error("Delete Error:", error);
        alert("Delete failed: " + error.message);

        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete";
      }
    };
  };
}

// DELETE MODAL CSS
if (!document.getElementById("deleteConfirmStyles")) {
  const style = document.createElement("style");
  style.id = "deleteConfirmStyles";

  style.textContent = `
    #deleteConfirmModal {
      position: fixed;
      inset: 0;
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(0,0,0,.65);
      backdrop-filter: blur(10px);
    }

    .delete-confirm-box {
      width: 100%;
      max-width: 340px;
      padding: 28px 22px;
      border-radius: 22px;
      text-align: center;
      color: white;
      background: #182238;
      box-shadow: 0 20px 60px rgba(0,0,0,.45);
    }

    .delete-icon {
      font-size: 35px;
      margin-bottom: 12px;
    }

    .delete-confirm-box p {
      color: #aab5cc;
      font-size: 13px;
    }

    .delete-confirm-buttons {
      display: flex;
      gap: 10px;
      margin-top: 24px;
    }

    .delete-confirm-buttons button {
      flex: 1;
      padding: 12px;
      border: none;
      border-radius: 12px;
      cursor: pointer;
    }

    .delete-cancel {
      background: rgba(255,255,255,.12);
      color: white;
    }

    .delete-confirm {
      background: #ef4444;
      color: white;
    }
  `;

  document.head.appendChild(style);
}

// DELETE ACCOUNT BUTTON
const deleteAccountBtn = document.createElement("button");

deleteAccountBtn.id = "deleteAccountBtn";
deleteAccountBtn.type = "button";
deleteAccountBtn.className = "delete-account-btn";
deleteAccountBtn.textContent = "Delete Account";

editProfileBtn.insertAdjacentElement("afterend", deleteAccountBtn);

// DELETE ACCOUNT BUTTON STYLE
if (!document.getElementById("deleteAccountStyles")) {
  const style = document.createElement("style");
  style.id = "deleteAccountStyles";

  style.textContent = `
    .delete-account-btn {
      display: block;
      width: 100%;
      margin-top: 12px;
      padding: 12px;
      border: none;
      border-radius: 12px;
      background: #ef4444;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .delete-account-btn:hover {
      background: #dc2626;
    }

    .delete-account-btn:disabled {
      opacity: .6;
      cursor: not-allowed;
    }
  `;

  document.head.appendChild(style);
}



// DELETE ACCOUNT — LIQUID GLASS MODAL

const deletePasswordModal = document.getElementById("deletePasswordModal");
const deleteAccountPassword = document.getElementById("deleteAccountPassword");
const cancelDeletePassword = document.getElementById("cancelDeletePassword");
const confirmDeletePassword = document.getElementById("confirmDeletePassword");

// Error message
let deletePasswordError = document.getElementById("deletePasswordError");

if (!deletePasswordError && deletePasswordModal) {
  deletePasswordError = document.createElement("p");
  deletePasswordError.id = "deletePasswordError";
  deletePasswordError.style.cssText =
    "color:#ff7b89;font-size:12px;margin:0 0 12px;display:none;";
  deleteAccountPassword.insertAdjacentElement("afterend", deletePasswordError);
}

function closeDeletePasswordModal() {
  deletePasswordModal?.classList.remove("show");

  if (deleteAccountPassword) {
    deleteAccountPassword.value = "";
  }

  if (deletePasswordError) {
    deletePasswordError.textContent = "";
    deletePasswordError.style.display = "none";
  }

  confirmDeletePassword.disabled = false;
  confirmDeletePassword.textContent = "Delete Account";
}

deleteAccountBtn.onclick = () => {
  if (!currentUser || !deletePasswordModal) return;

  deleteAccountPassword.value = "";
  deletePasswordError.style.display = "none";

  deletePasswordModal.classList.add("show");
  deleteAccountPassword.focus();
};

cancelDeletePassword.onclick = closeDeletePasswordModal;

deletePasswordModal.addEventListener("click", event => {
  if (event.target === deletePasswordModal) {
    closeDeletePasswordModal();
  }
});

// CONFIRM ACCOUNT DELETION
confirmDeletePassword.onclick = async () => {
  if (!currentUser) return;

  const password = deleteAccountPassword.value;

  if (!password.trim()) {
    deletePasswordError.textContent = "Please enter your password.";
    deletePasswordError.style.display = "block";
    return;
  }

  confirmDeletePassword.disabled = true;
  confirmDeletePassword.textContent = "Deleting...";

  try {
    const user = currentUser;
    const uid = user.uid;

    if (!user.email) {
      throw new Error("This account has no email address.");
    }

    // Re-authenticate
    const credential = EmailAuthProvider.credential(
      user.email,
      password
    );

    await reauthenticateWithCredential(user, credential);

    // Get own profile
    const profileSnapshot = await get(
      ref(db, `users/${uid}/profile`)
    );

    const username = cleanUsername(
      profileSnapshot.val()?.username ||
      currentProfile?.username ||
      ""
    );

    // Get private chats
    const chatsSnapshot = await get(
      ref(db, `userChats/${uid}`)
    );

    const chats = chatsSnapshot.val() || {};
    const deleteUpdates = {};

    for (const [roomId, chat] of Object.entries(chats)) {
      if (
        roomId === "activeRoom" ||
        !chat ||
        typeof chat !== "object"
      ) continue;

      const peerUid = chat.peerUid;

      if (!peerUid || peerUid === uid) continue;

      deleteUpdates[`userChats/${peerUid}/${roomId}`] = null;
      deleteUpdates[`privateChats/${roomId}`] = null;
    }

    // Delete own database data
    deleteUpdates[`users/${uid}`] = null;
    deleteUpdates[`userChats/${uid}`] = null;
    deleteUpdates[`presence/${uid}`] = null;

    if (username) {
      await releaseUsername(username, uid);
    }

    await update(ref(db), deleteUpdates);

    // Delete authentication account
    await deleteUser(user);

    closeDeletePasswordModal();
    profileModal.classList.remove("show");

    alert("Your account has been deleted successfully!");

  } catch (error) {
    console.error("Account Delete Error:", error);

    let message = "Account deletion failed: " + error.message;

    if (
      error.code === "auth/wrong-password" ||
      error.code === "auth/invalid-credential"
    ) {
      message = "Incorrect password. Please try again.";

    } else if (error.code === "auth/requires-recent-login") {
      message = "Please log in again, then try deleting your account.";
    }

    deletePasswordError.textContent = message;
    deletePasswordError.style.display = "block";

  } finally {
    confirmDeletePassword.disabled = false;
    confirmDeletePassword.textContent = "Delete Account";
  }
};
document.querySelectorAll(".toggle-password").forEach(button => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target);
    if (!input) return;

    input.type = input.type === "password" ? "text" : "password";
    button.innerHTML = input.type === "password"
      ? '<i class="eye-icon">Show Password</i>'
      : '<i class="eye-icon">Unshow Password</i>';
  });
});