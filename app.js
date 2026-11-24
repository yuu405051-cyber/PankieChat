import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  push,
  onChildAdded,
  onChildChanged,
  onValue,
  set,
  get,
  update,
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

// CHAT HEADER
const chatHeaderName = document.querySelector(".chat-header b");
const chatHeaderAvatar = document.querySelector(".chat-header .avatar");

// PROFILE ELEMENTS
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
let replyingTo = null;
let activeRoom = {
  type: "general",
  id: "general",
  path: "rooms/general/messages"
};
let searchRequest = 0;
let stopPresence = null;
let stopTyping = null;

// SET TYPING STATUS
async function setTyping(isTyping) {
  if (!currentUser || activeRoom.type !== "private") return;

  const typingRef = ref(
    db,
    `privateChats/${activeRoom.id}/typing/${currentUser.uid}`
  );

  try {
    await set(typingRef, isTyping);
  } catch (error) {
    console.error("Typing Error:", error);
  }
}

// ONLINE / OFFLINE STATUS
function startPresence() {
  if (!currentUser) return;

  if (stopPresence) {
    stopPresence();
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

      console.log("User is online");
    } catch (error) {
      console.error("Presence Error:", error);
    }
  });
}

// USERNAME HELPERS

function cleanUsername(value) {
  return value.trim().replace(/^@/, "").toLowerCase();
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

  try {
    authMessage.textContent = "Creating account...";

    await createUserWithEmailAndPassword(auth, email, password);

    authMessage.textContent = "Account created successfully!";
  } catch (error) {
    console.error(error);
    authMessage.textContent = error.message;
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

  try {
    authMessage.textContent = "Logging in...";

    await signInWithEmailAndPassword(auth, email, password);

    authMessage.textContent = "Login successful!";
  } catch (error) {
    console.error(error);
    authMessage.textContent = error.message;
  }
};

// AUTH STATE

onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (user) {
    authScreen.style.display = "none";
    appScreen.style.display = "flex";

    try {
      await loadProfile();
      await loadUserChats();
      listenAllChatPresence();
      listenAllChatTyping();
      startPresence();
      openGeneralChat();
    } catch (error) {
      console.error("App Load Error:", error);
      alert("Could not load app: " + error.message);
    }

  } else {
    authScreen.style.display = "flex";
    appScreen.style.display = "none";

    if (stopMessages) {
      stopMessages();
      stopMessages = null;
    }

    if (stopPresence) {
      stopPresence();
      stopPresence = null;
    }
    currentProfile = null;
    searchResults.innerHTML = "";
    userSearch.value = "";
    chatList.innerHTML = "";
  }
});

// LOGOUT

logoutBtn.onclick = async () => {
  try {
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

// PROFILE PHOTO

changePhotoBtn.onclick = () => photoInput.click();

photoInput.onchange = async () => {
  const file = photoInput.files[0];

  if (!file || !currentUser) return;

  if (!file.type.startsWith("image/")) {
    alert("Please select an image.");
    return;
  }

  if (file.size > 500 * 1024) {
    alert("Please choose an image smaller than 500 KB.");
    return;
  }

  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const profileRef = ref(db, `users/${currentUser.uid}/profile`);
      const snapshot = await get(profileRef);
      const profile = snapshot.val();

      if (!profile) {
        alert("Profile not found. Please reload the app.");
        return;
      }

      profile.photo = reader.result;

      await set(profileRef, profile);

      currentProfile = profile;
      updateProfileUI(profile);

      alert("Profile photo updated!");
    } catch (error) {
      console.error(error);
      alert("Photo could not be saved: " + error.message);
    }
  };

  reader.readAsDataURL(file);
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

  // UNREAD BADGE
  const unreadBadge = document.createElement("span");
  unreadBadge.className = "unread-badge";
  unreadBadge.textContent = "0";
  unreadBadge.style.display = "none";

  info.append(title, subtitle, typing);
  item.append(avatar, info, unreadBadge);

  chatList.appendChild(item);

  return item;
}

// UPDATE LAST MESSAGE PREVIEW

