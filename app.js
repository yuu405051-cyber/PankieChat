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

let stopMessages = null;
let stopPinnedMessage = null;
let stopPresence = null;
let stopTyping = null;
let stopPeerPresence = null;

let replyingTo = null;
let selectedMessage = null;
let pendingPinMessage = null;

let searchRequest = 0;
let activeRoom = null;

let typingWriteQueue = Promise.resolve();
let authInitialized = false;

// SPLASH SCREEN
function hideSplash() {
  if (splashScreen) {
    splashScreen.classList.add("hide");
  }
}

// CLEAN UP LISTENERS
function stopAllListeners() {
  [
    "stopMessages",
    "stopPinnedMessage",
    "stopPresence",
    "stopTyping",
    "stopPeerPresence"
  ].forEach(name => {
    const listener = {
      stopMessages,
      stopPinnedMessage,
      stopPresence,
      stopTyping,
      stopPeerPresence
    }[name];

    if (listener) {
      try {
        listener();
      } catch (error) {
        console.error(error);
      }
    }

    if (name === "stopMessages") stopMessages = null;
    if (name === "stopPinnedMessage") stopPinnedMessage = null;
    if (name === "stopPresence") stopPresence = null;
    if (name === "stopTyping") stopTyping = null;
    if (name === "stopPeerPresence") stopPeerPresence = null;
  });
}

// PINNED MESSAGE PATH
function getPinnedMessagePath() {
  if (!activeRoom) return null;

  return activeRoom.type === "general"
    ? "rooms/general/pinnedMessage"
    : `privateChats/${activeRoom.id}/pinnedMessage`;
}

const messageActionMenu = document.getElementById("messageActionMenu");

// MESSAGE MENU
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

  const typingPath =
    `privateChats/${activeRoom.id}/typing/${currentUser.uid}`;

  const typingRef = ref(db, typingPath);

  typingWriteQueue = typingWriteQueue
    .catch(() => {})
    .then(() => set(typingRef, Boolean(isTyping)));

  return typingWriteQueue.catch(error => {
    console.error("Typing Error:", error);
  });
}

// ONLINE / OFFLINE STATUS
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

// AUTH BUTTON LOADING
function setAuthLoading(loading, message = "") {
  loginBtn.disabled = loading;
  registerBtn.disabled = loading;

  if (message) {
    authMessage.textContent = message;
  }
}

// AUTH: REGISTER
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

// AUTH: LOGIN
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

      messagesArea.querySelectorAll(".message").forEach(message => {
        message.remove();
      });

      setActiveChat("");
      appScreen.classList.remove("mobile-chat-open");

      authMessage.textContent = "";

    } else {
      authScreen.style.display = "flex";
      appScreen.style.display = "none";

      stopAllListeners();

      closeMessageMenu();

      activeRoom = null;
      currentProfile = null;
      pendingPinMessage = null;
      replyingTo = null;

      searchResults.innerHTML = "";
      userSearch.value = "";
      chatList.innerHTML = "";

      messagesArea.querySelectorAll(".message").forEach(message => {
        message.remove();
      });

      profileModal.classList.remove("show");
    }

  } catch (error) {
    console.error("App Load Error:", error);

    authScreen.style.display = "flex";
    appScreen.style.display = "none";

    authMessage.textContent =
      "Could not load app: " + error.message;

  } finally {
    authInitialized = true;
    hideSplash();
  }
});

// SPLASH FALLBACK
setTimeout(() => {
  if (!authInitialized) {
    hideSplash();
  }
}, 5000);

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

// SAVE PROFILE
saveProfile.onclick = async () => {
  if (!currentUser) return;

  const name = editName.value.trim();
  const username = cleanUsername(editUsername.value);

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

    alert("Profile saved successfully!");

  } catch (error) {
    console.error(error);
    alert("Could not save profile: " + error.message);

  } finally {
    saveProfile.disabled = false;
    saveProfile.textContent = "Save Changes";
  }
};

