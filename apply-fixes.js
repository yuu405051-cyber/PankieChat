// PankieChat patcher: fixes photo upload/download, circular progress, typing indicators,
// chat-list typing preview, and unread-count reset bug.
// Run from the project folder: node apply-fixes.js

const fs = require("fs");
const path = require("path");
const file = path.join(process.cwd(), "app.js");

if (!fs.existsSync(file)) {
  console.error("ERROR: app.js was not found. Put this script in the same folder as app.js.");
  process.exit(1);
}
let s = fs.readFileSync(file, "utf8");

function replaceBetween(start, end, replacement, label) {
  const a = s.indexOf(start);
  const b = s.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error("Could not locate section: " + label);
  s = s.slice(0, a) + replacement + "\n\n" + s.slice(b);
}
function replaceOnce(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error("Could not locate code: " + label);
  s = s.replace(oldText, newText);
}

// Additional state for chat-list typing indicators.
replaceOnce(
  "let searchRequest = 0;",
  `let searchRequest = 0;
let chatTypingStops = [];
let chatTypingState = {};
let cachedChats = [];
let chatTypingSignature = "";`,
  "state variables"
);

// Add chat-list typing subscriptions without creating duplicate listeners.
replaceBetween(
  "function listenChatList() {",
  "function renderChatList(chats = []) {",
`function listenChatList() {
  listen(userStops, onValue(ref(db, \`userChats/\${currentUser.uid}\`), snap => {
    const chats = [];
    snap.forEach(child => {
      const d = child.val();
      if (d?.peerUid) chats.push({id:child.key, ...d});
    });
    chats.sort((a,b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
    cachedChats = chats;
    renderChatList(chats);
    watchChatTyping(chats);
  }, console.error));
}
function watchChatTyping(chats) {
  const signature = chats.map(c => \`\${c.id}:\${c.peerUid}\`).sort().join("|");
  if (signature === chatTypingSignature) return;
  chatTypingSignature = signature;
  chatTypingStops.forEach(stop => { try { stop(); } catch {} });
  chatTypingStops = [];
  chatTypingState = {};
  chats.forEach(c => {
    const typingRef = ref(db, \`privateChats/\${c.id}/typing/\${c.peerUid}\`);
    const stop = onValue(typingRef, snap => {
      chatTypingState[c.id] = snap.val()?.isTyping === true;
      renderChatList(cachedChats);
    }, console.error);
    chatTypingStops.push(stop);
  });
}`,
  "chat list listeners"
);

// Show "Typing…" in the chat list preview.
replaceOnce(
  '<div class="chat-item-bottom"><span class="last-message">\${esc(c.lastMessage || "Start a conversation")}</span>',
  '<div class="chat-item-bottom"><span class="last-message">\${esc(chatTypingState[c.id] ? "Typing…" : (c.lastMessage || "Start a conversation"))}</span>',
  "chat list typing preview"
);

// Replace typing implementation. Supports header and in-chat indicator.
replaceBetween(
  "/* 9. TYPING */",
  "/* 10. MESSAGE RENDERING */",
`/* 9. TYPING */
function setTyping(value) {
  if (!activeRoom || activeRoom.type !== "private" || !currentUser) return Promise.resolve();
  const roomId = activeRoom.id;
  const typingRef = ref(db, \`privateChats/\${roomId}/typing/\${currentUser.uid}\`);
  return value
    ? set(typingRef, {isTyping:true, updatedAt:Date.now()})
    : remove(typingRef);
}
function listenPeerTyping(uid) {
  const indicator = el("typingIndicator");
  listen(roomStops, onValue(ref(db, \`privateChats/\${activeRoom.id}/typing/\${uid}\`), snap => {
    const isTyping = snap.val()?.isTyping === true;
    if (dom.typing) dom.typing.textContent = isTyping ? "typing…" : "";
    if (indicator) {
      indicator.textContent = isTyping ? "Typing…" : "";
      indicator.style.display = isTyping ? "flex" : "none";
    }
  }, console.error));
}
dom.input?.addEventListener("input", () => {
  if (activeRoom?.type !== "private") return;
  setTyping(true).catch(console.error);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => setTyping(false).catch(console.error), 1800);
});
window.addEventListener("beforeunload", () => {
  clearTimeout(typingTimer);
  if (currentUser && activeRoom?.type === "private") setTyping(false).catch(() => {});
});`,
  "typing section"
);