function updateLastMessage(roomId, message) {
  const chatItem = Array.from(chatList.children)
    .find(item => item.dataset.roomId === roomId);

  if (!chatItem) return;

  const preview = chatItem.querySelector(".last-message");

  if (preview) {
    preview.textContent = message;
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

// LISTEN ALL CHAT TYPING

function listenAllChatTyping() {
  chatList.querySelectorAll(".chat").forEach(item => {
    const uid = item.dataset.peerUid;
    const roomId = item.dataset.roomId;

    if (!uid || !roomId) return;

    const typingRef = ref(
      db,
      `privateChats/${roomId}/typing/${uid}`
    );

    onValue(typingRef, snapshot => {
      const isTyping = snapshot.val() === true;
      const subtitle = item.querySelector(".last-message");

      if (!subtitle) return;

      if (isTyping) {
        subtitle.textContent = "Typing...";
        subtitle.classList.add("is-typing");
      } else {
  subtitle.classList.remove("is-typing");

  const messagesRef = ref(
    db,
    `privateChats/${roomId}/messages`
  );

  get(messagesRef).then(snapshot => {
    if (!snapshot.exists()) {
      subtitle.textContent = "@" + (item.dataset.username || "user");
      return;
    }

    const messages = Object.values(snapshot.val());
    const lastMessage = messages[messages.length - 1];

    subtitle.textContent = lastMessage?.text || "No messages yet";
  });
}
    });
  });
}
// OPEN GENERAL CHAT

function openGeneralChat() {
  activeRoom = {
    type: "general",
    id: "general",
    path: "rooms/general/messages"
  };
  // SAVE ACTIVE CHAT
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

let stopPeerPresence = null;

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

  if (!uid) return;

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
function setActiveChat(roomId) {
  chatList.querySelectorAll(".chat").forEach(item => {
    item.classList.toggle(
      "active",
      item.dataset.roomId === roomId
    );
  });

  // MOBILE: OPEN CHAT SCREEN
  if (window.innerWidth <= 768) {
    appScreen.classList.add("mobile-chat-open");
  }
}

// OPEN PRIVATE CHAT

async function openPrivateChat(peerUid, peerProfile) {
  if (!currentUser || !peerUid || !peerProfile) return;

  const members = [currentUser.uid, peerUid].sort();
  const roomId = members.join("_");

  const roomPath = `privateChats/${roomId}/messages`;

  const myProfileData = currentProfile || {
    name: "User",
    username: "user",
    photo: ""
  };

  try {
    // Save chat in my chat list
    await update(
      ref(db, `userChats/${currentUser.uid}/${roomId}`),
      {
        peerUid,
        name: peerProfile.name || "User",
        username: peerProfile.username || "",
        photo: peerProfile.photo || ""
      }
    );

    // Save chat in the other user's chat list
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
    // SAVE ACTIVE CHAT
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
    if (activeRoom.type === "private") {
      await set(
        ref(db, `userChats/${currentUser.uid}/${activeRoom.id}/unreadCount`),
        0
      );
    }
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

  const peerProfile = {
    name: item.dataset.name,
    username: item.dataset.username,
    photo: item.dataset.photo
  };

  openPrivateChat(peerUid, peerProfile);
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

    // AVATAR
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

    // ONLINE STATUS
    const searchPresenceRef = ref(db, `presence/${uid}`);

    onValue(searchPresenceRef, snapshot => {
      const data = snapshot.val();

      avatar.classList.toggle(
        "is-online",
        data?.state === "online"
      );
    });

    // USER INFO
    const info = document.createElement("div");

    const name = document.createElement("b");
    name.textContent = profile.name || "User";

    const tag = document.createElement("p");
    tag.textContent = "@" + (profile.username || username);

    info.append(name, tag);
    result.append(avatar, info);

    // OPEN PRIVATE CHAT
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

// MESSAGE LISTENER

function listenMessages() {
  if (stopMessages) {
    stopMessages();
    stopMessages = null;
  }

  messagesArea.querySelectorAll(".message").forEach(message => {
    message.remove();
  });

  const messagesRef = ref(db, activeRoom.path);

  const stopAdded = onChildAdded(messagesRef, snapshot => {
    const data = snapshot.val();

    if (!data || !data.text || !currentUser) return;

    const item = document.createElement("div");
    item.classList.add("message");
    item.dataset.messageId = snapshot.key;

    const isSent = data.uid === currentUser.uid;

    item.classList.add(isSent ? "sent" : "received");

    // REPLY DISPLAY

if (data.replyTo) {
  const replyBox = document.createElement("div");
  replyBox.className = "reply-quote";

  const replySender = document.createElement("b");
  replySender.textContent = data.replyTo.senderName;

  const replyContent = document.createElement("p");
  replyContent.textContent = data.replyTo.text;

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
    // REPLY MESSAGE

    // REPLY - PC RIGHT CLICK + PHONE LONG PRESS

function startReply() {
  replyingTo = {
    id: snapshot.key,
    text: data.text,
    senderName: data.senderName || "User"
  };

  document.getElementById("replyText").textContent =
    `${replyingTo.senderName}: ${replyingTo.text}`;

  document.getElementById("replyPreview").style.display = "flex";
}

item.addEventListener("contextmenu", event => {
  event.preventDefault();
  startReply();
});

let pressTimer;

item.addEventListener("touchstart", () => {
  pressTimer = setTimeout(startReply, 600);
});

item.addEventListener("touchend", () => {
  clearTimeout(pressTimer);
});

item.addEventListener("touchmove", () => {
  clearTimeout(pressTimer);
});

    if (isSent) {
      const status = document.createElement("small");
      status.classList.add("message-status");
      status.textContent = data.status === "seen" ? "✓✓" : "✓";

      if (data.status === "seen") {
        status.classList.add("seen");
      }

      item.appendChild(status);
    }

    messagesArea.appendChild(item);
    updateLastMessage(activeRoom.id, data.text);

    // Mark received private messages as seen
    if (!isSent && activeRoom.type === "private") {
      update(
        ref(db, `${activeRoom.path}/${snapshot.key}`),
        { status: "seen" }
      ).catch(console.error);

    set(
      ref(db, `userChats/${currentUser.uid}/${activeRoom.id}/unreadCount`),
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

    if (!item || !data || data.uid !== currentUser?.uid) return;

    const status = item.querySelector(".message-status");

    if (status) {
      status.textContent = data.status === "seen" ? "✓✓" : "✓";
      status.classList.toggle("seen", data.status === "seen");
    }
  });

  stopMessages = () => {
    stopAdded();
    stopChanged();
  };
}

// SEND MESSAGE


async function sendMessage() {
  const text = messageInput.value.trim();

  if (!text) return;

  if (!currentUser) {
    alert("Please login first.");
    return;
  }

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

      const peerIsViewingThisChat =
        peerActiveRoomSnapshot.val() === activeRoom.id;

      if (!peerIsViewingThisChat) {
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
    sendMessage();
  }
});

// DETECT TYPING

messageInput.addEventListener("input", () => {
  if (activeRoom.type !== "private") return;

  setTyping(messageInput.value.trim().length > 0);
});

console.log("PankieChat App Loaded");
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

searchOverlay.onclick = (e) => {
  if (e.target === searchOverlay) {
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