// EDIT PROFILE
editProfileBtn.onclick = () => {
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

    alert("Profile photo updated!");

  } catch (error) {
    console.error(error);
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

  item.dataset.isTyping = "false";
  item.dataset.isOnline = "false";
  item.dataset.lastMessage = "";
  item.dataset.lastSeen = "";

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

// RENDER CHAT LIST PREVIEW
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

// UPDATE LAST MESSAGE PREVIEW
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

// LOAD SAVED PRIVATE CHATS
async function loadUserChats() {
  if (!currentUser) return;

  chatList.innerHTML = "";

  addChatToList(
    "general",
    "General Chat",
    "",
    "",
    "general",
    ""
  );

  const chatsRef = ref(db, `userChats/${currentUser.uid}`);
  const snapshot = await get(chatsRef);

  if (!snapshot.exists()) return;

  const chats = snapshot.val();

  Object.entries(chats).forEach(([roomId, chat]) => {
    if (roomId === "activeRoom" || !chat || typeof chat !== "object") {
      return;
    }

    const item = addChatToList(
      roomId,
      chat.name,
      chat.username,
      chat.photo,
      "private",
      chat.peerUid
    );

    const unreadRef = ref(
      db,
      `userChats/${currentUser.uid}/${roomId}/unreadCount`
    );

    onValue(unreadRef, unreadSnapshot => {
      const count = Number(unreadSnapshot.val()) || 0;
      const badge = item.querySelector(".unread-badge");

      if (!badge) return;

      badge.textContent = count > 99 ? "99+" : count;
      badge.style.display = count > 0 ? "flex" : "none";
    });
  });
}

// LISTEN ALL CHAT PRESENCE
function listenAllChatPresence() {
  chatList.querySelectorAll(".chat").forEach(item => {
    const uid = item.dataset.peerUid;
    if (!uid) return;

    const presenceRef = ref(db, `presence/${uid}`);

    onValue(presenceRef, snapshot => {
      const data = snapshot.val();
      const avatar = item.querySelector(".avatar");

      if (avatar) {
        avatar.classList.toggle(
          "is-online",
          data?.state === "online"
        );
      }
    });
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

    const typingRef = ref(
      db,
      `privateChats/${roomId}/typing/${uid}`
    );

    onValue(typingRef, snapshot => {
      item.dataset.isTyping =
        snapshot.val() === true ? "true" : "false";

      renderChatPreview(item);

      const chatTyping = item.querySelector(".chat-typing");

      if (chatTyping) {
        chatTyping.textContent =
          item.dataset.isTyping === "true" ? "Typing..." : "";
      }
    });

    const messagesRef = ref(
      db,
      `privateChats/${roomId}/messages`
    );

    onValue(messagesRef, snapshot => {
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
  });
}

// OPEN GENERAL CHAT
function openGeneralChat() {
  setTyping(false);

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
      status.textContent =
        "Last seen at " +
        new Date(data.lastChanged).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit"
        });

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

// LISTEN PEER TYPING
function listenPeerTyping(uid) {
  if (stopTyping) {
    stopTyping();
    stopTyping = null;
  }

  if (!uid || !activeRoom) return;

  const typingRef = ref(
    db,
    `privateChats/${activeRoom.id}/typing/${uid}`
  );

  stopTyping = onValue(typingRef, snapshot => {
    const isTyping = snapshot.val() === true;
    const typingStatus = document.querySelector("#typingStatus");

    if (typingStatus) {
      typingStatus.textContent = isTyping ? "Typing..." : "";
    }

    const chatItem = Array.from(chatList.children).find(
      item => item.dataset.peerUid === uid
    );

    if (chatItem) {
      const chatTyping = chatItem.querySelector(".chat-typing");

      if (chatTyping) {
        chatTyping.textContent = isTyping ? "Typing..." : "";
      }
    }
  });
}

// OPEN PRIVATE CHAT
async function openPrivateChat(peerUid, peerProfile) {
  if (!currentUser || !peerUid || !peerProfile) return;

  await setTyping(false);

  const members = [currentUser.uid, peerUid].sort();
  const roomId = members.join("_");
  const roomPath = `privateChats/${roomId}/messages`;

  const myProfileData = currentProfile || {
    name: "User",
    username: "user",
    photo: ""
  };

  try {
    await update(
      ref(db, `userChats/${currentUser.uid}/${roomId}`),
      {
        peerUid,
        name: peerProfile.name || "User",
        username: peerProfile.username || "",
        photo: peerProfile.photo || ""
      }
    );

    await update(
      ref(db, `userChats/${peerUid}/${roomId}`),
      {
        peerUid: currentUser.uid,
        name: myProfileData.name || "User",
        username: myProfileData.username || "",
        photo: myProfileData.photo || ""
      }
    );

    addChatToList(
      roomId,
      peerProfile.name,
      peerProfile.username,
      peerProfile.photo,
      "private",
      peerUid
    );

    activeRoom = {
      type: "private",
      id: roomId,
      path: roomPath
    };

    const myTypingRef = ref(
      db,
      `privateChats/${roomId}/typing/${currentUser.uid}`
    );

    await onDisconnect(myTypingRef).remove();

    const activeChatRef = ref(
      db,
      `userChats/${currentUser.uid}/activeRoom`
    );

    await onDisconnect(activeChatRef).remove();
    await set(activeChatRef, roomId);

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

    setActiveChat(roomId);
    listenMessages();

    await set(
      ref(db, `userChats/${currentUser.uid}/${roomId}/unreadCount`),
      0
    );

    listenPeerPresence(peerUid);
    listenPeerTyping(peerUid);

    searchResults.innerHTML = "";
    userSearch.value = "";
    messageInput.focus();

  } catch (error) {
    console.error("Open Private Chat Error:", error);
    alert("Could not open chat: " + error.message);
  }
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

    onValue(searchPresenceRef, snapshot => {
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

// MESSAGE LISTENER
function listenMessages() {
  if (!activeRoom) return;

  if (stopMessages) {
    stopMessages();
    stopMessages = null;
  }

  closeMessageMenu();

  messagesArea.querySelectorAll(".message").forEach(message => {
    message.remove();
  });

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

    const messageText = document.createElement("span");
    messageText.textContent = data.text;

    const time = document.createElement("small");
    time.textContent = new Date(data.createdAt || Date.now())
      .toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

    item.append(messageText, time);

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

    messagesArea.appendChild(item);
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

    if (
      selectedMessage?.id === snapshot.key &&
      selectedMessage?.roomPath === roomPath
    ) {
      closeMessageMenu();
    }

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

  try {
    const messagesRef = ref(db, activeRoom.path);
    const newMessageRef = push(messagesRef);

    const messageData = {
      text,
      uid: currentUser.uid,
      senderName: currentProfile?.name || "User",
      createdAt: Date.now(),
      status: "sent"
    };

    if (replyingTo) {
      messageData.replyTo = {
        messageId: replyingTo.id,
        text: replyingTo.text,
        senderName: replyingTo.senderName
      };
    }

    await set(newMessageRef, messageData);

    if (activeRoom.type === "private") {
      const chatItem = Array.from(chatList.children)
        .find(item => item.dataset.roomId === activeRoom.id);

      const peerUid = chatItem?.dataset.peerUid;

      if (peerUid) {
        const unreadRef = ref(
          db,
          `userChats/${peerUid}/${activeRoom.id}/unreadCount`
        );

        const peerActiveRoomRef = ref(
          db,
          `userChats/${peerUid}/activeRoom`
        );

        const peerActiveRoomSnapshot = await get(peerActiveRoomRef);

        if (peerActiveRoomSnapshot.val() !== activeRoom.id) {
          await runTransaction(unreadRef, count => {
            return (Number(count) || 0) + 1;
          });
        }
      }
    }

    updateLastMessage(activeRoom.id, text);

    await setTyping(false);

    messageInput.value = "";
    replyingTo = null;

    document.getElementById("replyPreview").style.display = "none";

  } catch (error) {
    console.error("Send Error:", error);
    alert("Message could not be sent: " + error.message);
  }
}

sendButton.onclick = sendMessage;

messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    sendMessage();
  }
});

// DETECT TYPING
messageInput.addEventListener("input", () => {
  if (!activeRoom || activeRoom.type !== "private") return;

  setTyping(messageInput.value.trim().length > 0);
});

messageInput.addEventListener("blur", () => {
  setTyping(false);
});

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

// CREATE DELETE ACCOUNT BUTTON AUTOMATICALLY
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

// DELETE ACCOUNT
deleteAccountBtn.onclick = async () => {
  if (!currentUser) return;

  const confirmed = confirm(
    "Delete your account permanently? This action cannot be undone."
  );

  if (!confirmed) return;

  const password = prompt(
    "Enter your account password to confirm deletion:"
  );

  if (!password) return;

  deleteAccountBtn.disabled = true;
  deleteAccountBtn.textContent = "Deleting...";

  try {
    const user = currentUser;
    const uid = user.uid;

    if (!user.email) {
      throw new Error("This account has no email address.");
    }

    // REAUTHENTICATE
    const credential = EmailAuthProvider.credential(
      user.email,
      password
    );

    await reauthenticateWithCredential(user, credential);

    // GET CURRENT USERNAME
    const profileSnapshot = await get(
      ref(db, `users/${uid}/profile`)
    );

    const username = cleanUsername(
      profileSnapshot.val()?.username || currentProfile?.username || ""
    );

    // RELEASE USERNAME ONLY IF OWNED BY THIS USER
    if (username) {
      await releaseUsername(username, uid);
    }

    // REMOVE ONLY THIS USER'S PERSONAL DATA
    // Shared private chat rooms are intentionally preserved.
    await update(ref(db), {
      [`users/${uid}`]: null,
      [`userChats/${uid}`]: null,
      [`presence/${uid}`]: null
    });

    // DELETE FIREBASE AUTH ACCOUNT
    await deleteUser(user);

    profileModal.classList.remove("show");

    alert("Your account has been deleted successfully.");

  } catch (error) {
    console.error("Account Delete Error:", error);

    if (error.code === "auth/wrong-password" ||
        error.code === "auth/invalid-credential") {
      alert("Incorrect password. Account was not deleted.");

    } else if (error.code === "auth/requires-recent-login") {
      alert("Please log in again, then try deleting your account.");

    } else {
      alert("Account deletion failed: " + error.message);
    }

  } finally {
    deleteAccountBtn.disabled = false;
    deleteAccountBtn.textContent = "Delete Account";
  }
};

console.log("PankieChat App Loaded");