// Ensure chat cleanup stops typing and chat-list subscriptions are stopped at sign-out.
replaceOnce(
  `function cleanRoom() {\n  stopAll(roomStops);`,
  `function cleanRoom() {\n  clearTimeout(typingTimer);\n  if (activeRoom?.type === "private" && currentUser) setTyping(false).catch(() => {});\n  stopAll(roomStops);`,
  "room cleanup"
);
replaceOnce(
  `stopAll(roomStops);stopAll(userStops);`,
  `stopAll(roomStops);stopAll(userStops);\n  chatTypingStops.forEach(stop => { try { stop(); } catch {} });\n  chatTypingStops = []; chatTypingSignature = ""; chatTypingState = {}; cachedChats = [];`,
  "signed-out cleanup"
);

// Fix unread count: do not clear it immediately before incrementing.
replaceOnce(
  "  updates[\`userChats/\${activeRoom.peerUid}/\${activeRoom.id}/unreadCount\`] = null;\n",
  "",
  "unread count reset"
);

// XHR gives real upload progress, and the B2 function expects base64 + messageId,
// returning { ok: true } rather than { success: true }.
replaceBetween(
  "async function uploadToB2(file) {",
  "async function downloadAndDisplayMedia(wrapper,data,messageId) {",
`async function uploadToB2(file, roomSnapshot, onProgress = () => {}) {
  if (!currentUser || !roomSnapshot) throw new Error("Select a chat first.");
  if (file.size === 0 || file.size > MAX_MEDIA_SIZE) throw new Error("File must be 4 MB or smaller.");

  const token = await currentUser.getIdToken();
  const base64 = await fileToBase64(file);
  const messageId = push(ref(db, roomSnapshot.type === "general"
    ? "rooms/general/messages"
    : \`privateChats/\${roomSnapshot.id}/messages\`)).key;

  const payload = {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    base64,
    roomType: roomSnapshot.type,
    roomId: roomSnapshot.id,
    messageId
  };

  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/.netlify/functions/b2-upload");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", \`Bearer \${token}\`);
    xhr.upload.addEventListener("progress", event => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.ok === true) resolve(body);
      else reject(new Error(body.error || \`Upload failed (HTTP \${xhr.status}).\`));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading. Check your phone connection."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    xhr.send(JSON.stringify(payload));
  });
  onProgress(100);
  return result;
}`,
  "B2 upload function"
);

// b2-download returns JSON containing base64, not a raw binary response.
replaceBetween(
  "async function downloadAndDisplayMedia(wrapper,data,messageId) {",
  "function openPhotoPreview(file) {",
`async function downloadAndDisplayMedia(wrapper, data, messageId, roomSnapshot = activeRoom) {
  const placeholder = $(".media-loading", wrapper);
  try {
    if (!roomSnapshot) throw new Error("Chat is no longer active.");
    const token = await currentUser.getIdToken();
    const response = await fetch("/.netlify/functions/b2-download", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":\`Bearer \${token}\`},
      body:JSON.stringify({
        key:data.media.key,
        roomType:roomSnapshot.type,
        roomId:roomSnapshot.id,
        messageId
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true || !result.base64) {
      throw new Error(result.error || "Download failed.");
    }
    const binary = atob(result.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const type = result.contentType || data.media.contentType || "application/octet-stream";
    const blob = new Blob([bytes], {type});
    const url = URL.createObjectURL(blob);
    currentMediaUrls.add(url);

    let node;
    if (type.startsWith("image/")) {
      node = document.createElement("img");
      node.className = "chat-media-image";
      node.alt = result.fileName || data.media.name || "Image";
      node.src = url;
    } else if (type.startsWith("video/")) {
      node = document.createElement("video");
      node.className = "chat-media-video";
      node.controls = true;
      node.playsInline = true;
      node.src = url;
    } else if (type.startsWith("audio/")) {
      node = document.createElement("audio");
      node.controls = true;
      node.src = url;
    } else {
      node = document.createElement("a");
      node.className = "chat-file-link";
      node.href = url;
      node.download = result.fileName || data.media.name || "download";
      node.textContent = \`📎 \${result.fileName || data.media.name || "Download file"}\`;
    }
    placeholder?.replaceWith(node);
  } catch (e) {
    console.error("Media download:", e);
    if (placeholder) placeholder.textContent = "Attachment unavailable";
  }
}`,
  "B2 download function"
);

// Pass a stable room snapshot to the download handler.
replaceOnce(
  'if (data.media?.key) downloadAndDisplayMedia(wrapper, data, id);',
  'if (data.media?.key) downloadAndDisplayMedia(wrapper, data, id, {...activeRoom});',
  "media room snapshot"
);

// Replace sendAttachment with backend-compatible upload and actual progress ring updates.
replaceBetween(
  "async function sendAttachment(file) {",
  "dom.sendPhoto?.addEventListener",
`async function sendAttachment(file) {
  if (photoUploading || !activeRoom || !currentUser) return;
  photoUploading = true;
  const roomAtStart = {...activeRoom};
  if (dom.sendPhoto) dom.sendPhoto.disabled = true;

  const setProgress = percent => {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    if (dom.photoProgressText) dom.photoProgressText.textContent = \`\${p}%\`;
    if (dom.photoProgressCircle) {
      dom.photoProgressCircle.style.setProperty("--progress", \`\${p * 3.6}deg\`);
      dom.photoProgressCircle.style.background =
        \`conic-gradient(#69b7ff \${p * 3.6}deg, rgba(255,255,255,.13) 0deg)\`;
    }
  };

  if (file.type.startsWith("image/")) {
    show(dom.photoProgress, "flex");
    dom.photoProgress?.classList.add("uploading");
    setProgress(0);
  }

  try {
    await uploadToB2(file, roomAtStart, setProgress);
    setProgress(100);
    if (roomAtStart.type === "private") {
      // The b2-upload function writes the message, chat preview and unread count.
      // Do not increment unread again here.
      await renderChatListFromDb();
    }
    if (activeRoom?.id === roomAtStart.id && file.type.startsWith("image/")) {
      closePhotoPreview();
    }
  } catch (e) {
    console.error("Attachment upload:", e);
    notify(e.message || "Upload failed.");
  } finally {
    photoUploading = false;
    if (dom.sendPhoto) dom.sendPhoto.disabled = false;
    if (dom.photoProgress) {
      dom.photoProgress.classList.remove("uploading");
      hide(dom.photoProgress);
    }
  }
}`,
  "send attachment"
);

// Add a self-contained visible progress-ring style, so it works even if CSS lacks it.
const progressStyle = `
/* PankieChat upload progress ring fallback */
#photoUploadProgress.uploading, #photoUploadProgress[style*="flex"] {
  align-items:center; justify-content:center; gap:12px;
}
#photoProgressCircle {
  --progress:0deg; width:54px; height:54px; flex:0 0 54px;
  border-radius:50%; display:grid; place-items:center; position:relative;
  background:conic-gradient(#69b7ff var(--progress),rgba(255,255,255,.13) 0deg);
  box-shadow:0 0 18px rgba(80,165,255,.18);
}
#photoProgressCircle::before {
  content:""; position:absolute; inset:5px; border-radius:50%;
  background:#101a2c;
}
#photoProgressText {
  position:relative; z-index:1; color:#fff; font-size:12px;
  font-weight:700; font-variant-numeric:tabular-nums;
}
#typingIndicator {
  display:none; align-items:center; gap:6px;
}
`;
if (!s.includes("PankieChat upload progress ring fallback")) {
  const marker = "/* 3. DOM HELPERS */";
  const i = s.indexOf(marker);
  if (i < 0) throw new Error("Could not find DOM helper insertion point.");
  s = s.slice(0, i) + `const pankieProgressStyle = document.createElement("style");\npankieProgressStyle.textContent = ${JSON.stringify(progressStyle)};\ndocument.head.appendChild(pankieProgressStyle);\n\n` + s.slice(i);
}

const backup = file + ".backup";
fs.copyFileSync(file, backup);
fs.writeFileSync(file, s, "utf8");
console.log("PankieChat fixes applied successfully.");
console.log("Backup created: " + path.basename(backup));
console.log("Updated: " + path.basename(file));
